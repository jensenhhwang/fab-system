import type { OperationProposalStatus } from "@/lib/operations-monitor-server";

export type OperationProposalDecision = "APPROVE" | "REJECT";

export class OperationImprovementTransitionError extends Error {
  readonly code = "INVALID_PROPOSAL_TRANSITION";

  constructor(current: OperationProposalStatus, decision: OperationProposalDecision) {
    super(`INVALID_PROPOSAL_TRANSITION: ${current} 상태에서 ${decision}할 수 없습니다.`);
    this.name = "OperationImprovementTransitionError";
  }
}

export function decideProposalTransition(input: {
  current: OperationProposalStatus;
  decision: OperationProposalDecision;
  changeKind: "ALLOWLIST_ACTION" | "CODE_OR_POLICY_CHANGE";
}): { next: "APPLYING" | "APPROVED" | "REJECTED"; execute: boolean } {
  if (input.current !== "PROPOSED") {
    throw new OperationImprovementTransitionError(input.current, input.decision);
  }
  if (input.decision === "REJECT") return { next: "REJECTED", execute: false };
  if (input.changeKind === "ALLOWLIST_ACTION") return { next: "APPLYING", execute: true };
  return { next: "APPROVED", execute: false };
}
