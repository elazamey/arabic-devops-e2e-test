import { randomUUID } from "node:crypto";
import { PolicyError, Risk, PlanState } from "./policy.mjs";

export function arabicDigits(value) {
  return String(value || "").replace(/[٠-٩]/g, digit => "٠١٢٣٤٥٦٧٨٩".indexOf(digit));
}

export function buildPlan({ message, repository, prNumber, normalizeRepository }) {
  const text = String(message || "");
  const mergeIntent = /دمج|ادمج|merge/i.test(text);
  const match = arabicDigits(text).match(/(?:PR|pull request|طلب السحب)?\s*#?\s*(\d+)/i);
  const number = Number(prNumber || (match && match[1]) || 0);
  const repo = normalizeRepository(repository);
  if (mergeIntent && !number) throw new PolicyError("حدد رقم Pull Request قبل طلب الدمج", 400);
  const id = randomUUID();
  const approvalId = mergeIntent ? randomUUID() : null;
  return {
    id,
    approvalId,
    state: mergeIntent ? PlanState.WAITING_APPROVAL : PlanState.PLANNED,
    intent: mergeIntent ? "merge_pull_request" : "inspect_repository",
    repository: repo,
    pullRequest: number || null,
    risk: mergeIntent ? Risk.REQUIRES_APPROVAL : Risk.READ_ONLY,
    createdAt: new Date().toISOString(),
    steps: mergeIntent ? [
      { tool: "github.get_pull_request", label: "قراءة تفاصيل Pull Request والفرع المستهدف", state: "PENDING" },
      { tool: "github.get_checks", label: "التحقق من جميع فحوصات CI", state: "PENDING" },
      { tool: "github.get_branch_protection", label: "التحقق من حماية الفرع وسياسة الدمج", state: "PENDING" },
      { tool: "policy.evaluate", label: "تقييم القابلية للدمج", state: "PENDING" },
      { tool: "github.merge_pull_request", label: "دمج PR بطريقة Squash بعد الموافقة", state: "PENDING" }
    ] : [
      { tool: "git.status", label: "قراءة حالة مساحة العمل", state: "PENDING" },
      { tool: "github.list_pull_requests", label: "قراءة Pull Requests المتاحة", state: "PENDING" }
    ]
  };
}
