import { createHash, randomUUID } from "node:crypto";
import { PolicyError } from "./policy.mjs";
import { ExecutionContext, ToolResult } from "./execution-contracts.mjs";
import { validateToolOutput } from "../tools/contracts.mjs";
import { TruthDomain } from "./source-of-truth.mjs";

export class ToolExecutor {
  constructor({ toolRegistry, connectorRegistry, policy = async () => ({ allowed: true }), truthResolver = null, onLedger = async () => {}, onEvidence = async () => {} }) {
    this.tools = toolRegistry;
    this.connectors = connectorRegistry;
    this.policy = policy;
    this.truthResolver = truthResolver;
    this.onLedger = onLedger;
    this.onEvidence = onEvidence;
    this.replays = new Map();
  }

  async execute(toolId, request = {}, context = {}) {
    const { tool: ignored, approved, idempotencyKey, ...input } = request || {};
    const tool = this.tools.get(toolId);
    if (!tool) throw new PolicyError("الأداة غير موجودة في Tool Registry", 404);
    this.tools.validate(toolId, input);
    const authorization = this.tools.authorize(tool);
    const policyDecision = await this.policy({ tool, input, context, authorization });
    if (policyDecision?.allowed === false) throw new PolicyError(policyDecision.reason || "منعت Policy تنفيذ الأداة", 403);
    if (authorization.approvalRequired && approved !== true && context.approved !== true) throw new PolicyError("الأداة تحتاج موافقة صريحة", 403);

    const requestHash = hash({ tool: tool.id, input: redact(input) });
    if (idempotencyKey && this.replays.has(idempotencyKey)) {
      const previous = this.replays.get(idempotencyKey);
      await this.safeLedger({ type: "REPLAY_DETECTED", executionId: previous.executionId, tool: tool.id, connector: tool.connector, requestHash, result: "BLOCKED", risk: tool.riskLevel });
      return new ToolResult({ ...previous, replayed: true });
    }

    const connector = this.connectors.get(tool.connector);
    if (!connector) throw new PolicyError(`Connector غير موجود: ${tool.connector}`, 503);
    for (const permission of tool.permissions) {
      if (!connector.capabilities?.includes(permission)) throw new PolicyError(`Connector ${connector.id} لا يملك capability: ${permission}`, 403);
    }
    const executionId = context.executionId || randomUUID();
    const executionContext = new ExecutionContext({ ...context, approved: approved === true || context.approved === true, executionId, requestHash });
    try {
      const output = await retry(() => timeout(connector.execute(tool.operation, input, executionContext, tool), tool.timeout), tool.retryPolicy);
      validateToolOutput(tool, output);
      const result = resultStatus(output);
      const truthDomain = tool.metadata.truthDomain || defaultTruthDomain(connector.id);
      const verification = truthDomain && this.truthResolver ? this.truthResolver.observe({ domain: truthDomain, source: connector.id, observed: output }) : null;
      const evidence = this.evidenceFor({ executionId, tool, connector, input, output, requestHash, result, policyDecision, approved: executionContext.approved, actor: executionContext.actor, verification });
      await this.safeLedger({ type: tool.auditPolicy.eventType, executionId, tool: tool.id, connector: connector.id, source: connector.id, requestHash, result, risk: tool.riskLevel, approval: executionContext.approved ? "APPROVED" : "NOT_REQUIRED" });
      await this.safeEvidence(evidence);
      const execution = new ToolResult({ executionId, tool: tool.id, connector: connector.id, risk: tool.riskLevel, output, evidence, replayed: false });
      if (idempotencyKey) this.replays.set(idempotencyKey, execution);
      return execution;
    } catch (error) {
      const result = error.status && error.status < 500 ? "BLOCKED" : "FAILED";
      await this.safeLedger({ type: tool.auditPolicy.eventType, executionId, tool: tool.id, connector: connector.id, source: connector.id, requestHash, result, risk: tool.riskLevel, error: error.message });
      throw error;
    }
  }

  evidenceFor({ executionId, tool, connector, input, output, requestHash, result, policyDecision, approved, actor, verification }) {
    const safeOutput = redact(output);
    return {
      executionId,
      tool: tool.id,
      connector: connector.id,
      source: connector.id,
      operation: tool.operation,
      inputHash: requestHash,
      outputHash: hash(safeOutput),
      actor: actor || "runtime",
      timestamp: new Date().toISOString(),
      policyDecision: policyDecision?.decision || (policyDecision?.allowed === false ? "DENY" : "ALLOW"),
      approval: approved ? "APPROVED" : "NOT_REQUIRED",
      externalId: safeOutput?.id || safeOutput?.number || null,
      externalState: safeOutput?.state || safeOutput?.status || null,
      verification,
      result
    };
  }

  async safeLedger(event) {
    try { await this.onLedger(event); } catch {}
  }

  async safeEvidence(evidence) {
    try { await this.onEvidence(evidence); } catch {}
  }
}

function defaultTruthDomain(connectorId) {
  if (connectorId === "github") return TruthDomain.GITHUB_STATE;
  if (connectorId === "local") return TruthDomain.GIT_STATE;
  return null;
}

function resultStatus(output) {
  if (output && typeof output.exitCode === "number") return output.exitCode === 0 && !output.timedOut ? "SUCCESS" : "FAILED";
  return "SUCCESS";
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(sort(value))).digest("hex");
}

function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    /(token|secret|password|authorization|api.?key|private.?key|credential)/i.test(key) ? "[REDACTED]" : redact(child)
  ]));
}

async function retry(action, policy = {}) {
  const retries = Math.max(0, Number(policy.retries || 0));
  for (let attempt = 0; ; attempt += 1) {
    try { return await action(); } catch (error) {
      if (attempt >= retries || error.retryable !== true) throw error;
    }
  }
}

function timeout(promise, milliseconds) {
  if (!milliseconds) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new PolicyError("انتهت مهلة تنفيذ الأداة", 504)), milliseconds))
  ]);
}
