import "server-only";

import { createHash, randomUUID } from "crypto";
import Groq from "groq-sdk";
import { collections } from "@/lib/db";
import type {
  AIInvocationDoc,
  Role,
  WhatIfCopilotActionDoc,
  WhatIfCopilotActionStatus,
  WhatIfCopilotBriefingDoc,
} from "@/lib/db";
import { loadLiveScenarioMaterials } from "@/lib/material-scenario-server";
import { recommendMaterialOrders } from "@/lib/scenario-engine";
import {
  buildWhatIfCandidates,
  fallbackNarrative,
  WHAT_IF_COPILOT_PROMPT_VERSION,
} from "@/lib/what-if-copilot";
import type {
  WhatIfActionCard,
  WhatIfActionCode,
  WhatIfCandidate,
  WhatIfCopilotRequest,
  WhatIfCopilotResponse,
  WhatIfNarrative,
} from "@/lib/what-if-copilot";

const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const MAX_CANDIDATES = 10;
const MAX_CARDS = 3;
const GENERATION_STALE_MS = 120_000;

function hashValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function actionDocId(userId: string, scopeHash: string, candidateId: string) {
  return `WHAT_IF_ACTION:${hashValue([userId, scopeHash, candidateId])}`;
}

function cacheKeyFor(candidateHash: string, role: Role, model: string) {
  return `WHAT_IF_BRIEFING:${hashValue([
    candidateHash,
    role,
    WHAT_IF_COPILOT_PROMPT_VERSION,
    model,
  ])}`;
}

function candidateHashInput(candidate: WhatIfCandidate) {
  return {
    id: candidate.id,
    severity: candidate.severity,
    score: candidate.score,
    material: candidate.material,
    classification: candidate.classification,
    primaryAction: candidate.primaryAction,
    dueDay: candidate.dueDay,
    needByDay: candidate.needByDay,
    availableQuantity: candidate.availableQuantity,
    confirmedInbound: candidate.confirmedInbound,
    recommendedQuantity: candidate.recommendedQuantity,
    scenarioRequirement: candidate.scenarioRequirement,
    baselineRequirement: candidate.baselineRequirement,
    reasonCodes: candidate.reasonCodes,
    allowedActions: candidate.allowedActions,
    evidence: candidate.evidence,
  };
}

function cleanNarrativeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[぀-ヿ㐀-䶿一-鿿豈-﫿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  if (!cleaned || /\d/.test(cleaned)) return null;
  return cleaned;
}

function parseNarratives(raw: string, candidates: WhatIfCandidate[]): WhatIfNarrative[] {
  const parsed = JSON.parse(raw) as { priorities?: unknown };
  if (!Array.isArray(parsed.priorities)) throw new Error("AI_PRIORITY_SCHEMA_INVALID");
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const seen = new Set<string>();
  const narratives: WhatIfNarrative[] = [];
  for (const item of parsed.priorities.slice(0, MAX_CARDS)) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    if (typeof value.candidateId !== "string" || seen.has(value.candidateId)) continue;
    const candidate = byId.get(value.candidateId);
    if (!candidate || typeof value.actionCode !== "string") continue;
    if (!candidate.allowedActions.includes(value.actionCode as WhatIfActionCode)) continue;
    const title = cleanNarrativeText(value.title, 80);
    const why = cleanNarrativeText(value.why, 180);
    const action = cleanNarrativeText(value.action, 120);
    const inactionImpact = cleanNarrativeText(value.inactionImpact, 160);
    if (!title || !why || !action || !inactionImpact) continue;
    seen.add(candidate.id);
    narratives.push({
      candidateId: candidate.id,
      actionCode: value.actionCode as WhatIfActionCode,
      title,
      why,
      action,
      inactionImpact,
    });
  }
  return narratives;
}

function completeNarratives(
  candidates: WhatIfCandidate[],
  source: WhatIfNarrative[],
): WhatIfNarrative[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const result: WhatIfNarrative[] = [];
  const seen = new Set<string>();
  for (const narrative of source) {
    const candidate = byId.get(narrative.candidateId);
    if (!candidate || seen.has(candidate.id)) continue;
    if (!candidate.allowedActions.includes(narrative.actionCode)) continue;
    result.push(narrative);
    seen.add(candidate.id);
  }
  for (const candidate of candidates) {
    if (result.length >= MAX_CARDS) break;
    if (seen.has(candidate.id)) continue;
    result.push(fallbackNarrative(candidate));
    seen.add(candidate.id);
  }
  return result.slice(0, MAX_CARDS);
}

