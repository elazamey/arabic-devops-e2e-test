import { appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export function createLedgerRecord(event, actor) {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    planId: null,
    approvalId: null,
    actor,
    intent: null,
    repository: null,
    pullRequest: null,
    requestedAction: null,
    risk: "UNKNOWN",
    checksVerified: null,
    branchPolicyVerified: null,
    ...event,
    actor
  };
}

export function appendLedgerRecord(file, record) {
  return appendFile(file, JSON.stringify(record) + "\n").catch(() => {});
}
