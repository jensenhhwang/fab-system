import "server-only";

import { createHash, randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import type {
  ControlTowerAskActionPreview,
  ControlTowerAskActionResult,
  ControlTowerAskActionSuggestion,
} from "@/lib/control-tower-ask";
import {
  createInventoryScaleUpDraftForMaterial,
  InventoryScaleUpDraftError,
  previewInventoryScaleUpDraftForMaterial,
} from "@/lib/inventory-scaleup-service";

const PREVIEW_TTL_MS = 5 * 60_000;

type MessageSourceDoc = {
  _id: string;
  userId: string;
  threadId: string;
  status: "PROCESSING" | "ANSWERED" | "FAILED";
  answer?: { actionSuggestion?: ControlTowerAskActionSuggestion | null } | null;
  evidence?: Array<{ ref: string }>;
  action?: Omit<ControlTowerAskActionResult, "executedAt"> & { executedAt: Date } | null;
};

type ThreadSourceDoc = {
  _id: string;
  userId: string;
  snapshotHash: string;
  expiresAt: Date;
};

type ProposalDoc = {
  _id: string;
  userId: string;
  messageId: string;
  threadId: string;
  actionType: "CREATE_INBOUND_PLAN_DRAFT";
  targetRef: string;
  reason: string;
  materialId: string;
  sourceSnapshotHash: string;
  sourceExpiresAt: Date;
  status: "PREVIEWED" | "EXECUTED" | "BLOCKED";
  previewHash: string;
  previewTokenHash: string;
  previewExpiresAt: Date;
  previewedAt: Date;
  executedAt: Date | null;
  executedBy: string | null;
  executeRequestId: string | null;
  inboundPlanId: string | null;
  planNo: string | null;
  blockedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export class ControlTowerAskActionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
  ) {
    super(message);
    this.name = "ControlTowerAskActionError";
  }
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isDuplicateKey(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: number }).code === 11000,
  );
}

function materialCodeFromRef(ref: string) {
  if (/^MATERIALS:[^:]+$/.test(ref)) return ref.slice("MATERIALS:".length);
  if (/^PROCUREMENT:RULE:[^:]+$/.test(ref)) return ref.slice("PROCUREMENT:RULE:".length);
  return null;
}

function normalizeDomainError(error: unknown) {
  if (error instanceof ControlTowerAskActionError) return error;
  if (error instanceof InventoryScaleUpDraftError) {
    return new ControlTowerAskActionError(error.code, error.message, 409);
  }
  return new ControlTowerAskActionError(
    "CONTROL_TOWER_ACTION_FAILED",
    error instanceof Error ? error.message : "입고계획 초안을 처리하지 못했습니다.",
    500,
  );
}

async function sourceFor(userId: string, messageId: string) {
  const db = await getDb();
  const message = await db.collection<MessageSourceDoc>("controlTowerAskMessages").findOne({
    _id: messageId,
    userId,
  });
  if (!message || message.status !== "ANSWERED" || !message.answer?.actionSuggestion) {
    throw new ControlTowerAskActionError(
      "CONTROL_TOWER_ACTION_NOT_AVAILABLE",
      "이 답변에는 실행 가능한 입고계획 제안이 없습니다.",
      404,
    );
  }
  if (message.action) {
    throw new ControlTowerAskActionError(
      "CONTROL_TOWER_ACTION_ALREADY_EXECUTED",
      `이미 ${message.action.planNo} 초안이 생성되었습니다.`,
      409,
    );
  }
  const suggestion = message.answer.actionSuggestion;
  if (
    suggestion.actionType !== "CREATE_INBOUND_PLAN_DRAFT"
    || !message.evidence?.some((fact) => fact.ref === suggestion.targetRef)
  ) {
    throw new ControlTowerAskActionError(
      "CONTROL_TOWER_ACTION_EVIDENCE_INVALID",
      "답변 근거와 실행 대상이 일치하지 않습니다.",
      409,
    );
  }
  const materialCode = materialCodeFromRef(suggestion.targetRef);
  if (!materialCode) {
    throw new ControlTowerAskActionError(
      "CONTROL_TOWER_ACTION_TARGET_INVALID",
      "입고계획 대상으로 해석할 수 없는 근거입니다.",
      409,
    );
  }
  const [thread, material] = await Promise.all([
    db.collection<ThreadSourceDoc>("controlTowerAskThreads").findOne({
      _id: message.threadId,
      userId,
    }),
    db.collection<{ _id: string; code: string }>("materials").findOne({ code: materialCode }),
  ]);
  if (!thread) {
    throw new ControlTowerAskActionError("CONTROL_TOWER_ACTION_THREAD_MISSING", "원본 대화를 찾을 수 없습니다.", 404);
  }
  if (thread.expiresAt <= new Date()) {
    throw new ControlTowerAskActionError(
      "CONTROL_TOWER_ACTION_SNAPSHOT_EXPIRED",
      "질문 당시 Snapshot이 오래되었습니다. 최신 상태로 다시 질문해 주세요.",
      409,
    );
  }
  if (!material) {
    throw new ControlTowerAskActionError(
      "CONTROL_TOWER_ACTION_MATERIAL_MISSING",
      "근거에 연결된 자재 마스터를 찾을 수 없습니다.",
      409,
    );
  }
  return { message, thread, suggestion, material };
}