function effectiveActionState(
  doc: WhatIfCopilotActionDoc | undefined,
  now: Date,
): { status: WhatIfCopilotActionStatus; snoozedUntil: string | null; hidden: boolean } {
  if (!doc) return { status: "NEW", snoozedUntil: null, hidden: false };
  if (doc.status === "SNOOZED") {
    if (doc.snoozedUntil && doc.snoozedUntil > now) {
      return { status: "SNOOZED", snoozedUntil: doc.snoozedUntil.toISOString(), hidden: true };
    }
    return { status: "NEW", snoozedUntil: null, hidden: false };
  }
  return {
    status: doc.status,
    snoozedUntil: doc.snoozedUntil?.toISOString() ?? null,
    hidden: doc.status === "DISMISSED",
  };
}

async function cardsWithState(input: {
  candidates: WhatIfCandidate[];
  narratives: WhatIfNarrative[];
  scopeHash: string;
  userId: string;
}) {
  const orderedIds = input.narratives.map((narrative) => narrative.candidateId);
  const remainingIds = input.candidates
    .map((candidate) => candidate.id)
    .filter((candidateId) => !orderedIds.includes(candidateId));
  const allIds = [...orderedIds, ...remainingIds];
  const { whatIfCopilotActions } = await collections();
  const ids = allIds.map((candidateId) => actionDocId(input.userId, input.scopeHash, candidateId));
  const docs = ids.length
    ? await whatIfCopilotActions.find({ _id: { $in: ids } }).toArray()
    : [];
  const docByCandidate = new Map(docs.map((doc) => [doc.candidateId, doc]));
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const narrativeById = new Map(input.narratives.map((narrative) => [narrative.candidateId, narrative]));
  const now = new Date();
  const cards: WhatIfActionCard[] = [];
  for (const candidateId of allIds) {
    const candidate = candidateById.get(candidateId);
    if (!candidate) continue;
    const state = effectiveActionState(docByCandidate.get(candidateId), now);
    if (state.hidden) continue;
    cards.push({
      candidate,
      narrative: narrativeById.get(candidateId) ?? fallbackNarrative(candidate),
      status: state.status,
      snoozedUntil: state.snoozedUntil,
    });
    if (cards.length >= MAX_CARDS) break;
  }
  return cards;
}

function aiPrompt(candidates: WhatIfCandidate[], role: Role) {
  const safeCandidates = candidates.map((candidate) => ({
    candidateId: candidate.id,
    severity: candidate.severity,
    materialName: candidate.material.name,
    reasonCodes: candidate.reasonCodes,
    classification: candidate.classification,
    allowedActions: candidate.allowedActions,
    hasImmediateDeadline: candidate.dueDay !== null && candidate.dueDay <= 0,
    hasKnownNeedDate: candidate.needByDay !== null,
    usageConfidence: candidate.evidence.usageConfidence,
  }));
  return {
    system: `당신은 반도체 Fab 자재 담당자의 운영 행동 우선순위를 정하는 코파일럿입니다.
서버가 계산한 후보 안에서 최대 세 개만 고르세요. 새로운 후보, 수량, 날짜, 자재, 사실을 만들지 마세요.
숫자와 날짜는 서버가 별도로 표시하므로 모든 설명에 숫자, 퍼센트, 날짜를 쓰지 마세요.
candidateId와 actionCode는 입력에 있는 값만 그대로 사용하세요.
응답은 한국어 JSON만 반환하고 다음 형식 외의 키를 추가하지 마세요.
{"priorities":[{"candidateId":"입력 ID","actionCode":"허용 행동","title":"짧은 제목","why":"지금 중요한 이유","action":"담당자가 지금 할 행동","inactionImpact":"미조치 시 영향"}]}`,
    user: JSON.stringify({ role, candidates: safeCandidates }),
  };
}

