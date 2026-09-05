import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { GitHubConnector } from "./connectors/github/connector.mjs";
import { LocalConnector } from "./connectors/local/connector.mjs";
import { ConnectorRegistry } from "./connectors/registry.mjs";
import { createLedgerRecord, appendLedgerRecord, buildPlan, PolicyError, PlanState, Risk, assertApproval, assertPlanTransition, evaluateMergePolicy, SourceOfTruthResolver, TruthDomain, ToolExecutor } from "./core/index.mjs";
import { registerBuiltInTools, ToolRegistry } from "./tools/registry.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, "..", "arabic-devops-agent.html");
const ledgerFile = join(here, "execution-ledger.jsonl");
const port = Number(process.env.PORT || 8787);
const githubToken = process.env.GITHUB_TOKEN || "";
const githubApiBase = (process.env.GITHUB_API_BASE || "https://api.github.com").replace(/\/$/, "");
const defaultRepo = process.env.GITHUB_REPOSITORY || "";
const workspaceRoot = resolve(process.env.WORKSPACE_ROOT || process.cwd());
const actorId = process.env.AGENT_ACTOR_ID || "local-user";
const allowedRepositories = new Set((process.env.GITHUB_ALLOWED_REPOSITORIES || defaultRepo).split(",").map(value => value.trim()).filter(Boolean));
const maxBodyBytes = 64 * 1024;
const maxOutputBytes = 64 * 1024;
const commandTimeoutMs = 30_000;
const rateWindowMs = 60_000;
const rateLimitMax = 60;
const requestBuckets = new Map();
const plans = new Map();
const approvals = new Map();

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}

function text(res, status, value, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "x-content-type-options": "nosniff", "x-frame-options": "DENY" });
  res.end(value);
}

async function bodyOf(req) {
  let raw = "";
  let bytes = 0;
  for await (const chunk of req) {
    bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    if (bytes > maxBodyBytes) throw new PolicyError("حجم الطلب أكبر من الحد المسموح", 413);
    raw += chunk;
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new PolicyError("الطلب ليس JSON صالحًا", 400); }
}

function repoName(value, { requireAllowlist = true } = {}) {
  const repo = String(value || defaultRepo).trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new PolicyError("حدد المستودع بصيغة owner/repository", 400);
  if (requireAllowlist && (!allowedRepositories.size || !allowedRepositories.has(repo))) throw new PolicyError(`المستودع ${repo} غير موجود في GITHUB_ALLOWED_REPOSITORIES`, 403);
  return repo;
}

function record(event) {
  const item = createLedgerRecord(event, actorId);
  appendLedgerRecord(ledgerFile, item);
  return item;
}

const connectorRegistry = new ConnectorRegistry();
const toolRegistry = registerBuiltInTools(new ToolRegistry());
const truthResolver = new SourceOfTruthResolver();
const githubConnector = new GitHubConnector({ token: githubToken, baseUrl: githubApiBase });
connectorRegistry.register(new LocalConnector({ workspaceRoot, maxOutputBytes, commandTimeoutMs }));
connectorRegistry.register(githubConnector);
const toolExecutor = new ToolExecutor({
  toolRegistry,
  connectorRegistry,
  truthResolver,
  onLedger: event => record(event),
  onEvidence: evidence => record({ type: "EVIDENCE", ...evidence })
});

function rateAllowed(req) {
  const key = req.socket.remoteAddress || "local";
  const now = Date.now();
  const bucket = requestBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= rateWindowMs) { requestBuckets.set(key, { startedAt: now, count: 1 }); return true; }
  if (bucket.count >= rateLimitMax) return false;
  bucket.count += 1;
  return true;
}

const github = githubConnector.request.bind(githubConnector);

function planFor(message, repository, prNumber) {
  const plan = buildPlan({ message, repository: repository || defaultRepo, prNumber, normalizeRepository: repoName });
  plans.set(plan.id, plan);
  if (plan.approvalId) approvals.set(plan.approvalId, plan.id);
  record({ type: "PLAN_CREATED", intent: plan.intent, repository: plan.repository, pullRequest: plan.pullRequest, requestedAction: plan.intent === "merge_pull_request" ? "squash_merge" : "inspect", risk: plan.risk, planId: plan.id, approvalId: plan.approvalId });
  return plan;
}

