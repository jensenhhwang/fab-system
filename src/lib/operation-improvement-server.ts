import { createHash } from "node:crypto";
import { collections } from "@/lib/db";
import { createInventoryScaleUpDraftForMaterial, previewInventoryScaleUpDraftForMaterial } from "@/lib/inventory-scaleup-service";
import { decideProposalTransition, type OperationProposalDecision } from "@/lib/operation-improvement";
import {
  operationCollections,
  type OperationLearningProposalDoc,
  type OperationPolicyRevisionDoc,
} from "@/lib/operations-monitor-server";

export type OperationImprovementErrorCode =
  | "PROPOSAL_NOT_FOUND"
  | "PROPOSAL_ALREADY_DECIDED"
  | "PROPOSAL_APPLYING"
  | "OPERATION_PROPOSAL_STALE"
  | "ACTION_NOT_ALLOWED";

export class OperationImprovementError extends Error {
  constructor(public readonly code: OperationImprovementErrorCode, message: string) {
    super(message);
    this.name = "OperationImprovementError";
  }
}

type ApplyResult = NonNullable<OperationLearningProposalDoc["applyResult"]>;
export type OperationImprovementExecutor = (
  proposal: OperationLearningProposalDoc,
  context: { userId: string; requestId: string; now: Date },
) => Promise<ApplyResult>;

