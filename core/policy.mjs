export class PolicyError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

export const Risk = Object.freeze({
  READ_ONLY: "READ_ONLY",
  REQUIRES_APPROVAL: "REQUIRES_APPROVAL",
  BLOCKED: "BLOCKED"
});

export const PlanState = Object.freeze({
  PLANNED: "PLANNED",
  WAITING_APPROVAL: "WAITING_APPROVAL",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  BLOCKED: "BLOCKED",
  CANCELLED: "CANCELLED"
});

const transitions = Object.freeze({
  PLANNED: ["WAITING_APPROVAL", "COMPLETED", "BLOCKED", "CANCELLED"],
  WAITING_APPROVAL: ["RUNNING", "CANCELLED", "BLOCKED"],
  RUNNING: ["COMPLETED", "BLOCKED"],
  COMPLETED: [],
  BLOCKED: [],
  CANCELLED: []
});

export function assertPlanTransition(current, next) {
  if (!transitions[current]?.includes(next)) throw new PolicyError(`انتقال حالة غير مسموح: ${current} → ${next}`, 409);
}

export function assertApproval({ plan, approvalId, input }) {
  if (!plan || plan.approvalId !== approvalId) throw new PolicyError("الموافقة غير موجودة أو انتهت صلاحيتها", 404);
  if (plan.state !== PlanState.WAITING_APPROVAL) throw new PolicyError(`الخطة ليست بانتظار موافقة: ${plan.state}`, 409);
  if (typeof input?.approved !== "boolean") throw new PolicyError("أرسل approved كقيمة منطقية صريحة", 400);
  if (!input.approved) return false;
  if (plan.risk !== Risk.REQUIRES_APPROVAL || plan.intent !== "merge_pull_request") throw new PolicyError("الخطة لا تملك مسار موافقة صالحًا", 403);
  return true;
}

export function evaluateMergePolicy({ pullRequest, checkRuns, branchProtected }) {
  if (pullRequest.state !== "open") return { allowed: false, reason: "Pull Request ليس مفتوحًا" };
  if (pullRequest.mergeable !== true || ["blocked", "dirty"].includes(pullRequest.mergeable_state)) return { allowed: false, reason: "قابلية الدمج غير مؤكدة أو محظورة" };
  if (!checkRuns.length) return { allowed: false, reason: "لا توجد فحوصات CI مكتملة" };
  if (checkRuns.some(check => check.status !== "completed" || check.conclusion !== "success")) return { allowed: false, reason: "فشل واحد أو أكثر من فحوصات CI" };
  if (!branchProtected) return { allowed: false, reason: "الفرع المستهدف غير محمي" };
  return { allowed: true, checksVerified: true, branchPolicyVerified: true };
}
