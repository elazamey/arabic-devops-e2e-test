import assert from "node:assert/strict";
import { SourceOfTruthResolver, ToolExecutor, ToolResult, TruthDomain, VerificationStatus } from "./core/index.mjs";
import { ConnectorRegistry } from "./connectors/registry.mjs";
import { GitHubConnector } from "./connectors/github/connector.mjs";
import { ToolRegistry, registerBuiltInTools } from "./tools/registry.mjs";
import { Risk } from "./core/policy.mjs";

class MockConnector {
  constructor() {
    this.id = "mock";
    this.name = "Mock Connector";
    this.capabilities = ["mock:read", "mock:write"];
    this.calls = 0;
  }

  async authenticate() { return { authenticated: true, credential: "mock" }; }
  async health() { return { ok: true }; }
  async close() {}
  async execute(operation, input) {
    this.calls += 1;
    return { id: "external-1", state: "complete", operation, value: input.value };
  }
}

const tools = new ToolRegistry();
registerBuiltInTools(tools);
tools.register({
  id: "mock.read",
  connector: "mock",
  operation: "read",
  inputSchema: { type: "object", required: ["value"], properties: { value: { type: "string" } }, additionalProperties: false },
  permissions: ["mock:read"],
  riskLevel: Risk.READ_ONLY
});
tools.register({
  id: "mock.write",
  connector: "mock",
  operation: "write",
  inputSchema: { type: "object", required: ["value"], properties: { value: { type: "string" } }, additionalProperties: false },
  permissions: ["mock:write"],
  riskLevel: Risk.REQUIRES_APPROVAL,
  requiresApproval: true
});

const connectors = new ConnectorRegistry();
const mock = new MockConnector();
connectors.register(mock);
connectors.register(new GitHubConnector({ token: "test-token", fetchImpl: async () => ({ ok: true, json: async () => ({ number: 7, state: "open" }) }) }));
const ledger = [];
const evidence = [];
const truthResolver = new SourceOfTruthResolver();
const executor = new ToolExecutor({
  toolRegistry: tools,
  connectorRegistry: connectors,
  truthResolver,
  onLedger: event => ledger.push(event),
  onEvidence: item => evidence.push(item)
});

const first = await tools.execute("mock.read", { tool: "mock.read", value: "safe", idempotencyKey: "exec-1" }, { actor: "architecture-test" }, executor);
assert.ok(first instanceof ToolResult);
assert.equal(first.output.state, "complete");
assert.equal(first.evidence.result, "SUCCESS");
assert.equal(evidence.length, 1);

const replay = await tools.execute("mock.read", { tool: "mock.read", value: "safe", idempotencyKey: "exec-1" }, { actor: "architecture-test" }, executor);
assert.equal(replay.replayed, true);
assert.equal(mock.calls, 1);
assert.ok(ledger.some(event => event.type === "REPLAY_DETECTED"));

const githubRead = await tools.execute("github.get_pull_request", { tool: "github.get_pull_request", repository: "acme/storefront", number: 7 }, { actor: "architecture-test" }, executor);
assert.equal(githubRead.output.number, 7);
assert.equal(githubRead.connector, "github");
assert.equal(githubRead.evidence.verification.status, VerificationStatus.OBSERVED);

const verified = truthResolver.verifyClaim({
  domain: TruthDomain.GITHUB_STATE,
  expected: { merged: true },
  observed: { merged: true, sha: "merge-7" },
  evidence: { source: "github_api", timestamp: new Date().toISOString(), executionId: "exec-merge" },
  ledger: { executionId: "exec-merge" }
});
assert.equal(verified.status, VerificationStatus.VERIFIED);
const conflict = truthResolver.verifyClaim({
  domain: TruthDomain.GITHUB_STATE,
  expected: { merged: true },
  observed: { state: "open" },
  evidence: { source: "memory", timestamp: new Date().toISOString() }
});
assert.equal(conflict.status, VerificationStatus.CONFLICT);

await assert.rejects(
  () => tools.execute("mock.write", { tool: "mock.write", value: "write" }, {}, executor),
  error => error.status === 403
);
assert.equal(tools.get("github.get_pull_request").connector, "github");
assert.equal(tools.get("github.merge_pull_request").requiresApproval, true);

console.log(JSON.stringify({ status: "PASS", checks: ["contracts", "registry", "mock-connector", "executor", "approval", "replay", "evidence"] }, null, 2));