export async function previewControlTowerAskAction(input: {
  userId: string;
  messageId: string;
}): Promise<ControlTowerAskActionPreview> {
  try {
    const db = await getDb();
    const source = await sourceFor(input.userId, input.messageId);
    const proposalId = hash(`${source.message._id}:${source.suggestion.actionType}:${source.suggestion.targetRef}`);
    const proposals = db.collection<ProposalDoc>("controlTowerActionProposals");
    const executed = await proposals.findOne({ _id: proposalId, userId: input.userId, status: "EXECUTED" });
    if (executed) {
      throw new ControlTowerAskActionError(
        "CONTROL_TOWER_ACTION_ALREADY_EXECUTED",
        `이미 ${executed.planNo ?? "입고계획"} 초안이 생성되었습니다.`,
        409,
      );
    }

    const preview = await previewInventoryScaleUpDraftForMaterial(source.material._id);
    const now = new Date();
    const previewToken = randomUUID();
    const previewExpiresAt = new Date(now.getTime() + PREVIEW_TTL_MS);
    try {
      await proposals.updateOne(
        { _id: proposalId, status: { $ne: "EXECUTED" } },
        {
          $setOnInsert: {
            userId: input.userId,
            messageId: source.message._id,
            threadId: source.thread._id,
            actionType: source.suggestion.actionType,
            targetRef: source.suggestion.targetRef,
            reason: source.suggestion.reason,
            materialId: source.material._id,
            sourceSnapshotHash: source.thread.snapshotHash,
            sourceExpiresAt: source.thread.expiresAt,
            executedAt: null,
            executedBy: null,
            executeRequestId: null,
            inboundPlanId: null,
            planNo: null,
            createdAt: now,
          },
          $set: {
            status: "PREVIEWED",
            previewHash: preview.previewHash,
            previewTokenHash: hash(previewToken),
            previewExpiresAt,
            previewedAt: now,
            blockedReason: null,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ControlTowerAskActionError(
          "CONTROL_TOWER_ACTION_ALREADY_EXECUTED",
          "다른 요청에서 이미 입고계획 초안을 생성했습니다.",
          409,
        );
      }
      throw error;
    }

    const item = preview.proposal;
    return {
      proposalId,
      previewToken,
      expiresAt: previewExpiresAt.toISOString(),
      materialId: item.materialId,
      materialCode: item.code,
      materialName: item.name,
      supplierName: item.supplierName,
      unit: item.unit,
      currentQuantity: item.currentQuantity,
      activeInboundQuantity: item.activeInboundQuantity,
      targetQuantity: item.targetQuantity,
      plannedQuantity: item.replenishmentQuantity,
      plannedDate: item.plannedDate.toISOString(),
      reviewStatus: "READY",
      reason: source.suggestion.reason,
    };
  } catch (error) {
    throw normalizeDomainError(error);
  }
}

export async function executeControlTowerAskAction(input: {
  userId: string;
  proposalId: string;
  previewToken: string;
  requestId: string;
}): Promise<ControlTowerAskActionResult> {
  try {
    const db = await getDb();
    const proposals = db.collection<ProposalDoc>("controlTowerActionProposals");
    const proposal = await proposals.findOne({ _id: input.proposalId, userId: input.userId });
    if (!proposal) {
      throw new ControlTowerAskActionError("CONTROL_TOWER_ACTION_NOT_FOUND", "실행 제안을 찾을 수 없습니다.", 404);
    }
    if (proposal.status === "EXECUTED" && proposal.inboundPlanId && proposal.planNo && proposal.executedAt) {
      return {
        proposalId: proposal._id,
        status: "EXECUTED",
        inboundPlanId: proposal.inboundPlanId,
        planNo: proposal.planNo,
        executedAt: proposal.executedAt.toISOString(),
      };
    }
    const now = new Date();
    if (
      proposal.status !== "PREVIEWED"
      || proposal.previewExpiresAt <= now
      || proposal.sourceExpiresAt <= now
      || proposal.previewTokenHash !== hash(input.previewToken)
    ) {
      throw new ControlTowerAskActionError(
        "CONTROL_TOWER_ACTION_PREVIEW_EXPIRED",
        "미리보기가 만료되었거나 최신 제안이 아닙니다. 다시 확인해 주세요.",
        409,
      );
    }

    let created;
    try {
      created = await createInventoryScaleUpDraftForMaterial({
        materialId: proposal.materialId,
        userId: input.userId,
        actionId: proposal._id,
        expectedPreviewHash: proposal.previewHash,
        now,
      });
    } catch (error) {
      const safeError = normalizeDomainError(error);
      await proposals.updateOne(
        { _id: proposal._id, userId: input.userId, status: "PREVIEWED" },
        { $set: { status: "BLOCKED", blockedReason: safeError.message, updatedAt: new Date() } },
      );
      throw safeError;
    }

    const executedAt = new Date();
    await proposals.updateOne(
      { _id: proposal._id, userId: input.userId },
      {
        $set: {
          status: "EXECUTED",
          executedAt,
          executedBy: input.userId,
          executeRequestId: input.requestId,
          inboundPlanId: created.plan._id,
          planNo: created.plan.planNo,
          blockedReason: null,
          updatedAt: executedAt,
        },
      },
    );
    const action: ControlTowerAskActionResult = {
      proposalId: proposal._id,
      status: "EXECUTED",
      inboundPlanId: created.plan._id,
      planNo: created.plan.planNo,
      executedAt: executedAt.toISOString(),
    };
    await db.collection<MessageSourceDoc>("controlTowerAskMessages").updateOne(
      { _id: proposal.messageId, userId: input.userId },
      { $set: { action: { ...action, executedAt } } },
    );
    return action;
  } catch (error) {
    throw normalizeDomainError(error);
  }
}
