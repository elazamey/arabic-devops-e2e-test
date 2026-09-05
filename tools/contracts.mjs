import { PolicyError, Risk } from "../core/policy.mjs";

const types = new Set(["string", "number", "boolean", "object", "array"]);

export class ToolContract {
  constructor(definition) {
    if (!definition?.id || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(definition.id)) throw new TypeError("Tool id غير صالح");
    if (!definition.connector || !definition.operation) throw new TypeError(`Tool ${definition.id} يحتاج connector وoperation`);
    this.id = definition.id;
    this.name = definition.name || definition.id;
    this.description = definition.description || "";
    this.version = definition.version || "1.0.0";
    this.inputSchema = normalizeSchema(definition.inputSchema);
    this.outputSchema = definition.outputSchema || { type: "object" };
    this.permissions = Object.freeze([...(definition.permissions || [])]);
    this.riskLevel = definition.riskLevel || Risk.READ_ONLY;
    this.requiresApproval = definition.requiresApproval === true;
    this.connector = definition.connector;
    this.operation = definition.operation;
    this.timeout = Number(definition.timeout || 30_000);
    this.retryPolicy = Object.freeze({ retries: 0, ...(definition.retryPolicy || {}) });
    this.auditPolicy = Object.freeze({ eventType: "TOOL_EXECUTION", ...(definition.auditPolicy || {}) });
    this.metadata = Object.freeze({ ...(definition.metadata || {}) });
    Object.freeze(this);
  }
}

export function defineTool(definition) {
  return new ToolContract(definition);
}

export function validateToolInput(tool, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PolicyError("مدخلات الأداة يجب أن تكون كائنًا", 400);
  const schema = tool.inputSchema;
  for (const key of schema.required) if (!(key in input)) throw new PolicyError(`الحقل ${key} مطلوب للأداة ${tool.id}`, 400);
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(input)) if (!schema.properties[key]) throw new PolicyError(`الحقل ${key} غير مسموح للأداة ${tool.id}`, 400);
  }
  for (const [key, rule] of Object.entries(schema.properties)) {
    if (input[key] === undefined || input[key] === null) continue;
    if (rule.type && !types.has(rule.type)) throw new TypeError(`نوع schema غير مدعوم: ${rule.type}`);
    const actual = Array.isArray(input[key]) ? "array" : typeof input[key];
    if (rule.type && actual !== rule.type) throw new PolicyError(`نوع الحقل ${key} غير صالح للأداة ${tool.id}`, 400);
  }
  return true;
}

export function validateToolOutput(tool, output) {
  const schema = tool.outputSchema || {};
  if (schema.type) {
    const actual = Array.isArray(output) ? "array" : typeof output;
    if (actual !== schema.type) throw new PolicyError(`ناتج الأداة ${tool.id} لا يطابق outputSchema`, 502);
  }
  if (schema.required && output && typeof output === "object") {
    for (const key of schema.required) if (!(key in output)) throw new PolicyError(`ناتج الأداة ${tool.id} يفتقد الحقل ${key}`, 502);
  }
  return true;
}

function normalizeSchema(schema = {}) {
  return Object.freeze({
    type: schema.type || "object",
    properties: Object.freeze({ ...(schema.properties || {}) }),
    required: Object.freeze([...(schema.required || [])]),
    additionalProperties: schema.additionalProperties !== false
  });
}
