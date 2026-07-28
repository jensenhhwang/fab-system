import "server-only";

import { createHash } from "crypto";
import { collections } from "@/lib/db";
import {
  CONTROL_TOWER_PERSONAS,
  CONTROL_TOWER_ROLE_ORDER,
  type ControlTowerAIEpisodeDoc,
  type ControlTowerAIEpisodeView,
  type ControlTowerAIJudgment,
  type ControlTowerAIReply,
  type ControlTowerAIUsage,
} from "@/lib/control-tower-live";
import {
  CONTROL_TOWER_AI_MODEL,
  CONTROL_TOWER_AI_PROMPT_VERSION,
  ControlTowerOpenAIError,
  generateControlTowerConclusion,
  generateControlTowerJudgment,
  generateControlTowerReply,
} from "@/lib/control-tower-openai-server";
import { buildControlTowerAISnapshot } from "@/lib/control-tower-snapshot-server";

const LEASE_MS = 120_000;
const RETRY_MS = 15 * 60_000;
const TOKEN_BUDGET = 80_000;
const MAX_REPLIES = 2;

function hashValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function emptyUsage(): ControlTowerAIUsage {
  return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 };
}

function addUsage(
  left: ControlTowerAIUsage,
  right: ControlTowerAIUsage,
): ControlTowerAIUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function aggregateUsage(input: Array<{ usage: ControlTowerAIUsage }>) {
  return input.reduce((sum, item) => addUsage(sum, item.usage), emptyUsage());
}

function serializeEpisode(doc: ControlTowerAIEpisodeDoc): ControlTowerAIEpisodeView {
  const publicDoc = {
    ...doc,
  } as Record<string, unknown>;
  delete publicDoc.leaseUntil;
  delete publicDoc.nextRetryAt;
  publicDoc.createdAt = doc.createdAt.toISOString();
  publicDoc.updatedAt = doc.updatedAt.toISOString();
  publicDoc.completedAt = doc.completedAt?.toISOString() ?? null;
  return publicDoc as unknown as ControlTowerAIEpisodeView;
}

function errorInfo(error: unknown) {
  if (error instanceof ControlTowerOpenAIError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "CONTROL_TOWER_AI_UNKNOWN",
    message: error instanceof Error ? error.message : "관제탑 자동 판단에 실패했습니다.",
  };
}

export async function ensureControlTowerAIIndexes() {
  const { controlTowerAIEpisodes } = await collections();
  await Promise.all([
    controlTowerAIEpisodes.createIndex({ createdAt: -1 }),
    controlTowerAIEpisodes.createIndex({ status: 1, leaseUntil: 1 }),
  ]);
}

