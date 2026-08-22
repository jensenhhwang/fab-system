import "server-only";

import { randomUUID } from "crypto";
import type { ResponseUsage } from "openai/resources/responses/responses";
import { getDb } from "@/lib/db";

const MICRO_USD_PER_USD = 1_000_000;
const APP_MONTHLY_LIMIT_MICRO_USD = 19 * MICRO_USD_PER_USD;
const RESERVATION_INPUT_FLOOR_TOKENS = 20_000;

type Price = {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
};

// 2026-07-30 OpenAI Standard pricing. Values are micro-USD per token.
const STANDARD_PRICES: Record<string, Price> = {
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 },
  "gpt-5.6": { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 30 },
  "gpt-5.6-sol": { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 30 },
};

type BudgetDoc = {
  _id: string;
  monthKey: string;
  limitMicroUsd: number;
  spentMicroUsd: number;
  reservedMicroUsd: number;
  createdAt: Date;
  updatedAt: Date;
};

type InvocationDoc = {
  _id: string;
  monthKey: string;
  kind: "JUDGMENT" | "REPLY" | "CONCLUSION" | "QUESTION";
  requestedModel: string;
  actualModel: string | null;
  serviceTier: string | null;
  status: "RESERVED" | "COMPLETE" | "FAILED_CHARGED";
  reservedMicroUsd: number;
  actualMicroUsd: number | null;
  usage: ResponseUsage | null;
  createdAt: Date;
  settledAt: Date | null;
};

export class ControlTowerAIBudgetError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ControlTowerAIBudgetError";
  }
}

function priceFor(model: string): Price | null {
  if (model.startsWith("gpt-5.6-luna")) return STANDARD_PRICES["gpt-5.6-luna"];
  if (model === "gpt-5.6" || model.startsWith("gpt-5.6-sol")) return STANDARD_PRICES[model === "gpt-5.6" ? "gpt-5.6" : "gpt-5.6-sol"];
  return null;
}

function kstDateParts(now: Date) {
  const shifted = new Date(now.getTime() + 9 * 60 * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
  };
}

export function controlTowerBudgetMonthKey(now: Date = new Date()) {
  const { year, month } = kstDateParts(now);
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthStartUtc(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1) - 9 * 60 * 60_000);
}

export function controlTowerUsageCostMicroUsd(model: string, usage: ResponseUsage) {
  const price = priceFor(model);
  if (!price) {
    throw new ControlTowerAIBudgetError(
      "CONTROL_TOWER_PRICE_UNKNOWN",
      `등록되지 않은 모델 요금이라 OpenAI 호출을 차단했습니다: ${model}`,
    );
  }
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const cacheWrite = usage.input_tokens_details?.cache_write_tokens ?? 0;
  const uncached = Math.max(0, usage.input_tokens - cached - cacheWrite);
  return Math.ceil(
    uncached * price.input
    + cached * price.cachedInput
    + cacheWrite * price.cacheWrite
    + usage.output_tokens * price.output,
  );
}

function estimatedReservationMicroUsd(input: {
  model: string;
  promptChars: number;
  maxOutputTokens: number;
}) {
  const price = priceFor(input.model);
  if (!price || input.model !== "gpt-5.6-luna") {
    throw new ControlTowerAIBudgetError(
      "CONTROL_TOWER_MODEL_NOT_ALLOWED",
      "안정화 기간에는 gpt-5.6-luna만 호출할 수 있습니다.",
    );
  }
  const estimatedInputTokens = Math.max(
    RESERVATION_INPUT_FLOOR_TOKENS,
    input.promptChars * 2,
  );
  return Math.ceil(
    estimatedInputTokens * price.input
    + input.maxOutputTokens * price.output,
  );
}

async function legacyMonthSpendMicroUsd(monthKey: string) {
  const db = await getDb();
  const docs = await db.collection<{
    model: string;
    usage?: { inputTokens?: number; outputTokens?: number };
    createdAt: Date;
  }>("controlTowerAIEpisodes").find({
    createdAt: { $gte: monthStartUtc(monthKey) },
  }).toArray();
  return docs.reduce((sum, doc) => {
    const price = priceFor(doc.model);
    if (!price) return APP_MONTHLY_LIMIT_MICRO_USD;
    return sum + Math.ceil(
      (doc.usage?.inputTokens ?? 0) * price.input
      + (doc.usage?.outputTokens ?? 0) * price.output,
    );
  }, 0);
}

