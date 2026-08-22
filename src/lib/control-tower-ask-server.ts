import "server-only";

import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import {
  type ControlTowerAIUsage,
  type ControlTowerEvidenceFact,
  type ControlTowerRole,
} from "@/lib/control-tower-live";
import {
  type ControlTowerAskAnswer,
  type ControlTowerAskActionResult,
  type ControlTowerAskHistory,
  type ControlTowerAskMessageView,
  type ControlTowerAskThreadSummary,
} from "@/lib/control-tower-ask";
import {
  ControlTowerAIBudgetError,
} from "@/lib/control-tower-ai-budget-server";
import { matchAskIntent } from "@/lib/control-tower-ask-intent";
import { buildAskAnswer } from "@/lib/control-tower-ask-answer";
import {
  buildControlTowerAISnapshot,
  type ControlTowerAISnapshot,
} from "@/lib/control-tower-snapshot-server";

const ASK_PROMPT_VERSION = "CONTROL_TOWER_ASK_V1";
/** 결정론 응답기 식별자 — 저장된 스레드가 어느 방식으로 답했는지 남긴다. */
const DETERMINISTIC_MODEL = "DETERMINISTIC_V1";
const THREAD_TTL_MS = 30 * 60_000;
const REQUEST_LEASE_MS = 90_000;


type ThreadDoc = {
  _id: string;
  userId: string;
  role: ControlTowerRole;
  snapshotHash: string;
  snapshot: ControlTowerAISnapshot;
  model: string;
  promptVersion: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
};

type MessageDoc = {
  _id: string;
  clientRequestId: string;
  threadId: string;
  userId: string;
  role: ControlTowerRole;
  question: string;
  status: "PROCESSING" | "ANSWERED" | "FAILED";
  answer: ControlTowerAskAnswer | null;
  evidence: ControlTowerEvidenceFact[];
  usage: ControlTowerAIUsage | null;
  costMicroUsd: number | null;
  model: string | null;
  latencyMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
  action?: Omit<ControlTowerAskActionResult, "executedAt"> & { executedAt: Date } | null;
};

type LeaseDoc = {
  _id: string;
  token: string;
  leaseUntil: Date;
  updatedAt: Date;
};

export class ControlTowerAskError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 500,
  ) {
    super(message);
    this.name = "ControlTowerAskError";
  }
}

function isDuplicateKey(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: number }).code === 11000,
  );
}

async function askCollections() {
  const db = await getDb();
  return {
    threads: db.collection<ThreadDoc>("controlTowerAskThreads"),
    messages: db.collection<MessageDoc>("controlTowerAskMessages"),
    leases: db.collection<LeaseDoc>("controlTowerAskLeases"),
  };
}

let indexesPromise: Promise<unknown> | null = null;
function ensureIndexes() {
  if (!indexesPromise) {
    indexesPromise = askCollections().then(({ threads, messages }) => Promise.all([
      threads.createIndex({ userId: 1, createdAt: -1 }),
      messages.createIndex({ userId: 1, clientRequestId: 1 }, { unique: true }),
      messages.createIndex({ threadId: 1, createdAt: 1 }),
    ])).catch((error) => {
      indexesPromise = null;
      throw error;
    });
  }
  return indexesPromise;
}

function threadView(thread: ThreadDoc): ControlTowerAskThreadSummary {
  return {
    id: thread._id,
    role: thread.role,
    snapshotCapturedAt: thread.snapshot.capturedAt,
    createdAt: thread.createdAt.toISOString(),
    expiresAt: thread.expiresAt.toISOString(),
  };
}

function messageView(message: MessageDoc): ControlTowerAskMessageView {
  return {
    id: message._id,
    threadId: message.threadId,
    role: message.role,
    question: message.question,
    status: message.status,
    answer: message.answer,
    evidence: message.evidence,
    usage: message.usage,
    costUsd: message.costMicroUsd === null ? null : message.costMicroUsd / 1_000_000,
    model: message.model,
    latencyMs: message.latencyMs,
    errorCode: message.errorCode,
    errorMessage: message.errorMessage,
    createdAt: message.createdAt.toISOString(),
    completedAt: message.completedAt?.toISOString() ?? null,
    action: message.action
      ? { ...message.action, executedAt: message.action.executedAt.toISOString() }
      : null,
  };
}