async function claimEpisode(input: {
  id: string;
  semanticHash: string;
  snapshotHash: string;
  snapshot: ControlTowerAIEpisodeDoc["snapshot"];
}): Promise<boolean> {
  const { controlTowerAIEpisodes } = await collections();
  const now = new Date();
  const otherRunning = await controlTowerAIEpisodes.findOne({
    _id: { $ne: input.id },
    status: "RUNNING",
    leaseUntil: { $gt: now },
  });
  if (otherRunning) return false;
  const existing = await controlTowerAIEpisodes.findOne({ _id: input.id });

  if (!existing) {
    const episode: ControlTowerAIEpisodeDoc = {
      _id: input.id,
      semanticHash: input.semanticHash,
      snapshotHash: input.snapshotHash,
      status: "RUNNING",
      model: CONTROL_TOWER_AI_MODEL,
      promptVersion: CONTROL_TOWER_AI_PROMPT_VERSION,
      snapshot: input.snapshot,
      judgments: [],
      replies: [],
      conclusion: null,
      usage: emptyUsage(),
      attempts: 1,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      nextRetryAt: null,
      errorCode: null,
      errorMessage: null,
    };
    try {
      await controlTowerAIEpisodes.insertOne(episode);
      return true;
    } catch (error) {
      if (
        error
        && typeof error === "object"
        && "code" in error
        && (error as { code?: number }).code === 11000
      ) {
        return false;
      }
      throw error;
    }
  }

  if (existing.status === "COMPLETE") return false;
  if (existing.status === "RUNNING" && existing.leaseUntil && existing.leaseUntil > now) {
    return false;
  }
  if (
    (existing.status === "FAILED" || existing.status === "PARTIAL")
    && existing.nextRetryAt
    && existing.nextRetryAt > now
  ) {
    return false;
  }

  const result = await controlTowerAIEpisodes.updateOne(
    {
      _id: input.id,
      $or: [
        { status: { $in: ["FAILED", "PARTIAL"] } },
        { status: "RUNNING", leaseUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        status: "RUNNING",
        snapshotHash: input.snapshotHash,
        snapshot: input.snapshot,
        judgments: [],
        replies: [],
        conclusion: null,
        usage: emptyUsage(),
        leaseUntil: new Date(now.getTime() + LEASE_MS),
        updatedAt: now,
        completedAt: null,
        nextRetryAt: null,
        errorCode: null,
        errorMessage: null,
      },
      $inc: { attempts: 1 },
    },
  );
  return result.modifiedCount === 1;
}

async function finishPartial(input: {
  id: string;
  judgments: ControlTowerAIJudgment[];
  replies?: ControlTowerAIReply[];
  error: unknown;
}) {
  const { controlTowerAIEpisodes } = await collections();
  const now = new Date();
  const info = errorInfo(input.error);
  const replies = input.replies ?? [];
  const status = input.judgments.length > 0 ? "PARTIAL" : "FAILED";
  await controlTowerAIEpisodes.updateOne(
    { _id: input.id, status: "RUNNING" },
    {
      $set: {
        status,
        judgments: input.judgments,
        replies,
        conclusion: null,
        usage: aggregateUsage([...input.judgments, ...replies]),
        leaseUntil: null,
        errorCode: info.code,
        errorMessage: info.message.slice(0, 500),
        updatedAt: now,
        completedAt: now,
        nextRetryAt: new Date(now.getTime() + RETRY_MS),
      },
    },
  );
}

export async function maybeRunControlTowerAI(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) return;

  const snapshotResult = await buildControlTowerAISnapshot();
  const episodeId = `CTAI:${hashValue([
    snapshotResult.semanticHash,
    CONTROL_TOWER_AI_PROMPT_VERSION,
    CONTROL_TOWER_AI_MODEL,
  ])}`;
  const claimed = await claimEpisode({
    id: episodeId,
    semanticHash: snapshotResult.semanticHash,
    snapshotHash: snapshotResult.snapshotHash,
    snapshot: snapshotResult.snapshot,
  });
  if (!claimed) return;

  const judgmentResults = await Promise.allSettled(
    CONTROL_TOWER_ROLE_ORDER.map((role) => generateControlTowerJudgment({
      snapshot: snapshotResult.snapshot,
      role,
      mode: CONTROL_TOWER_PERSONAS[role].judgmentMode,
    })),
  );
  const judgments = judgmentResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []);
  const judgmentFailure = judgmentResults.find((result) => result.status === "rejected");
  if (judgmentFailure?.status === "rejected") {
    await finishPartial({ id: episodeId, judgments, error: judgmentFailure.reason });
    return;
  }

  let usage = aggregateUsage(judgments);
  if (usage.totalTokens >= TOKEN_BUDGET) {
    await finishPartial({
      id: episodeId,
      judgments,
      error: new ControlTowerOpenAIError(
        "CONTROL_TOWER_TOKEN_BUDGET",
        "관제탑 판단의 episode 토큰 상한에 도달했습니다.",
      ),
    });
    return;
  }

  const questioners = judgments
    .filter((judgment) => judgment.questionForRole && judgment.question)
    .sort((left, right) => {
      const rank = { CRITICAL: 3, ATTENTION: 2, NORMAL: 1 };
      return rank[right.severity] - rank[left.severity];
    })
    .slice(0, MAX_REPLIES);

  const replyResults = await Promise.allSettled(
    questioners.map((judgment) => generateControlTowerReply({
      snapshot: snapshotResult.snapshot,
      judgments,
      speakerRole: judgment.questionForRole!,
      replyToRole: judgment.role,
      question: judgment.question!,
    })),
  );
  const replies = replyResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []);
  const replyFailure = replyResults.find((result) => result.status === "rejected");
  if (replyFailure?.status === "rejected") {
    await finishPartial({ id: episodeId, judgments, replies, error: replyFailure.reason });
    return;
  }

  usage = aggregateUsage([...judgments, ...replies]);
  if (usage.totalTokens >= TOKEN_BUDGET) {
    await finishPartial({
      id: episodeId,
      judgments,
      replies,
      error: new ControlTowerOpenAIError(
        "CONTROL_TOWER_TOKEN_BUDGET",
        "관제탑 판단의 episode 토큰 상한에 도달했습니다.",
      ),
    });
    return;
  }

  try {
    const conclusion = await generateControlTowerConclusion({
      snapshot: snapshotResult.snapshot,
      judgments,
      replies,
    });
    usage = aggregateUsage([...judgments, ...replies, conclusion]);
    const now = new Date();
    const { controlTowerAIEpisodes } = await collections();
    await controlTowerAIEpisodes.updateOne(
      { _id: episodeId, status: "RUNNING" },
      {
        $set: {
          status: "COMPLETE",
          judgments,
          replies,
          conclusion,
          usage,
          leaseUntil: null,
          updatedAt: now,
          completedAt: now,
          nextRetryAt: null,
          errorCode: null,
          errorMessage: null,
        },
      },
    );
  } catch (error) {
    await finishPartial({ id: episodeId, judgments, replies, error });
  }
}

export async function getLatestControlTowerAIEpisode(): Promise<ControlTowerAIEpisodeView | null> {
  const { controlTowerAIEpisodes } = await collections();
  const doc = await controlTowerAIEpisodes.findOne({}, { sort: { createdAt: -1 } });
  return doc ? serializeEpisode(doc) : null;
}