async function ensureBudget(monthKey: string, now: Date) {
  const db = await getDb();
  const budgets = db.collection<BudgetDoc>("controlTowerAIBudgets");
  const id = `CONTROL_TOWER:${monthKey}`;
  if (await budgets.findOne({ _id: id })) return;
  const legacySpend = await legacyMonthSpendMicroUsd(monthKey);
  await budgets.updateOne(
    { _id: id },
    {
      $setOnInsert: {
        monthKey,
        limitMicroUsd: APP_MONTHLY_LIMIT_MICRO_USD,
        spentMicroUsd: legacySpend,
        reservedMicroUsd: 0,
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
}

async function reserve(input: {
  kind: InvocationDoc["kind"];
  model: string;
  promptChars: number;
  maxOutputTokens: number;
}) {
  const db = await getDb();
  const now = new Date();
  const monthKey = controlTowerBudgetMonthKey(now);
  const budgetId = `CONTROL_TOWER:${monthKey}`;
  const reservedMicroUsd = estimatedReservationMicroUsd(input);
  await ensureBudget(monthKey, now);
  const budgets = db.collection<BudgetDoc>("controlTowerAIBudgets");
  const budget = await budgets.findOneAndUpdate(
    {
      _id: budgetId,
      $expr: {
        $lte: [
          { $add: ["$spentMicroUsd", "$reservedMicroUsd", reservedMicroUsd] },
          "$limitMicroUsd",
        ],
      },
    },
    {
      $inc: { reservedMicroUsd },
      $set: { updatedAt: now },
    },
    { returnDocument: "after" },
  );
  if (!budget) {
    throw new ControlTowerAIBudgetError(
      "CONTROL_TOWER_MONTHLY_BUDGET",
      "관제탑 OpenAI 월 예산 보호 한도에 도달해 새 판단을 보류했습니다.",
    );
  }

  const reservation: InvocationDoc = {
    _id: randomUUID(),
    monthKey,
    kind: input.kind,
    requestedModel: input.model,
    actualModel: null,
    serviceTier: null,
    status: "RESERVED",
    reservedMicroUsd,
    actualMicroUsd: null,
    usage: null,
    createdAt: now,
    settledAt: null,
  };
  try {
    await db.collection<InvocationDoc>("controlTowerAIInvocations").insertOne(reservation);
  } catch (error) {
    await budgets.updateOne(
      { _id: budgetId },
      { $inc: { reservedMicroUsd: -reservedMicroUsd }, $set: { updatedAt: new Date() } },
    );
    throw error;
  }
  return { ...reservation, budgetId };
}

async function settle(input: {
  reservation: Awaited<ReturnType<typeof reserve>>;
  actualMicroUsd: number;
  actualModel: string | null;
  serviceTier: string | null;
  usage: ResponseUsage | null;
  status: InvocationDoc["status"];
}) {
  const db = await getDb();
  const now = new Date();
  const chargedMicroUsd = Math.max(0, Math.ceil(input.actualMicroUsd));
  await db.collection<BudgetDoc>("controlTowerAIBudgets").updateOne(
    {
      _id: input.reservation.budgetId,
      reservedMicroUsd: { $gte: input.reservation.reservedMicroUsd },
    },
    {
      $inc: {
        reservedMicroUsd: -input.reservation.reservedMicroUsd,
        spentMicroUsd: chargedMicroUsd,
      },
      $set: { updatedAt: now },
    },
  );
  await db.collection<InvocationDoc>("controlTowerAIInvocations").updateOne(
    { _id: input.reservation._id, status: "RESERVED" },
    {
      $set: {
        status: input.status,
        actualModel: input.actualModel,
        serviceTier: input.serviceTier,
        actualMicroUsd: chargedMicroUsd,
        usage: input.usage,
        settledAt: now,
      },
    },
  );
}

type BudgetedResponse = {
  model: string;
  service_tier?: string | null;
  usage?: ResponseUsage | null;
};

export async function runBudgetedControlTowerCall<T extends BudgetedResponse>(input: {
  kind: InvocationDoc["kind"];
  model: string;
  promptChars: number;
  maxOutputTokens: number;
  call: () => Promise<T>;
}): Promise<T> {
  const reservation = await reserve(input);
  try {
    const response = await input.call();
    if (!response.usage) {
      throw new ControlTowerAIBudgetError(
        "CONTROL_TOWER_USAGE_MISSING",
        "OpenAI usage가 없어 비용을 확정할 수 없습니다.",
      );
    }
    const actualMicroUsd = controlTowerUsageCostMicroUsd(response.model, response.usage);
    await settle({
      reservation,
      actualMicroUsd,
      actualModel: response.model,
      serviceTier: response.service_tier ?? null,
      usage: response.usage,
      status: "COMPLETE",
    });
    return response;
  } catch (error) {
    await settle({
      reservation,
      actualMicroUsd: reservation.reservedMicroUsd,
      actualModel: null,
      serviceTier: null,
      usage: null,
      status: "FAILED_CHARGED",
    }).catch(() => undefined);
    throw error;
  }
}
