import "server-only";

import { createHash } from "crypto";
import { collections } from "@/lib/db";
import {
  CONTROL_TOWER_PERSONAS,
  CONTROL_TOWER_ROLE_ORDER,
  type ControlTowerAIEpisodeDoc,
  type ControlTowerAIEpisodeView,
  type ControlTowerAIConclusion,
  type ControlTowerAIJudgment,
  type ControlTowerAIReply,
  type ControlTowerAIUsage,
  type ControlTowerRole,
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
const MIN_EPISODE_INTERVAL_MS = 30 * 60_000;
const TOKEN_BUDGET = 12_000;
const MAX_REPLIES = 1;

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

// 사람이 화면에서 켜고 끄는 수동 스위치 — 월 예산 가드와 별개로 즉시 차단/재개한다.
// OFF면 maybeRunControlTowerAI가 아예 호출되지 않아 새 episode가 생기지 않고,
// 화면은 각 역할의 규칙 엔진 판정(하드코딩 룰 기반)만 표시한다.
export async function getControlTowerAIEnabled(): Promise<boolean> {
  const { controlTowerAIState } = await collections();
  const doc = await controlTowerAIState.findOne({ _id: "singleton" });
  return doc?.aiEnabled ?? true;
}

export async function setControlTowerAIEnabled(enabled: boolean, actorId: string): Promise<void> {
  const { controlTowerAIState } = await collections();
  await controlTowerAIState.updateOne(
    { _id: "singleton" },
    { $set: { aiEnabled: enabled, updatedAt: new Date(), updatedBy: actorId } },
    { upsert: true },
  );
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
    const latest = await controlTowerAIEpisodes.findOne(
      { model: CONTROL_TOWER_AI_MODEL },
      { sort: { createdAt: -1 } },
    );
    if (
      latest
      && latest.createdAt > new Date(now.getTime() - MIN_EPISODE_INTERVAL_MS)
    ) {
      return false;
    }
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

  if (existing.status !== "RUNNING") return false;
  if (existing.status === "RUNNING" && existing.leaseUntil && existing.leaseUntil > now) {
    return false;
  }
  if (existing.attempts >= 2) return false;

  const result = await controlTowerAIEpisodes.updateOne(
    {
      _id: input.id,
      status: "RUNNING",
      leaseUntil: { $lte: now },
      attempts: { $lt: 2 },
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
        nextRetryAt: null,
      },
    },
  );
}

function buildRuleConclusion(
  judgments: ControlTowerAIJudgment[],
): ControlTowerAIConclusion {
  const verdicts = new Set(judgments.map((judgment) => judgment.verdict));
  return {
    alignment: verdicts.size === 1 ? "ALIGNED" : "CONDITIONAL",
    summary: "담당자 판단이 정렬되어 추가 종합 호출을 생략했습니다.",
    decisions: [...new Set(judgments.map((judgment) => judgment.proposedDecision))].slice(0, 3),
    openIssues: judgments.flatMap((judgment) => judgment.question ? [judgment.question] : []).slice(0, 3),
    evidenceRefs: [...new Set(judgments.flatMap((judgment) => judgment.evidenceRefs))].slice(0, 6),
    advisoryOnly: true,
    usage: emptyUsage(),
    latencyMs: 0,
  };
}

const HARDCODED_VERDICT_MAP: Record<string, { verdict: ControlTowerAIJudgment["verdict"]; severity: ControlTowerAIJudgment["severity"] }> = {
  // PROCUREMENT
  BLOCKED: { verdict: "ESCALATE", severity: "CRITICAL" },
  WOULD_PROPOSE: { verdict: "CHECK", severity: "ATTENTION" },
  WOULD_AUTO_RECEIVE: { verdict: "OBSERVE", severity: "NORMAL" },
  // MATERIALS
  COVERAGE_CRITICAL: { verdict: "ESCALATE", severity: "CRITICAL" },
  COVERAGE_WATCH: { verdict: "CHECK", severity: "ATTENTION" },
  DATA_GAP: { verdict: "CHECK", severity: "ATTENTION" },
  COVERAGE_NORMAL: { verdict: "OBSERVE", severity: "NORMAL" },
  // PRODUCTION
  MATERIAL_BLOCKED: { verdict: "ESCALATE", severity: "CRITICAL" },
  HOLD_RISK: { verdict: "CHECK", severity: "ATTENTION" },
  ON_TRACK: { verdict: "OBSERVE", severity: "NORMAL" },
  // LOGISTICS
  CAPACITY_OVER: { verdict: "ESCALATE", severity: "CRITICAL" },
  CAPACITY_WATCH: { verdict: "CHECK", severity: "ATTENTION" },
  INBOUND_NORMAL: { verdict: "OBSERVE", severity: "NORMAL" },
};