async function generateNarratives(input: {
  candidates: WhatIfCandidate[];
  candidateHash: string;
  role: Role;
  userId: string;
  model: string;
  cacheKey: string;
}): Promise<{
  narratives: WhatIfNarrative[];
  source: "AI" | "CACHE" | "FALLBACK";
  cacheHit: boolean;
  refreshing: boolean;
  usage: WhatIfCopilotResponse["usage"];
}> {
  const { whatIfCopilotBriefings, aiInvocations } = await collections();
  const existing = await whatIfCopilotBriefings.findOne({ _id: input.cacheKey });
  if (existing?.status === "COMPLETE") {
    return {
      narratives: completeNarratives(input.candidates, existing.narratives as WhatIfNarrative[]),
      source: "CACHE",
      cacheHit: true,
      refreshing: false,
      usage: existing.usage ?? null,
    };
  }

  if (!process.env.GROQ_API_KEY) {
    return {
      narratives: completeNarratives(input.candidates, []),
      source: "FALLBACK",
      cacheHit: false,
      refreshing: false,
      usage: null,
    };
  }

  const now = new Date();
  if (
    existing?.status === "GENERATING"
    && now.getTime() - existing.updatedAt.getTime() < GENERATION_STALE_MS
  ) {
    return {
      narratives: completeNarratives(input.candidates, []),
      source: "FALLBACK",
      cacheHit: false,
      refreshing: true,
      usage: null,
    };
  }

  const generationId = randomUUID();
  const generatingDoc: WhatIfCopilotBriefingDoc = {
    _id: input.cacheKey,
    candidateHash: input.candidateHash,
    role: input.role,
    promptVersion: WHAT_IF_COPILOT_PROMPT_VERSION,
    model: input.model,
    status: "GENERATING",
    generationId,
    narratives: [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (existing) {
    const claimed = await whatIfCopilotBriefings.updateOne(
      { _id: input.cacheKey, generationId: existing.generationId },
      {
        $set: {
          candidateHash: generatingDoc.candidateHash,
          role: generatingDoc.role,
          promptVersion: generatingDoc.promptVersion,
          model: generatingDoc.model,
          status: generatingDoc.status,
          generationId: generatingDoc.generationId,
          narratives: generatingDoc.narratives,
          error: null,
          updatedAt: generatingDoc.updatedAt,
        },
      },
    );
    if (!claimed.modifiedCount) {
      return {
        narratives: completeNarratives(input.candidates, []),
        source: "FALLBACK",
        cacheHit: false,
        refreshing: true,
        usage: null,
      };
    }
  } else {
    try {
      await whatIfCopilotBriefings.insertOne(generatingDoc);
    } catch {
      const winner = await whatIfCopilotBriefings.findOne({ _id: input.cacheKey });
      if (winner?.status === "COMPLETE") {
        return {
          narratives: completeNarratives(input.candidates, winner.narratives as WhatIfNarrative[]),
          source: "CACHE",
          cacheHit: true,
          refreshing: false,
          usage: winner.usage ?? null,
        };
      }
      return {
        narratives: completeNarratives(input.candidates, []),
        source: "FALLBACK",
        cacheHit: false,
        refreshing: true,
        usage: null,
      };
    }
  }

  const startedAt = Date.now();
  const invocationId = `AI_INVOCATION:${randomUUID()}`;
  try {
    const prompt = aiPrompt(input.candidates, input.role);
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const response = await groq.chat.completions.create({
      model: input.model,
      temperature: 0,
      max_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    });
    const raw = response.choices[0]?.message?.content ?? "{}";
    const narratives = completeNarratives(input.candidates, parseNarratives(raw, input.candidates));
    const usage = {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    };
    await Promise.all([
      whatIfCopilotBriefings.updateOne(
        { _id: input.cacheKey, generationId },
        {
          $set: {
            status: "COMPLETE",
            narratives,
            usage,
            error: null,
            updatedAt: new Date(),
          },
        },
      ),
      aiInvocations.insertOne({
        _id: invocationId,
        feature: "WHAT_IF_COPILOT",
        userId: input.userId,
        role: input.role,
        inputHash: input.candidateHash,
        model: input.model,
        promptVersion: WHAT_IF_COPILOT_PROMPT_VERSION,
        status: "SUCCESS",
        usage,
        latencyMs: Date.now() - startedAt,
        createdAt: new Date(),
      }),
    ]);
    return { narratives, source: "AI", cacheHit: false, refreshing: false, usage };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "AI_GENERATION_FAILED";
    const failedInvocation: AIInvocationDoc = {
      _id: invocationId,
      feature: "WHAT_IF_COPILOT",
      userId: input.userId,
      role: input.role,
      inputHash: input.candidateHash,
      model: input.model,
      promptVersion: WHAT_IF_COPILOT_PROMPT_VERSION,
      status: "FAILED",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      latencyMs: Date.now() - startedAt,
      error: message,
      createdAt: new Date(),
    };
    await Promise.all([
      whatIfCopilotBriefings.updateOne(
        { _id: input.cacheKey, generationId },
        { $set: { status: "FAILED", error: message, updatedAt: new Date() } },
      ),
      aiInvocations.insertOne(failedInvocation),
    ]);
    return {
      narratives: completeNarratives(input.candidates, []),
      source: "FALLBACK",
      cacheHit: false,
      refreshing: false,
      usage: null,
    };
  }
}

export async function getWhatIfCopilot(input: {
  request: WhatIfCopilotRequest;
  userId: string;
  role: Role;
}): Promise<WhatIfCopilotResponse> {
  const { materials, snapshotAt } = await loadLiveScenarioMaterials();
  const plan = recommendMaterialOrders(materials, input.request.input, input.request.fabId);
  const candidates = buildWhatIfCandidates(plan, input.request.fabId, MAX_CANDIDATES);
  const scopeHash = hashValue({
    fabId: input.request.fabId,
    input: input.request.input,
    promptVersion: WHAT_IF_COPILOT_PROMPT_VERSION,
  });
  const candidateHash = hashValue(candidates.map(candidateHashInput));
  const model = process.env.GROQ_WHAT_IF_MODEL?.trim() || DEFAULT_MODEL;

  if (!candidates.length) {
    return {
      scopeHash,
      candidateHash,
      snapshotAt,
      generatedAt: new Date().toISOString(),
      source: "FALLBACK",
      cacheHit: false,
      refreshing: false,
      cards: [],
      candidateCount: 0,
      usage: null,
      model: process.env.GROQ_API_KEY ? model : null,
      promptVersion: WHAT_IF_COPILOT_PROMPT_VERSION,
    };
  }

  const generated = await generateNarratives({
    candidates,
    candidateHash,
    role: input.role,
    userId: input.userId,
    model,
    cacheKey: cacheKeyFor(candidateHash, input.role, model),
  });
  const cards = await cardsWithState({
    candidates,
    narratives: generated.narratives,
    scopeHash,
    userId: input.userId,
  });
  return {
    scopeHash,
    candidateHash,
    snapshotAt,
    generatedAt: new Date().toISOString(),
    source: generated.source,
    cacheHit: generated.cacheHit,
    refreshing: generated.refreshing,
    cards,
    candidateCount: candidates.length,
    usage: generated.usage,
    model: process.env.GROQ_API_KEY ? model : null,
    promptVersion: WHAT_IF_COPILOT_PROMPT_VERSION,
  };
}

export async function setWhatIfCopilotAction(input: {
  userId: string;
  scopeHash: string;
  candidateId: string;
  status: WhatIfCopilotActionStatus;
  reason?: string | null;
}) {
  const now = new Date();
  const snoozedUntil = input.status === "SNOOZED"
    ? new Date(now.getTime() + 24 * 60 * 60 * 1_000)
    : null;
  const doc: WhatIfCopilotActionDoc = {
    _id: actionDocId(input.userId, input.scopeHash, input.candidateId),
    userId: input.userId,
    scopeHash: input.scopeHash,
    candidateId: input.candidateId,
    status: input.status,
    snoozedUntil,
    reason: input.reason?.trim().slice(0, 300) || null,
    createdAt: now,
    updatedAt: now,
  };
  const { whatIfCopilotActions } = await collections();
  await whatIfCopilotActions.updateOne(
    { _id: doc._id },
    {
      $set: {
        status: doc.status,
        snoozedUntil: doc.snoozedUntil,
        reason: doc.reason,
        updatedAt: doc.updatedAt,
      },
      $setOnInsert: {
        _id: doc._id,
        userId: doc.userId,
        scopeHash: doc.scopeHash,
        candidateId: doc.candidateId,
        createdAt: doc.createdAt,
      },
    },
    { upsert: true },
  );
  return {
    candidateId: doc.candidateId,
    status: doc.status,
    snoozedUntil: doc.snoozedUntil?.toISOString() ?? null,
  };
}