export type OperationImprovementDecisionResult = {
  proposal: OperationLearningProposalDoc;
  revision: OperationPolicyRevisionDoc;
  duplicate: boolean;
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function proposalPreviewHash(proposal: OperationLearningProposalDoc): string {
  return hash(JSON.stringify({ change: proposal.change, evidenceRefs: proposal.evidenceRefs }));
}

function revisionId(proposalId: string, decision: OperationProposalDecision, requestId: string): string {
  return hash(`${proposalId}:${decision}:${requestId}`);
}

async function defaultExecutor(
  proposal: OperationLearningProposalDoc,
  context: { userId: string; requestId: string; now: Date },
): Promise<ApplyResult> {
  const actionType = proposal.change.actionType;
  const targetId = proposal.change.targetId;

  if (actionType === "CREATE_INBOUND_PLAN_DRAFT") {
    const preview = await previewInventoryScaleUpDraftForMaterial(targetId, context.now);
    const result = await createInventoryScaleUpDraftForMaterial({
      materialId: targetId,
      userId: context.userId,
      actionId: context.requestId,
      expectedPreviewHash: preview.previewHash,
      now: context.now,
    });
    return {
      status: "ACTIVE",
      actionType,
      targetId,
      planId: result.plan._id,
      duplicate: result.duplicate,
    };
  }

  if (actionType === "APPROVE_PURCHASE_ORDER") {
    const { decideTwinPurchaseOrder } = await import("@/lib/twin/purchase-order-decision-server");
    const { twinPurchaseOrders } = await collections();
    const current = await twinPurchaseOrders.findOne({ _id: targetId });
    if (current?.status === "ORDERED") {
      return { status: "ACTIVE", actionType, targetId, purchaseOrderStatus: current.status, duplicate: true };
    }
    const order = await decideTwinPurchaseOrder({
      purchaseOrderId: targetId,
      action: "APPROVE",
      actorId: context.userId,
    });
    return { status: "ACTIVE", actionType, targetId, purchaseOrderStatus: order.status, duplicate: false };
  }

  if (actionType === "RELEASE_INBOUND_HOLD") {
    const { releaseTwinInboundHold } = await import("@/lib/twin/inbound-hold-decision-server");
    const { twinPurchaseOrders } = await collections();
    const current = await twinPurchaseOrders.findOne({ _id: targetId });
    if (current?.status === "RECEIVED") {
      return { status: "ACTIVE", actionType, targetId, purchaseOrderStatus: current.status, duplicate: true };
    }
    const order = await releaseTwinInboundHold({ purchaseOrderId: targetId, actorId: context.userId });
    return { status: "ACTIVE", actionType, targetId, purchaseOrderStatus: order.status, duplicate: false };
  }

  throw new OperationImprovementError("ACTION_NOT_ALLOWED", `허용되지 않은 운영 조치입니다: ${actionType}`);
}

async function getExistingResult(
  proposal: OperationLearningProposalDoc,
  decision: OperationProposalDecision,
  requestId: string,
): Promise<OperationImprovementDecisionResult> {
  if (proposal.requestId !== requestId) {
    throw new OperationImprovementError("PROPOSAL_ALREADY_DECIDED", "이미 다른 요청으로 결정된 개선안입니다.");
  }
  if (proposal.status === "APPLYING") {
    throw new OperationImprovementError("PROPOSAL_APPLYING", "개선안을 적용하고 있습니다.");
  }
  const { revisions } = await operationCollections();
  const revision = await revisions.findOne({ _id: revisionId(proposal._id, decision, requestId), scope: proposal.scope });
  if (!revision) {
    throw new OperationImprovementError("PROPOSAL_ALREADY_DECIDED", "결정 원장이 아직 완료되지 않았습니다.");
  }
  return { proposal, revision, duplicate: true };
}

export async function decideOperationImprovement(input: {
  proposalId: string;
  decision: OperationProposalDecision;
  reason: string;
  userId: string;
  requestId: string;
  now?: Date;
  scope?: string;
  executor?: OperationImprovementExecutor;
}): Promise<OperationImprovementDecisionResult> {
  const now = input.now ?? new Date();
  const scope = input.scope ?? "LIVE";
  const { incidents, proposals, revisions } = await operationCollections();
  const existing = await proposals.findOne({ _id: input.proposalId, scope });
  if (!existing) throw new OperationImprovementError("PROPOSAL_NOT_FOUND", "개선안을 찾을 수 없습니다.");
  if (existing.status !== "PROPOSED") {
    return getExistingResult(existing, input.decision, input.requestId);
  }
  if (proposalPreviewHash(existing) !== existing.previewHash) {
    throw new OperationImprovementError("OPERATION_PROPOSAL_STALE", "개선안 내용이 생성 이후 변경되었습니다.");
  }
  const activeIncident = await incidents.findOne({
    _id: { $in: existing.incidentIds },
    scope,
    status: { $in: ["OBSERVED", "ANALYZED", "PROPOSED"] },
  });
  if (!activeIncident) {
    throw new OperationImprovementError("OPERATION_PROPOSAL_STALE", "원인이 이미 회복되어 더는 적용할 수 없는 개선안입니다.");
  }

  const transition = decideProposalTransition({
    current: existing.status,
    decision: input.decision,
    changeKind: existing.change.kind,
  });
  const awaitingImplementation = transition.next === "APPROVED"
    ? { status: "AWAITING_IMPLEMENTATION" }
    : null;
  const claimed = await proposals.findOneAndUpdate(
    { _id: input.proposalId, scope, status: "PROPOSED", previewHash: existing.previewHash },
    {
      $set: {
        status: transition.next,
        decidedAt: now,
        decidedBy: input.userId,
        decisionReason: input.reason,
        requestId: input.requestId,
        updatedAt: now,
        applyResult: awaitingImplementation,
      },
    },
    { returnDocument: "after" },
  );
  if (!claimed) {
    const raced = await proposals.findOne({ _id: input.proposalId, scope });
    if (!raced) throw new OperationImprovementError("PROPOSAL_NOT_FOUND", "개선안을 찾을 수 없습니다.");
    return getExistingResult(raced, input.decision, input.requestId);
  }

  let proposal = claimed;
  if (transition.execute) {
    try {
      const applyResult = await (input.executor ?? defaultExecutor)(claimed, {
        userId: input.userId,
        requestId: input.requestId,
        now,
      });
      const active = await proposals.findOneAndUpdate(
        { _id: claimed._id, scope, status: "APPLYING", requestId: input.requestId },
        { $set: { status: "ACTIVE", applyResult, updatedAt: new Date() } },
        { returnDocument: "after" },
      );
      if (active) proposal = active;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const failed = await proposals.findOneAndUpdate(
        { _id: claimed._id, scope, status: "APPLYING", requestId: input.requestId },
        { $set: { status: "FAILED", applyResult: { status: "FAILED", error: message }, updatedAt: new Date() } },
        { returnDocument: "after" },
      );
      if (failed) proposal = failed;
    }
  }

  const revision: OperationPolicyRevisionDoc = {
    _id: revisionId(proposal._id, input.decision, input.requestId),
    scope: proposal.scope,
    proposalId: proposal._id,
    decision: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
    decidedBy: input.userId,
    decidedAt: now,
    recordedAt: new Date(),
    reason: input.reason,
    previousVersion: proposal.policyVersion,
    newVersion: null,
    applyResult: proposal.applyResult,
    verificationResult: null,
  };
  await revisions.updateOne(
    { _id: revision._id, scope: revision.scope },
    { $setOnInsert: revision },
    { upsert: true },
  );
  const storedRevision = await revisions.findOne({ _id: revision._id, scope: revision.scope });
  if (!storedRevision) throw new Error("OPERATION_REVISION_WRITE_FAILED");
  return { proposal, revision: storedRevision, duplicate: false };
}
