import { PolicyError, Risk } from "../core/policy.mjs";
import { defineTool, ToolContract, validateToolInput } from "./contracts.mjs";

export const CLI_REGISTRY = Object.freeze({
  "git.status": Object.freeze({ bin: "git", args: ["status", "--short", "--branch"], risk: Risk.READ_ONLY }),
  "git.log": Object.freeze({ bin: "git", args: ["log", "-n", "10", "--oneline"], risk: Risk.READ_ONLY }),
  "git.diff": Object.freeze({ bin: "git", args: ["diff", "--stat"], risk: Risk.READ_ONLY }),
  "gh.pr.list": Object.freeze({ bin: "gh", args: ["pr", "list", "--limit", "10"], risk: Risk.READ_ONLY }),
  "gh.run.list": Object.freeze({ bin: "gh", args: ["run", "list", "--limit", "10"], risk: Risk.READ_ONLY })
});

export class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(definition) {
    const tool = definition instanceof ToolContract ? definition : defineTool(definition);
    if (this.tools.has(tool.id)) throw new Error(`Tool مسجل مسبقًا: ${tool.id}`);
    this.tools.set(tool.id, tool);
    return tool;
  }

  unregister(id) {
    return this.tools.delete(id);
  }

  get(id) {
    return this.tools.get(id) || null;
  }

  list() {
    return [...this.tools.values()];
  }

  validate(id, input) {
    const tool = this.get(id);
    if (!tool) throw new PolicyError("الأداة غير موجودة في Tool Registry", 404);
    validateToolInput(tool, input);
    return tool;
  }

  authorize(tool) {
    if (tool.riskLevel === Risk.BLOCKED) throw new PolicyError(`الأداة محظورة: ${tool.id}`, 403);
    return { allowed: true, risk: tool.riskLevel, approvalRequired: tool.requiresApproval };
  }

  execute(id, input, context, executor) {
    if (!executor?.execute) throw new TypeError("ToolExecutor مطلوب لتنفيذ الأداة");
    return executor.execute(id, input, context);
  }
}

export function registerBuiltInTools(registry) {
  for (const [id, command] of Object.entries(CLI_REGISTRY)) {
    registry.register({
      id,
      name: id,
      description: `تنفيذ ${id} من القائمة المسموحة`,
      connector: "local",
      operation: "run_allowlisted",
      inputSchema: { type: "object", properties: { cwd: { type: "string" } }, additionalProperties: false },
      permissions: ["workspace:read"],
      riskLevel: Risk.READ_ONLY,
      requiresApproval: false,
      timeout: 30_000,
      auditPolicy: { eventType: "CLI_EXECUTION" },
      metadata: { command }
    });
  }

  for (const tool of githubTools()) registry.register(tool);
  return registry;
}

export function getTool(name, registry) {
  return registry ? registry.get(name) : CLI_REGISTRY[name] || null;
}

export function assertRegistryInput(input, spec) {
  if (!spec) throw new Error("الأداة غير موجودة في Tool Registry");
  if (input.args !== undefined) throw new Error("الحجج الحرة غير مسموحة؛ استخدم Tool Registry");
  if (spec instanceof ToolContract) {
    const { tool: ignored, approved, idempotencyKey, ...toolInput } = input;
    validateToolInput(spec, toolInput);
  }
}

function githubTools() {
  const read = { connector: "github", permissions: ["github:read"], riskLevel: Risk.READ_ONLY, requiresApproval: false, timeout: 30_000, inputSchema: { type: "object", additionalProperties: false } };
  const write = { connector: "github", permissions: ["github:write"], riskLevel: Risk.REQUIRES_APPROVAL, requiresApproval: true, timeout: 30_000, inputSchema: { type: "object", additionalProperties: false } };
  return [
    { ...read, id: "github.get_repository", operation: "get_repository", inputSchema: schema(["repository"], { repository: { type: "string" } }) },
    { ...read, id: "github.get_branch", operation: "get_branch", inputSchema: schema(["repository", "branch"], { repository: { type: "string" }, branch: { type: "string" } }) },
    { ...read, id: "github.get_pull_request", operation: "get_pull_request", inputSchema: schema(["repository", "number"], { repository: { type: "string" }, number: { type: "number" } }) },
    { ...read, id: "github.get_checks", operation: "get_checks", inputSchema: schema(["repository", "sha"], { repository: { type: "string" }, sha: { type: "string" } }) },
    { ...write, id: "github.create_branch", operation: "create_branch", inputSchema: schema(["repository", "branch", "sha"], { repository: { type: "string" }, branch: { type: "string" }, sha: { type: "string" } }) },
    { ...write, id: "github.create_pull_request", operation: "create_pull_request", inputSchema: schema(["repository", "title", "head", "base"], { repository: { type: "string" }, title: { type: "string" }, head: { type: "string" }, base: { type: "string" }, body: { type: "string" } }) },
    { ...write, id: "github.comment_pull_request", operation: "comment_pull_request", inputSchema: schema(["repository", "number", "body"], { repository: { type: "string" }, number: { type: "number" }, body: { type: "string" } }) },
    { ...write, id: "github.merge_pull_request", operation: "merge_pull_request", inputSchema: schema(["repository", "number"], { repository: { type: "string" }, number: { type: "number" } }) }
  ];
}

function schema(required, properties) {
  return { type: "object", required, properties, additionalProperties: false };
}