async function verifyAndMerge(plan) {
  if (!plan.pullRequest) throw new PolicyError("رقم Pull Request مطلوب قبل الدمج", 400);
  const repo = repoName(plan.repository);
  const basePath = `/repos/${repo}`;
  const pr = await github(`${basePath}/pulls/${plan.pullRequest}`);
  record({ type: "TOOL_RESULT", tool: "github.get_pull_request", intent: plan.intent, repository: repo, pullRequest: plan.pullRequest, requestedAction: "squash_merge", result: "SUCCESS", risk: "READ_ONLY", planId: plan.id, approvalId: plan.approvalId });
  const checks = await github(`${basePath}/commits/${pr.head.sha}/check-runs`);
  const checkRuns = checks.check_runs || [];
  let protection = { protected: false };
  try { await github(`${basePath}/branches/${encodeURIComponent(pr.base.ref)}/protection`); protection = { protected: true }; } catch (error) { if (error.status !== 404) throw error; }
  const policy = evaluateMergePolicy({ pullRequest: pr, checkRuns, branchProtected: protection.protected });
  if (!policy.allowed) {
    record({ type: "POLICY_CHECK", intent: plan.intent, repository: repo, pullRequest: plan.pullRequest, requestedAction: "squash_merge", result: "BLOCKED", checksVerified: checkRuns.length > 0, branchPolicyVerified: protection.protected, target: pr.base.ref, risk: Risk.REQUIRES_APPROVAL, planId: plan.id, approvalId: plan.approvalId, error: policy.reason });
    throw new PolicyError(`${policy.reason}؛ تم منع الدمج`, 409);
  }
  record({ type: "POLICY_CHECK", intent: plan.intent, repository: repo, pullRequest: plan.pullRequest, requestedAction: "squash_merge", result: "SUCCESS", branchProtected: true, checksVerified: policy.checksVerified, branchPolicyVerified: policy.branchPolicyVerified, target: pr.base.ref, risk: Risk.REQUIRES_APPROVAL, planId: plan.id, approvalId: plan.approvalId });
  const merged = await github(`${basePath}/pulls/${plan.pullRequest}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "squash" }), headers: { "content-type": "application/json" } });
  if (!merged.merged) throw new PolicyError(merged.message || "رفض GitHub عملية الدمج", 409);
  const verification = truthResolver.assertVerified({ domain: TruthDomain.GITHUB_STATE, expected: { merged: true }, observed: merged, evidence: { source: "github_api", timestamp: new Date().toISOString(), executionId: plan.executionId, externalId: plan.pullRequest }, ledger: { executionId: plan.executionId } });
  return { repo, pr, merged, verification, checksVerified: true, branchPolicyVerified: true };
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/") && !rateAllowed(req)) return json(res, 429, { error: "طلبات كثيرة؛ حاول بعد دقيقة" });
  try {
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, mode: "mvp", githubConfigured: Boolean(githubToken), allowlistConfigured: allowedRepositories.size > 0, workspaceConfigured: Boolean(process.env.WORKSPACE_ROOT), cliExecutor: "allowlist", approvalGate: true });
    if (req.method === "GET" && url.pathname === "/api/ledger") {
      let entries = [];
      try { entries = (await readFile(ledgerFile, "utf8")).trim().split("\n").filter(Boolean).slice(-100).map(line => JSON.parse(line)); } catch {}
      return json(res, 200, { entries });
    }
    if (req.method === "GET" && url.pathname === "/") return text(res, 200, await readFile(frontend, "utf8"), "text/html; charset=utf-8");
    if (req.method === "POST" && url.pathname === "/api/plan") {
      const input = await bodyOf(req);
      return json(res, 200, planFor(input.message, input.repository, input.prNumber));
    }
    if (req.method === "GET" && url.pathname === "/api/github/repos") {
      if (!allowedRepositories.size) throw new PolicyError("اضبط GITHUB_ALLOWED_REPOSITORIES قبل قراءة المستودعات", 503);
      const repos = await github("/user/repos?sort=updated&per_page=30");
      return json(res, 200, repos.filter(repo => allowedRepositories.has(`${repo.owner.login}/${repo.name}`)));
    }
    const prMatch = url.pathname.match(/^\/api\/github\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/);
    if (req.method === "GET" && prMatch) {
      const repo = repoName(`${prMatch[1]}/${prMatch[2]}`);
      return json(res, 200, await github(`/repos/${repo}/pulls/${prMatch[3]}`));
    }
    const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
    if (req.method === "POST" && approvalMatch) {
      const approvalId = approvalMatch[1];
      const plan = plans.get(approvals.get(approvalId));
      const input = await bodyOf(req);
      const approved = assertApproval({ plan, approvalId, input });
      if (!approved) {
        assertPlanTransition(plan.state, PlanState.CANCELLED);
        plan.state = "CANCELLED";
        approvals.delete(approvalId);
        record({ type: "APPROVAL", approval: "DENIED", planId: plan.id, approvalId, intent: plan.intent, repository: plan.repository, pullRequest: plan.pullRequest, requestedAction: "squash_merge", risk: plan.risk });
        return json(res, 200, plan);
      }
      assertPlanTransition(plan.state, PlanState.RUNNING);
      plan.state = PlanState.RUNNING;
      plan.executionId = randomUUID();
      record({ type: "APPROVAL", approval: "APPROVED", planId: plan.id, approvalId, executionId: plan.executionId, intent: plan.intent, repository: plan.repository, pullRequest: plan.pullRequest, requestedAction: "squash_merge", risk: plan.risk });
      try {
        const result = await verifyAndMerge(plan);
        assertPlanTransition(plan.state, PlanState.COMPLETED);
        plan.state = PlanState.COMPLETED;
        plan.result = { merged: true, sha: result.merged.sha, url: result.pr.html_url, executionId: plan.executionId, checksVerified: result.checksVerified, branchPolicyVerified: result.branchPolicyVerified, verification: result.verification.status };
        approvals.delete(approvalId);
        record({ type: "EXECUTION", intent: plan.intent, repository: result.repo, pullRequest: plan.pullRequest, requestedAction: "squash_merge", result: "SUCCESS", exitCode: 0, executionId: plan.executionId, checksVerified: result.checksVerified, branchPolicyVerified: result.branchPolicyVerified, verification: result.verification.status, risk: plan.risk, planId: plan.id, approvalId });
        return json(res, 200, plan);
      } catch (error) {
        assertPlanTransition(plan.state, PlanState.BLOCKED);
        plan.state = PlanState.BLOCKED;
        plan.error = error.message;
        approvals.delete(approvalId);
        record({ type: "EXECUTION", intent: plan.intent, repository: plan.repository, pullRequest: plan.pullRequest, requestedAction: "squash_merge", result: "BLOCKED", exitCode: 1, executionId: plan.executionId, checksVerified: false, branchPolicyVerified: false, risk: plan.risk, planId: plan.id, approvalId, error: error.message });
        throw error;
      }
    }
    if (req.method === "POST" && url.pathname === "/api/tools/execute") {
      const input = await bodyOf(req);
      const execution = await toolRegistry.execute(input.tool, input, { actor: actorId, repository: defaultRepo }, toolExecutor);
      return json(res, 200, { tool: input.tool, ...execution.output, risk: execution.risk, executionId: execution.executionId, evidence: execution.evidence });
    }
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    return json(res, 404, { error: "المسار غير موجود" });
  } catch (error) {
    record({ type: "ERROR", result: "FAILED", error: error.message, status: error.status || 500 });
    return json(res, error.status || 500, { error: error.message, status: error.status || 500 });
  }
}

http.createServer(handle).listen(port, () => console.log(`Arabic DevOps MVP listening on http://localhost:${port}`));
