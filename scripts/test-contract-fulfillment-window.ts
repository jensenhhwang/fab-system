import assert from "node:assert/strict";
import { operatingMonthRange } from "../src/lib/customer-contracts";
import { operatingDaysToMs } from "../src/lib/twin/operating-clock";

// 자동출하는 운영시간 기준으로 나간다(auto-shipment: due = 월계약/30 × 운영일수).
// 집계 창이 벽시계 달력 월이면 분자에 운영 24개월치가 쌓이고 분모는 운영 1개월치다.
// 실측 2026-08-18: DRAM 6.5배 · NAND 6.4배 · HBM 3.8배 과대.
const r0 = operatingMonthRange(operatingDaysToMs(9.04));
assert.equal(r0.startMs, operatingDaysToMs(0), "9일차는 0개월차 창 — 시작은 운영 0일");
assert.equal(r0.endMs, operatingDaysToMs(30), "0개월차 창의 끝은 운영 30일");

const r1 = operatingMonthRange(operatingDaysToMs(30));
assert.equal(r1.startMs, operatingDaysToMs(30), "30일차부터 1개월차 창이 시작된다");
assert.equal(r1.endMs, operatingDaysToMs(60), "1개월차 창의 끝은 운영 60일");

const r2 = operatingMonthRange(operatingDaysToMs(719));
assert.equal(r2.startMs, operatingDaysToMs(690), "719일차는 23개월차 창");
assert.equal(r2.endMs, operatingDaysToMs(720), "23개월차 창의 끝은 720일");

// 창 폭은 항상 운영 30일이다 — 계약 월량과 같은 축.
for (const d of [0, 5.5, 29.9, 30, 100, 505]) {
  const r = operatingMonthRange(operatingDaysToMs(d));
  assert.equal(r.endMs - r.startMs, operatingDaysToMs(30), `운영 ${d}일차 창 폭은 30일`);
}

console.log("✅ contract fulfillment window passed");