export async function getControlTowerAskHistory(
  userId: string,
  requestedThreadId?: string | null,
): Promise<ControlTowerAskHistory> {
  await ensureIndexes();
  const { threads, messages } = await askCollections();
  const thread = requestedThreadId
    ? await threads.findOne({ _id: requestedThreadId, userId })
    : await threads.findOne({ userId }, { sort: { createdAt: -1 } });
  if (requestedThreadId && !thread) {
    throw new ControlTowerAskError("ASK_THREAD_NOT_FOUND", "대화를 찾을 수 없습니다.", 404);
  }
  const recentThreads = await threads.find({ userId }).sort({ createdAt: -1 }).limit(8).toArray();
  const docs = thread
    ? await messages.find({ userId, threadId: thread._id }).sort({ createdAt: -1 }).limit(20).toArray()
    : [];
  return {
    thread: thread ? threadView(thread) : null,
    messages: docs.reverse().map(messageView),
    recentThreads: recentThreads.map(threadView),
  };
}

async function acquireLease(userId: string) {
  const { leases } = await askCollections();
  const now = new Date();
  const token = randomUUID();
  try {
    const lease = await leases.findOneAndUpdate(
      {
        _id: userId,
        $or: [
          { leaseUntil: { $lte: now } },
          { leaseUntil: { $exists: false } },
        ],
      },
      {
        $set: {
          token,
          leaseUntil: new Date(now.getTime() + REQUEST_LEASE_MS),
          updatedAt: now,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (!lease || lease.token !== token) return null;
    return token;
  } catch (error) {
    if (isDuplicateKey(error)) return null;
    throw error;
  }
}

async function releaseLease(userId: string, token: string) {
  const { leases } = await askCollections();
  await leases.deleteOne({ _id: userId, token });
}

function roleRule(snapshot: ControlTowerAISnapshot, role: ControlTowerRole) {
  if (role === "PROCUREMENT") return snapshot.procurementRule;
  if (role === "MATERIALS") return snapshot.materialsRule;
  if (role === "PRODUCTION") return snapshot.productionRule;
  return snapshot.logisticsRule;
}




function publicError(error: unknown) {
  if (error instanceof ControlTowerAskError) return error;
  if (error instanceof ControlTowerAIBudgetError) {
    return new ControlTowerAskError(error.code, error.message, 429);
  }
  return new ControlTowerAskError(
    "CONTROL_TOWER_ASK_FAILED",
    error instanceof Error ? error.message : "담당자 답변을 만들지 못했습니다.",
    500,
  );
}

async function answerQuestion(input: {
  userId: string;
  thread: ThreadDoc;
  question: string;
  history: MessageDoc[];
}) {
  // 결정론 응답 — OpenAI를 호출하지 않는다.
  //
  // 예전에는 질문마다 OpenAI를 불렀는데, 그 AI는 새 정보를 만들지 않았다. 프롬프트가
  // "고정된 Snapshot의 facts와 rule만 근거로 쓰고 없는 수치를 만들지 말라"고 못박고 있어서
  // 판단·수치·상태는 전부 서버가 결정론적으로 계산해 넘긴 값이었고, AI는 (1) 자유 문장 해석과
  // (2) 문장 엮기만 했다. 그 둘을 matchAskIntent·buildAskAnswer가 대신한다.
  //
  // 잃는 것은 키워드에 안 걸리는 질문의 해석 폭이고, 얻는 것은 비용 0 · 같은 질문에 같은 답 ·
  // 없는 사실을 그럴듯하게 말할 위험 제거다. 응답 형태는 그대로라 화면·저장은 안 바뀐다.
  const startedAt = Date.now();
  const facts = input.thread.snapshot.facts.filter((fact) => fact.role === input.thread.role);
  const rule = roleRule(input.thread.snapshot, input.thread.role);
  const ruleText = typeof rule === "string" ? rule : rule ? JSON.stringify(rule) : null;

  const intent = matchAskIntent(input.thread.role, input.question);
  const answer = buildAskAnswer({ role: input.thread.role, intent, facts, ruleText });
  const evidence = facts.filter((fact) => answer.evidenceRefs.includes(fact.ref));

  return {
    answer: answer as ControlTowerAskAnswer,
    evidence,
    usage: null,
    costMicroUsd: 0,
    model: DETERMINISTIC_MODEL,
    latencyMs: Date.now() - startedAt,
  };
}

export async function askControlTowerRole(input: {
  userId: string;
  role: ControlTowerRole;
  question: string;
  clientRequestId: string;
  threadId?: string | null;
}): Promise<ControlTowerAskHistory> {
  await ensureIndexes();
  const collections = await askCollections();
  const duplicate = await collections.messages.findOne({
    userId: input.userId,
    clientRequestId: input.clientRequestId,
  });
  if (duplicate) return getControlTowerAskHistory(input.userId, duplicate.threadId);

  const leaseToken = await acquireLease(input.userId);
  if (!leaseToken) {
    throw new ControlTowerAskError(
      "ASK_ALREADY_PROCESSING",
      "이미 다른 질문에 답변 중입니다.",
      409,
    );
  }

  let message: MessageDoc | null = null;
  try {
    const existingAfterLease = await collections.messages.findOne({
      userId: input.userId,
      clientRequestId: input.clientRequestId,
    });
    if (existingAfterLease) {
      return getControlTowerAskHistory(input.userId, existingAfterLease.threadId);
    }

    const now = new Date();
    let thread: ThreadDoc | null = null;
    if (input.threadId) {
      thread = await collections.threads.findOne({ _id: input.threadId, userId: input.userId });
      if (!thread) {
        throw new ControlTowerAskError("ASK_THREAD_NOT_FOUND", "대화를 찾을 수 없습니다.", 404);
      }
      if (thread.role !== input.role) {
        throw new ControlTowerAskError("ASK_ROLE_MISMATCH", "다른 담당자에게는 새 대화로 질문해 주세요.", 409);
      }
      if (thread.expiresAt <= now) {
        throw new ControlTowerAskError(
          "ASK_SNAPSHOT_EXPIRED",
          "이 대화의 Snapshot이 오래되었습니다. 최신 상태로 새 질문을 시작해 주세요.",
          409,
        );
      }
    } else {
      const snapshotResult = await buildControlTowerAISnapshot();
      thread = {
        _id: randomUUID(),
        userId: input.userId,
        role: input.role,
        snapshotHash: snapshotResult.snapshotHash,
        snapshot: snapshotResult.snapshot,
        model: DETERMINISTIC_MODEL,
        promptVersion: ASK_PROMPT_VERSION,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + THREAD_TTL_MS),
      };
      await collections.threads.insertOne(thread);
    }

    message = {
      _id: randomUUID(),
      clientRequestId: input.clientRequestId,
      threadId: thread._id,
      userId: input.userId,
      role: input.role,
      question: input.question,
      status: "PROCESSING",
      answer: null,
      evidence: [],
      usage: null,
      costMicroUsd: null,
      model: null,
      latencyMs: null,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      completedAt: null,
      action: null,
    };
    try {
      await collections.messages.insertOne(message);
    } catch (error) {
      if (isDuplicateKey(error)) {
        const existing = await collections.messages.findOne({
          userId: input.userId,
          clientRequestId: input.clientRequestId,
        });
        if (existing) return getControlTowerAskHistory(input.userId, existing.threadId);
      }
      throw error;
    }

    const history = await collections.messages.find({
      userId: input.userId,
      threadId: thread._id,
      status: "ANSWERED",
      _id: { $ne: message._id },
    }).sort({ createdAt: -1 }).limit(2).toArray();
    const result = await answerQuestion({
      userId: input.userId,
      thread,
      question: input.question,
      history: history.reverse(),
    });
    const completedAt = new Date();
    await Promise.all([
      collections.messages.updateOne(
        { _id: message._id, userId: input.userId, status: "PROCESSING" },
        {
          $set: {
            status: "ANSWERED",
            ...result,
            completedAt,
          },
        },
      ),
      collections.threads.updateOne(
        { _id: thread._id, userId: input.userId },
        { $set: { updatedAt: completedAt } },
      ),
    ]);
    return getControlTowerAskHistory(input.userId, thread._id);
  } catch (error) {
    const safeError = publicError(error);
    if (message) {
      await collections.messages.updateOne(
        { _id: message._id, userId: input.userId, status: "PROCESSING" },
        {
          $set: {
            status: "FAILED",
            errorCode: safeError.code,
            errorMessage: safeError.message.slice(0, 300),
            completedAt: new Date(),
          },
        },
      ).catch(() => undefined);
    }
    throw safeError;
  } finally {
    await releaseLease(input.userId, leaseToken).catch(() => undefined);
  }
}
