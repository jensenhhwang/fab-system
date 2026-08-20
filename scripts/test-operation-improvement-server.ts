import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getMongoClient } from "../src/lib/db";
import {
  decideOperationImprovement,
  OperationImprovementError,
  type OperationImprovementExecutor,
} from "../src/lib/operation-improvement-server";
import {
  ensureOperationMonitorIndexes,
  operationCollections,
  type OperationIncidentDoc,
  type OperationLearningProposalDoc,
} from "../src/lib/operations-monitor-server";

const scope = "TEST-OPIM";
const now = new Date("2026-08-20T12:00:00.000Z");

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function proposal(idSeed: string, kind: "ALLOWLIST_ACTION" | "CODE_OR_POLICY_CHANGE"): OperationLearningProposalDoc {
  const change = {
    kind,
    actionType: kind === "ALLOWLIST_ACTION" ? "CREATE_INBOUND_PLAN_DRAFT" : "REVIEW_POLICY",
    targetId: `TEST-OPIM-${idSeed}`,
    before: { value: 0 },
    after: { value: 1 },
  } as const;
  const evidenceRefs = [sha(`evidence:${idSeed}`)];
  return {
    _id: sha(`proposal:${idSeed}`),
    scope,
    incidentIds: [sha(`incident:${idSeed}`)],
    kind: "MATERIAL_STOCKOUT",
    status: "PROPOSED",
    proposedByRole: "PROCUREMENT",
    change,
    expectedEffects: ["test"],
    risks: ["test"],
    evidenceRefs,
    validationPlan: ["test"],
    rollbackPlan: ["test"],
    previewHash: sha(JSON.stringify({ change, evidenceRefs })),
    policyVersion: "TEST_V1",
    createdAt: now,
    updatedAt: now,
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    applyResult: null,
    requestId: null,
  };
}

function incident(doc: OperationLearningProposalDoc): OperationIncidentDoc {
  return {
    _id: doc.incidentIds[0],
    scope,
    fingerprint: sha(`fingerprint:${doc._id}`),
    kind: doc.kind,
    severity: "CRITICAL",
    status: "PROPOSED",
    summary: "test",
    affectedRoles: ["PROCUREMENT"],
    policyVersions: [doc.policyVersion],
    firstObservedAt: now,
    lastObservedAt: now,
    recordedAt: now,
    operatingEpochMs: 0,
    observationCount: 2,
    normalObservationCount: 0,
    latestEvidence: {},
    worstEvidence: {},
    releaseCondition: "test",
    proposalId: doc._id,
    recoveredAt: null,
  };
}

async function cleanup() {
  const { incidents, proposals, revisions } = await operationCollections();
  await Promise.all([incidents.deleteMany({ scope }), proposals.deleteMany({ scope }), revisions.deleteMany({ scope })]);
}

async function main() {
  await cleanup();
  try {
    await ensureOperationMonitorIndexes();
    const { incidents, proposals, revisions } = await operationCollections();
    const codeProposal = proposal("CODE", "CODE_OR_POLICY_CHANGE");
    const actionProposal = proposal("ACTION", "ALLOWLIST_ACTION");
    const staleProposal = proposal("STALE", "ALLOWLIST_ACTION");
    staleProposal.previewHash = "0".repeat(64);
    await proposals.insertMany([codeProposal, actionProposal, staleProposal]);
    await incidents.insertMany([incident(codeProposal), incident(actionProposal), incident(staleProposal)]);

    let executeCount = 0;
    const executor: OperationImprovementExecutor = async (doc) => {
      executeCount += 1;
      return { status: "ACTIVE", targetId: doc.change.targetId, execution: executeCount };
    };

    const approvedCode = await decideOperationImprovement({
      proposalId: codeProposal._id,
      scope,
      decision: "APPROVE",
      reason: "코드 검토 승인",
      userId: "TEST-ADMIN",
      requestId: "11111111-1111-4111-8111-111111111111",
      now,
      executor,
    });
    assert.equal(approvedCode.proposal.status, "APPROVED");
    assert.equal(approvedCode.proposal.applyResult?.status, "AWAITING_IMPLEMENTATION");
    assert.equal(executeCount, 0, "코드·정책 제안은 앱이 자동 실행하면 안 된다");

    const requestId = "22222222-2222-4222-8222-222222222222";
    const applied = await decideOperationImprovement({
      proposalId: actionProposal._id,
      scope,
      decision: "APPROVE",
      reason: "운영 조치 승인",
      userId: "TEST-ADMIN",
      requestId,
      now,
      executor,
    });
    assert.equal(applied.proposal.status, "ACTIVE");
    assert.equal(executeCount, 1);

    const duplicate = await decideOperationImprovement({
      proposalId: actionProposal._id,
      scope,
      decision: "APPROVE",
      reason: "운영 조치 승인 재시도",
      userId: "TEST-ADMIN",
      requestId,
      now,
      executor,
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(executeCount, 1, "같은 requestId 재시도는 다시 실행하면 안 된다");

    await assert.rejects(
      decideOperationImprovement({
        proposalId: actionProposal._id,
        scope,
        decision: "APPROVE",
        reason: "다른 요청",
        userId: "TEST-ADMIN",
        requestId: "33333333-3333-4333-8333-333333333333",
        now,
        executor,
      }),
      (error: unknown) => error instanceof OperationImprovementError && error.code === "PROPOSAL_ALREADY_DECIDED",
    );

    await assert.rejects(
      decideOperationImprovement({
        proposalId: staleProposal._id,
        scope,
        decision: "APPROVE",
        reason: "stale 차단",
        userId: "TEST-ADMIN",
        requestId: "44444444-4444-4444-8444-444444444444",
        now,
        executor,
      }),
      (error: unknown) => error instanceof OperationImprovementError && error.code === "OPERATION_PROPOSAL_STALE",
    );
    assert.equal(await revisions.countDocuments({ scope }), 2, "결정마다 revision 한 건만 남아야 한다");

    console.log("✅ 운영 개선 승인·idempotency 원장 테스트 통과");
  } finally {
    await cleanup();
    await (await getMongoClient()).close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