// AI가 꺼져 있어도 관제탑이 멈추면 안 된다 — 각 역할의 규칙 엔진 판정을 LLM 없이 그대로
// judgment로 승격해 기록을 계속 쌓는다(누적 로그 유지). OpenAI 호출은 전혀 없다.
function buildHardcodedJudgments(snapshot: ControlTowerAIEpisodeDoc["snapshot"]): ControlTowerAIJudgment[] {
  const roleRules: [ControlTowerRole, { scenarioLabel: string; topVerdict: string | null; topVerdictText: string | null }][] = [
    ["PROCUREMENT", snapshot.procurementRule],
    ["MATERIALS", snapshot.materialsRule],
    ["PRODUCTION", snapshot.productionRule],
    ["LOGISTICS", snapshot.logisticsRule],
  ];
  return roleRules.map(([role, rule]) => {
    const mapped = rule.topVerdict ? HARDCODED_VERDICT_MAP[rule.topVerdict] : undefined;
    const roleFacts = snapshot.facts.filter((fact) => fact.role === role);
    return {
      role,
      mode: CONTROL_TOWER_PERSONAS[role].judgmentMode,
      verdict: mapped?.verdict ?? "OBSERVE",
      severity: mapped?.severity ?? "NORMAL",
      summary: rule.topVerdictText ?? "특이사항 없음 — 규칙 기준 정상 범위입니다.",
      proposedDecision: "규칙 엔진 판정입니다(AI 판단 꺼짐). 재판단이 필요하면 AI를 켜세요.",
      evidenceRefs: roleFacts.slice(0, 1).map((fact) => fact.ref).length > 0
        ? roleFacts.slice(0, 1).map((fact) => fact.ref)
        : [`${role}:RULE`],
      assumptions: [],
      questionForRole: null,
      question: null,
      usage: emptyUsage(),
      latencyMs: 0,
    };
  });
}

// LLM 없이 즉시 완료되는 하드코딩 판정 — cost가 없으므로 LLM용 30분 간격 스로틀은 적용하지
// 않고, 같은 semantic 상태에 대해서만 idempotent하게(중복 기록 방지) 1건만 남긴다.
async function claimHardcodedEpisode(input: {
  id: string;
  semanticHash: string;
  snapshotHash: string;
  snapshot: ControlTowerAIEpisodeDoc["snapshot"];
}): Promise<boolean> {
  const { controlTowerAIEpisodes } = await collections();
  const now = new Date();
  if (await controlTowerAIEpisodes.findOne({ _id: input.id })) return false;
  const episode: ControlTowerAIEpisodeDoc = {
    _id: input.id,
    semanticHash: input.semanticHash,
    snapshotHash: input.snapshotHash,
    status: "RUNNING",
    model: "HARDCODED_RULES",
    promptVersion: CONTROL_TOWER_AI_PROMPT_VERSION,
    snapshot: input.snapshot,
    judgments: [],
    replies: [],
    conclusion: null,
    usage: emptyUsage(),
    attempts: 1,
    leaseUntil: null,
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

export async function maybeRunControlTowerAI(): Promise<void> {
  const aiEnabled = await getControlTowerAIEnabled();

  if (!aiEnabled) {
    const snapshotResult = await buildControlTowerAISnapshot();
    const episodeId = `CTAI:HARDCODED:${hashValue([snapshotResult.semanticHash, CONTROL_TOWER_AI_PROMPT_VERSION])}`;
    const claimed = await claimHardcodedEpisode({
      id: episodeId,
      semanticHash: snapshotResult.semanticHash,
      snapshotHash: snapshotResult.snapshotHash,
      snapshot: snapshotResult.snapshot,
    });
    if (!claimed) return;
    const judgments = buildHardcodedJudgments(snapshotResult.snapshot);
    const conclusion = buildRuleConclusion(judgments);
    const now = new Date();
    const { controlTowerAIEpisodes } = await collections();
    await controlTowerAIEpisodes.updateOne(
      { _id: episodeId, status: "RUNNING" },
      {
        $set: {
          status: "COMPLETE",
          judgments,
          replies: [],
          conclusion,
          updatedAt: now,
          completedAt: now,
        },
      },
    );
    return;
  }

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
    const requiresLLMConclusion = replies.length > 0
      || judgments.some((judgment) => judgment.severity === "CRITICAL")
      || new Set(judgments.map((judgment) => judgment.verdict)).size > 1;
    const conclusion = requiresLLMConclusion
      ? await generateControlTowerConclusion({
        snapshot: snapshotResult.snapshot,
        judgments,
        replies,
      })
      : buildRuleConclusion(judgments);
    usage = aggregateUsage([...judgments, ...replies, conclusion]);
    if (usage.totalTokens > TOKEN_BUDGET) {
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
