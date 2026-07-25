import assert from "node:assert/strict";
import { parseSecSubmissions, parseTwseRevenue } from "../src/lib/market-parsers";

const [twse] = parseTwseRevenue([{
  "出表日期": "1150717",
  "資料年月": "11506",
  "公司代號": "2330",
  "公司名稱": "台積電",
  "營業收入-當月營收": "263,709,900",
  "營業收入-上月比較增減(%)": "5.4",
  "營業收入-去年同月增減(%)": "26.9",
}], ["2330"]);

assert.equal(twse.period, "2026-06");
assert.equal(twse.value, 263_709_900);
assert.equal(twse.publishedAt.toISOString(), "2026-07-17T00:00:00.000Z");
assert.equal(twse.changeYoY, 26.9);

const [sec] = parseSecSubmissions({
  cik: "1045810",
  name: "NVIDIA CORP",
  filings: {
    recent: {
      accessionNumber: ["0001045810-26-000001", "0001045810-26-000002"],
      filingDate: ["2026-07-20", "2026-07-19"],
      acceptanceDateTime: ["2026-07-20T16:01:00.000Z", "2026-07-19T16:01:00.000Z"],
      form: ["10-Q", "4"],
      primaryDocument: ["nvda-20260720.htm", "ownership.xml"],
    },
  },
}, new Date("2026-07-25T00:00:00.000Z"));

assert.equal(sec.entityId, "0001045810");
assert.equal(sec.title, "10-Q");
assert.match(sec.sourceUrl, /Archives\/edgar\/data\/1045810\/000104581026000001\/nvda-20260720\.htm$/);

console.log("market parser tests passed");
