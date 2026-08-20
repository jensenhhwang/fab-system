import assert from "node:assert/strict";
import { decideProposalTransition } from "../src/lib/operation-improvement";

assert.deepEqual(
  decideProposalTransition({ current: "PROPOSED", decision: "APPROVE", changeKind: "ALLOWLIST_ACTION" }),
  { next: "APPLYING", execute: true },
);
assert.deepEqual(
  decideProposalTransition({ current: "PROPOSED", decision: "APPROVE", changeKind: "CODE_OR_POLICY_CHANGE" }),
  { next: "APPROVED", execute: false },
);
assert.deepEqual(
  decideProposalTransition({ current: "PROPOSED", decision: "REJECT", changeKind: "ALLOWLIST_ACTION" }),
  { next: "REJECTED", execute: false },
);
assert.throws(
  () => decideProposalTransition({ current: "REJECTED", decision: "APPROVE", changeKind: "ALLOWLIST_ACTION" }),
  /INVALID_PROPOSAL_TRANSITION/,
);

console.log("✅ 운영 개선 승인 상태 전이 테스트 통과");
