import { timingSafeEqual } from "node:crypto";
import { requireRole } from "@/lib/api-auth";
import { collectMarketSources } from "@/lib/market-ingestion";
import type { MarketSourceId } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function hasCollectorSecret(request: Request): boolean {
  const configured = process.env.MARKET_COLLECTOR_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!configured || !supplied) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function POST(request: Request) {
  if (!hasCollectorSecret(request)) {
    const access = await requireRole(["ADMIN"]);
    if (access.error) return access.error;
  }

  let source: MarketSourceId | "ALL" = "ALL";
  try {
    const body = await request.json() as { source?: string };
    if (body.source === "TWSE" || body.source === "SEC" || body.source === "ALL") source = body.source;
    else if (body.source !== undefined) return Response.json({ error: "source는 TWSE, SEC, ALL 중 하나여야 합니다." }, { status: 400 });
  } catch {
    // 본문이 없으면 전체 소스를 수집한다.
  }

  const results = await collectMarketSources(source);
  const failed = results.some((result) => result.status === "FAILED");
  return Response.json({ results }, { status: failed ? 502 : 200 });
}
