import "server-only";

import { collections, type MarketSourceDoc } from "@/lib/db";
import { DEMO_PRICING, type MarketDashboardData, type MarketFreshness, type MarketSourceView } from "@/lib/market-data";

const SOURCE_DEFAULTS = {
  TWSE: {
    label: "TWSE 상장사 월매출",
    officialUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap05_L",
    cadence: "공식 데이터 일 1회 확인",
    freshnessMs: 36 * 60 * 60 * 1000,
  },
  SEC: {
    label: "SEC EDGAR 공시",
    officialUrl: "https://data.sec.gov/submissions/",
    cadence: "15분 확인",
    freshnessMs: 45 * 60 * 1000,
  },
} as const;

function sourceView(id: "TWSE" | "SEC", doc: MarketSourceDoc | undefined, now: Date): MarketSourceView {
  const defaults = SOURCE_DEFAULTS[id];
  let freshness: MarketFreshness = id === "SEC" && !process.env.MARKET_DATA_CONTACT_EMAIL ? "DISABLED" : "NEVER_COLLECTED";
  if (doc?.status === "DISABLED") freshness = "DISABLED";
  else if (doc?.status === "ERROR") freshness = "ERROR";
  else if (doc?.lastSuccessAt) freshness = now.getTime() - doc.lastSuccessAt.getTime() > doc.freshnessMs ? "STALE" : "FRESH";
  return {
    id,
    label: doc?.label ?? defaults.label,
    officialUrl: doc?.officialUrl ?? defaults.officialUrl,
    cadence: doc?.cadence ?? defaults.cadence,
    freshness,
    lastAttemptAt: doc?.lastAttemptAt?.toISOString() ?? null,
    lastSuccessAt: doc?.lastSuccessAt?.toISOString() ?? null,
    error: doc?.lastError ?? (freshness === "DISABLED" ? "MARKET_DATA_CONTACT_EMAIL 미설정" : null),
  };
}

export async function getMarketDashboardData(): Promise<MarketDashboardData> {
  const now = new Date();
  try {
    const { marketSources, marketObservations } = await collections();
    const [sourceDocs, twseDocs, secDocs] = await Promise.all([
      marketSources.find({}).toArray(),
      marketObservations.find({ sourceId: "TWSE", metricId: "MONTHLY_REVENUE" }).sort({ collectedAt: -1, revision: -1 }).limit(100).toArray(),
      marketObservations.find({ sourceId: "SEC", metricId: "SEC_FILING" }).sort({ publishedAt: -1 }).limit(12).toArray(),
    ]);
    const sourceMap = new Map(sourceDocs.map((item) => [item._id, item]));
    const latestByCompany = new Map<string, (typeof twseDocs)[number]>();
    for (const doc of twseDocs) if (!latestByCompany.has(doc.entityId)) latestByCompany.set(doc.entityId, doc);
    return {
      ...DEMO_PRICING,
      live: {
        sources: [sourceView("TWSE", sourceMap.get("TWSE"), now), sourceView("SEC", sourceMap.get("SEC"), now)],
        twseRevenue: [...latestByCompany.values()].map((doc) => ({
          companyCode: doc.entityId,
          companyName: doc.entityName,
          period: doc.period,
          revenueTwdThousand: doc.value ?? 0,
          changeMoM: doc.changeMoM ?? null,
          changeYoY: doc.changeYoY ?? null,
          publishedAt: doc.publishedAt.toISOString(),
          collectedAt: doc.collectedAt.toISOString(),
          sourceUrl: doc.sourceUrl,
        })),
        secFilings: secDocs.map((doc) => {
          const [accessionNumber = "", primaryDocument = ""] = (doc.detail ?? "").split("|");
          return {
            cik: doc.entityId,
            companyName: doc.entityName,
            form: doc.title ?? "Filing",
            filedAt: doc.period,
            accessionNumber,
            primaryDocument,
            collectedAt: doc.collectedAt.toISOString(),
            sourceUrl: doc.sourceUrl,
          };
        }),
      },
      lastRefreshedAt: now.toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "시장 DB 조회 실패";
    return {
      ...DEMO_PRICING,
      live: {
        sources: (["TWSE", "SEC"] as const).map((id) => ({
          ...sourceView(id, undefined, now),
          freshness: "ERROR",
          error: message,
        })),
        twseRevenue: [],
        secFilings: [],
      },
      lastRefreshedAt: now.toISOString(),
    };
  }
}

export function shouldRefreshMarketSources(data: MarketDashboardData): boolean {
  return data.live.sources.some((source) => source.freshness === "STALE" || source.freshness === "ERROR" || source.freshness === "NEVER_COLLECTED");
}
