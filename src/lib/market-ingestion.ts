import "server-only";

import { createHash } from "node:crypto";
import { collections, type MarketSourceId } from "@/lib/db";
import {
  DEFAULT_TWSE_CODES,
  parseSecSubmissions,
  parseTwseRevenue,
  TWSE_REVENUE_URL,
  type ParsedMarketObservation,
  type SecRecent,
  type TwseRow,
} from "@/lib/market-parsers";

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_SEC_COMPANIES = [
  { cik: "0001045810", name: "NVIDIA" },
  { cik: "0000723125", name: "Micron" },
  { cik: "0000002488", name: "AMD" },
  { cik: "0000789019", name: "Microsoft" },
  { cik: "0001326801", name: "Meta" },
  { cik: "0001018724", name: "Amazon" },
];

async function fetchJson(url: string, headers?: HeadersInit): Promise<{ text: string; json: unknown; hash: string; contentType: string }> {
  const response = await fetch(url, {
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_RESPONSE_BYTES) throw new Error("외부 응답 크기 제한을 초과했습니다.");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("외부 응답 크기 제한을 초과했습니다.");
  return {
    text,
    json: JSON.parse(text),
    hash: createHash("sha256").update(text).digest("hex"),
    contentType: response.headers.get("content-type") ?? "application/json",
  };
}

function windowKey(sourceId: MarketSourceId, now: Date): string {
  const minutes = sourceId === "SEC" ? Math.floor(now.getUTCMinutes() / 15) * 15 : 0;
  const date = new Date(now);
  date.setUTCMinutes(minutes, 0, 0);
  return sourceId === "SEC" ? date.toISOString().slice(0, 16) : date.toISOString().slice(0, 13);
}

async function persistObservation(observation: ParsedMarketObservation, artifactHash: string, collectedAt: Date): Promise<boolean> {
  const { marketObservations } = await collections();
  const rawHash = createHash("sha256").update(JSON.stringify(observation)).digest("hex");
  const latest = await marketObservations.findOne(
    {
      sourceId: observation.sourceId,
      metricId: observation.metricId,
      entityId: observation.entityId,
      period: observation.period,
    },
    { sort: { revision: -1 } },
  );
  if (latest?.rawHash === rawHash) return false;
  const revision = (latest?.revision ?? 0) + 1;
  const idSeed = `${observation.sourceId}|${observation.metricId}|${observation.entityId}|${observation.period}|${revision}`;
  await marketObservations.insertOne({
    ...observation,
    _id: createHash("sha256").update(idSeed).digest("hex"),
    rawHash,
    artifactHash,
    revision,
    previousId: latest?._id ?? null,
    collectedAt,
  });
  return true;
}

async function claimRun(sourceId: MarketSourceId, now: Date): Promise<string | null> {
  const { marketIngestionRuns } = await collections();
  const window = windowKey(sourceId, now);
  const _id = `${sourceId}:${window}`;
  try {
    await marketIngestionRuns.insertOne({
      _id,
      sourceId,
      window,
      status: "RUNNING",
      startedAt: now,
      fetchedCount: 0,
      storedCount: 0,
    });
    return _id;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === 11000) return null;
    throw error;
  }
}

async function updateSource(
  sourceId: MarketSourceId,
  status: "HEALTHY" | "ERROR" | "DISABLED",
  now: Date,
  error: string | null,
) {
  const { marketSources } = await collections();
  const config = sourceId === "TWSE"
    ? { label: "TWSE 상장사 월매출", officialUrl: TWSE_REVENUE_URL, cadence: "공식 데이터 일 1회 확인", freshnessMs: 36 * 60 * 60 * 1000 }
    : { label: "SEC EDGAR 공시", officialUrl: "https://data.sec.gov/submissions/", cadence: "15분 확인", freshnessMs: 45 * 60 * 1000 };
  await marketSources.updateOne(
    { _id: sourceId },
    {
      $set: {
        ...config,
        status,
        lastAttemptAt: now,
        lastError: error,
        updatedAt: now,
        ...(status === "HEALTHY" ? { lastSuccessAt: now } : {}),
      },
    },
    { upsert: true },
  );
}

