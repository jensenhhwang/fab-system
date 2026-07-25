import type { MarketObservationDoc } from "@/lib/db";

export const TWSE_REVENUE_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap05_L";
export const DEFAULT_TWSE_CODES = ["2330", "2317", "2382", "3231", "6669"];

export type TwseRow = Record<string, string>;
export type SecRecent = {
  accessionNumber?: string[];
  filingDate?: string[];
  acceptanceDateTime?: string[];
  form?: string[];
  primaryDocument?: string[];
};
export type ParsedMarketObservation = Omit<MarketObservationDoc, "_id" | "rawHash" | "artifactHash" | "revision" | "previousId" | "collectedAt">;

function numberOrNull(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function rocMonthToGregorian(value: string): string {
  const compact = value.trim();
  const month = compact.slice(-2);
  const rocYear = Number(compact.slice(0, -2));
  if (!Number.isInteger(rocYear) || !/^(0[1-9]|1[0-2])$/.test(month)) throw new Error(`잘못된 TWSE 자료년월: ${value}`);
  return `${rocYear + 1911}-${month}`;
}

function rocDateToGregorian(value: string): Date {
  const compact = value.trim();
  const day = compact.slice(-2);
  const month = compact.slice(-4, -2);
  const rocYear = Number(compact.slice(0, -4));
  const date = new Date(`${rocYear + 1911}-${month}-${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`잘못된 TWSE 출표일: ${value}`);
  return date;
}

export function parseTwseRevenue(rows: TwseRow[], trackedCodes = DEFAULT_TWSE_CODES): ParsedMarketObservation[] {
  const tracked = new Set(trackedCodes);
  return rows.filter((row) => tracked.has(row["公司代號"])).map((row) => {
    const period = rocMonthToGregorian(row["資料年月"]);
    const revenue = numberOrNull(row["營業收入-當月營收"]);
    if (revenue === null) throw new Error(`${row["公司代號"]} 월매출 값이 없습니다.`);
    return {
      sourceId: "TWSE",
      metricId: "MONTHLY_REVENUE",
      entityId: row["公司代號"],
      entityName: row["公司名稱"],
      period,
      value: revenue,
      unit: "TWD_THOUSAND",
      changeMoM: numberOrNull(row["營業收入-上月比較增減(%)"]),
      changeYoY: numberOrNull(row["營業收入-去年同月增減(%)"]),
      sourceUrl: TWSE_REVENUE_URL,
      observedAt: new Date(`${period}-01T00:00:00.000Z`),
      publishedAt: rocDateToGregorian(row["出表日期"]),
      quality: "ACTUAL",
      license: "Taiwan Open Government Data License 1.0",
    };
  });
}

export function parseSecSubmissions(
  payload: { cik?: string; name?: string; filings?: { recent?: SecRecent } },
  collectedAt: Date,
): ParsedMarketObservation[] {
  const recent = payload.filings?.recent;
  const forms = recent?.form ?? [];
  const allowed = new Set(["10-K", "10-Q", "8-K"]);
  const cik = String(payload.cik ?? "").padStart(10, "0");
  return forms.flatMap((form, index) => {
    if (!allowed.has(form)) return [];
    const accessionNumber = recent?.accessionNumber?.[index];
    const filingDate = recent?.filingDate?.[index];
    const primaryDocument = recent?.primaryDocument?.[index];
    if (!accessionNumber || !filingDate || !primaryDocument) return [];
    const accessionNoDashes = accessionNumber.replaceAll("-", "");
    const cikNoLeadingZeros = cik.replace(/^0+/, "");
    const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${cikNoLeadingZeros}/${accessionNoDashes}/${primaryDocument}`;
    const publishedAt = new Date(recent?.acceptanceDateTime?.[index] ?? `${filingDate}T00:00:00.000Z`);
    return [{
      sourceId: "SEC" as const,
      metricId: "SEC_FILING" as const,
      entityId: cik,
      entityName: payload.name ?? cik,
      period: filingDate,
      value: null,
      unit: null,
      title: form,
      detail: `${accessionNumber}|${primaryDocument}`,
      sourceUrl,
      observedAt: publishedAt,
      publishedAt,
      quality: "ACTUAL" as const,
      license: "SEC public filings",
    }];
  }).filter((item) => collectedAt.getTime() - item.publishedAt.getTime() <= 180 * 24 * 60 * 60 * 1000);
}
