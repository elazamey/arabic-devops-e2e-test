import { PolicyError } from "./policy.mjs";

export const TruthDomain = Object.freeze({
  USER_INTENT: "user_intent",
  PLAN: "plan",
  AUTHORIZATION: "authorization",
  APPROVAL: "approval",
  TOOL: "tool",
  CONNECTOR: "connector",
  GITHUB_STATE: "github_state",
  GIT_STATE: "git_state",
  DEPLOYMENT_STATE: "deployment_state",
  EXECUTION_HISTORY: "execution_history",
  EVIDENCE: "evidence",
  CURRENT_SYSTEM_STATE: "current_system_state",
  MEMORY: "memory"
});

export const VerificationStatus = Object.freeze({
  OBSERVED: "OBSERVED",
  VERIFIED: "VERIFIED",
  CONFLICT: "CONFLICT"
});

const defaults = [
  [TruthDomain.USER_INTENT, { authority: "user_message", sources: ["user_message"], question: "intent" }],
  [TruthDomain.PLAN, { authority: "plan", sources: ["plan"], question: "intent" }],
  [TruthDomain.AUTHORIZATION, { authority: "policy", sources: ["policy"], question: "authorization" }],
  [TruthDomain.APPROVAL, { authority: "approval_record", sources: ["approval_record"], question: "authorization" }],
  [TruthDomain.TOOL, { authority: "tool_registry", sources: ["tool_registry"], question: "capability" }],
  [TruthDomain.CONNECTOR, { authority: "connector_registry", sources: ["connector_registry"], question: "capability" }],
  [TruthDomain.GITHUB_STATE, { authority: "github_api", sources: ["github", "github_api"], question: "state" }],
  [TruthDomain.GIT_STATE, { authority: "git", sources: ["git", "local"], question: "state" }],
  [TruthDomain.DEPLOYMENT_STATE, { authority: "deployment_api", sources: ["deployment_api", "cloudflare", "vercel"], question: "state" }],
  [TruthDomain.EXECUTION_HISTORY, { authority: "execution_ledger", sources: ["ledger"], question: "execution" }],
  [TruthDomain.EVIDENCE, { authority: "evidence_bundle", sources: ["evidence_bundle", "api_response"], question: "proof" }],
  [TruthDomain.CURRENT_SYSTEM_STATE, { authority: "external_system", sources: ["github_api", "git", "deployment_api"], question: "state" }],
  [TruthDomain.MEMORY, { authority: "memory", sources: ["memory"], question: "context" }]
];

export class SourceOfTruthResolver {
  constructor(definitions = defaults) {
    this.definitions = new Map(definitions.map(([domain, definition]) => [domain, normalizeDefinition(domain, definition)]));
  }

  register(domain, definition) {
    this.definitions.set(domain, normalizeDefinition(domain, definition));
    return this.resolve(domain);
  }

  resolve(domain) {
    const definition = this.definitions.get(domain);
    if (!definition) throw new PolicyError(`Truth domain غير معروف: ${domain}`, 500);
    return definition;
  }

  resolveQuestion(question) {
    const definition = [...this.definitions.values()].find(item => item.question === question);
    if (!definition) throw new PolicyError(`لا يوجد مصدر حقيقة للسؤال: ${question}`, 500);
    return definition;
  }

  observe({ domain, source, evidence = null, observed = null }) {
    const definition = this.resolve(domain);
    const accepted = definition.sources.includes(source);
    return {
      status: accepted ? VerificationStatus.OBSERVED : VerificationStatus.CONFLICT,
      domain,
      authority: definition.authority,
      source,
      authoritative: source === definition.authority,
      evidencePresent: Boolean(evidence),
      observed,
      reason: accepted ? null : `المصدر ${source} ليس مصدرًا مقبولًا لـ${domain}`
    };
  }

  verifyClaim({ domain, expected, observed, evidence, ledger = null }) {
    const observation = this.observe({ domain, source: evidence?.source, evidence, observed });
    if (observation.status === VerificationStatus.CONFLICT) return observation;
    if (!evidence?.timestamp) return { ...observation, status: VerificationStatus.CONFLICT, reason: "Evidence يحتاج timestamp" };
    if (!matches(expected, observed)) return { ...observation, status: VerificationStatus.CONFLICT, reason: "الادعاء لا يطابق الحالة الخارجية", expected };
    if (ledger && evidence.executionId && ledger.executionId && evidence.executionId !== ledger.executionId) {
      return { ...observation, status: VerificationStatus.CONFLICT, reason: "executionId مختلف بين Evidence وLedger" };
    }
    return { ...observation, status: VerificationStatus.VERIFIED, expected, verification: "external_claim_confirmed" };
  }

  assertVerified(input) {
    const result = this.verifyClaim(input);
    if (result.status !== VerificationStatus.VERIFIED) throw new PolicyError(result.reason || "تعذر إثبات الادعاء من المصدر السلطوي", 409);
    return result;
  }
}

function normalizeDefinition(domain, definition) {
  if (!domain || !definition?.authority || !definition.sources?.length) throw new TypeError(`تعريف Truth domain غير صالح: ${domain}`);
  return Object.freeze({ domain, authority: definition.authority, sources: Object.freeze([...definition.sources]), question: definition.question || "state" });
}

function matches(expected, actual) {
  if (expected === actual) return true;
  if (!expected || typeof expected !== "object" || !actual || typeof actual !== "object") return false;
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((value, index) => matches(value, actual[index]));
  return Object.entries(expected).every(([key, value]) => key in actual && matches(value, actual[key]));
}