async function collectTwse(now: Date): Promise<{ sourceId: MarketSourceId; status: string; fetched: number; stored: number }> {
  const runId = await claimRun("TWSE", now);
  if (!runId) return { sourceId: "TWSE", status: "SKIPPED", fetched: 0, stored: 0 };
  const { marketIngestionRuns, marketRawArtifacts } = await collections();
  try {
    const response = await fetchJson(TWSE_REVENUE_URL);
    const rows = response.json as TwseRow[];
    const configuredCodes = process.env.TWSE_TRACKED_CODES?.split(",").map((item) => item.trim()).filter(Boolean);
    const observations = parseTwseRevenue(rows, configuredCodes?.length ? configuredCodes : DEFAULT_TWSE_CODES);
    const selectedPayload = JSON.stringify(rows.filter((row) => observations.some((item) => item.entityId === row["公司代號"])));
    await marketRawArtifacts.updateOne(
      { _id: `TWSE:${response.hash}` },
      { $setOnInsert: { _id: `TWSE:${response.hash}`, sourceId: "TWSE", hash: response.hash, sourceUrl: TWSE_REVENUE_URL, contentType: response.contentType, payload: selectedPayload, collectedAt: now } },
      { upsert: true },
    );
    let stored = 0;
    for (const observation of observations) stored += Number(await persistObservation(observation, response.hash, now));
    await marketIngestionRuns.updateOne({ _id: runId }, { $set: { status: "SUCCESS", finishedAt: new Date(), fetchedCount: observations.length, storedCount: stored } });
    await updateSource("TWSE", "HEALTHY", now, null);
    return { sourceId: "TWSE", status: "SUCCESS", fetched: observations.length, stored };
  } catch (error) {
    const message = error instanceof Error ? error.message : "TWSE 수집 실패";
    await marketIngestionRuns.updateOne({ _id: runId }, { $set: { status: "FAILED", finishedAt: new Date(), error: message } });
    await updateSource("TWSE", "ERROR", now, message);
    return { sourceId: "TWSE", status: "FAILED", fetched: 0, stored: 0 };
  }
}

async function collectSec(now: Date): Promise<{ sourceId: MarketSourceId; status: string; fetched: number; stored: number }> {
  const contact = process.env.MARKET_DATA_CONTACT_EMAIL?.trim();
  if (!contact) {
    await updateSource("SEC", "DISABLED", now, "MARKET_DATA_CONTACT_EMAIL 미설정");
    return { sourceId: "SEC", status: "DISABLED", fetched: 0, stored: 0 };
  }
  const runId = await claimRun("SEC", now);
  if (!runId) return { sourceId: "SEC", status: "SKIPPED", fetched: 0, stored: 0 };
  const { marketIngestionRuns, marketRawArtifacts } = await collections();
  try {
    let fetched = 0;
    let stored = 0;
    for (const company of DEFAULT_SEC_COMPANIES) {
      const sourceUrl = `https://data.sec.gov/submissions/CIK${company.cik}.json`;
      const response = await fetchJson(sourceUrl, {
        "User-Agent": `FabMarketCollector/1.0 ${contact}`,
        Accept: "application/json",
      });
      const payload = response.json as { cik?: string; name?: string; filings?: { recent?: SecRecent } };
      payload.name ||= company.name;
      const observations = parseSecSubmissions(payload, now);
      fetched += observations.length;
      await marketRawArtifacts.updateOne(
        { _id: `SEC:${response.hash}` },
        { $setOnInsert: { _id: `SEC:${response.hash}`, sourceId: "SEC", hash: response.hash, sourceUrl, contentType: response.contentType, payload: response.text, collectedAt: now } },
        { upsert: true },
      );
      for (const observation of observations) stored += Number(await persistObservation(observation, response.hash, now));
    }
    await marketIngestionRuns.updateOne({ _id: runId }, { $set: { status: "SUCCESS", finishedAt: new Date(), fetchedCount: fetched, storedCount: stored } });
    await updateSource("SEC", "HEALTHY", now, null);
    return { sourceId: "SEC", status: "SUCCESS", fetched, stored };
  } catch (error) {
    const message = error instanceof Error ? error.message : "SEC 수집 실패";
    await marketIngestionRuns.updateOne({ _id: runId }, { $set: { status: "FAILED", finishedAt: new Date(), error: message } });
    await updateSource("SEC", "ERROR", now, message);
    return { sourceId: "SEC", status: "FAILED", fetched: 0, stored: 0 };
  }
}

export async function collectMarketSources(source: MarketSourceId | "ALL" = "ALL") {
  const now = new Date();
  const jobs = source === "ALL" ? [collectTwse(now), collectSec(now)] : [source === "TWSE" ? collectTwse(now) : collectSec(now)];
  return Promise.all(jobs);
}
