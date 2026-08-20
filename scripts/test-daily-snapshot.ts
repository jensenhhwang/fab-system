import assert from "node:assert/strict";
import { buildDailySnapshot } from "../src/lib/twin/daily-snapshot";

const base = {
  operatingDay: 9,
  recordedAt: new Date("2026-08-18T12:00:00Z"),
  producedByProduct: { HBM: 190125, DRAM: 4562096, NAND: 4316544 },
  designDailyByProduct: { HBM: 190125, DRAM: 4562096, NAND: 4316544 },
  shippedByProduct: { HBM: 171112, DRAM: 4105886, NAND: 3884889 },
  contractDailyByProduct: { HBM: 171112, DRAM: 4105886, NAND: 3884889 },
  materialDohs: [
    { materialCode: "GAS-001", doh: 0 }, { materialCode: "CHM-001", doh: 0 },
    { materialCode: "CSM-002", doh: 3 }, { materialCode: "GAS-003", doh: 11 },
    { materialCode: "GAS-010", doh: 22 },
  ],
  criticalCount: 3,
  warehouses: [{ code: "MWH-01", utilization: 79, baselineUtilization: 60 }],
  policy: { r1: 0, r2: 0, r3: 0, r4: 0 },
  engine: { ticks: 80, elapsedOperatingMs: 86_400_000, clampedCatchUps: 0 },
};

const snap = buildDailySnapshot(base);

assert.equal(snap._id, "OP-9", "_id는 운영일 기반");
assert.equal(snap.operatingDay, 9);
assert.equal(snap.wallDayKey, "2026-08-18", "벽시계 버킷은 recordedAt의 UTC 날짜");

assert.equal(snap.production.length, 3, "3제품");
assert.equal(snap.production.find(p => p.product === "HBM")!.ratePct, 100, "설계와 같으면 100%");

// 설계 산출이 0인 제품은 비율을 100%로 착각하면 안 된다.
const zero = buildDailySnapshot({
  ...base,
  designDailyByProduct: { HBM: 0, DRAM: 1, NAND: 1 },
  producedByProduct: { HBM: 5, DRAM: 1, NAND: 1 },
});
assert.equal(zero.production.find(p => p.product === "HBM")!.ratePct, 0, "설계 0이면 비율 0 — 0으로 나누지 않는다");

assert.equal(snap.materials.stockoutCount, 2, "DOH 0인 자재가 결품");
assert.equal(snap.materials.criticalCount, 3);
assert.equal(snap.materials.medianDoh, 3, "5개의 중앙값");
assert.equal(snap.materials.worst.length, 5, "하위 5종");
assert.equal(snap.materials.worst[0].materialCode, "GAS-001", "가장 낮은 DOH가 먼저");

// 짝수 개수의 중앙값은 가운데 두 값의 평균.
const even = buildDailySnapshot({
  ...base,
  materialDohs: [
    { materialCode: "A", doh: 1 }, { materialCode: "B", doh: 3 },
    { materialCode: "C", doh: 5 }, { materialCode: "D", doh: 9 },
  ],
});
assert.equal(even.materials.medianDoh, 4, "짝수 중앙값 = (3+5)/2");

// 자재가 하나도 없으면 중앙값 0, 하위 목록 빈 배열 — 화면이 undefined를 만나지 않게.
const empty = buildDailySnapshot({ ...base, materialDohs: [] });
assert.equal(empty.materials.medianDoh, 0);
assert.deepEqual(empty.materials.worst, []);
assert.equal(empty.materials.stockoutCount, 0);

assert.equal(snap.shipments.find(s => s.product === "DRAM")!.fulfillmentPct, 100, "계약과 같으면 100%");
const noContract = buildDailySnapshot({ ...base, contractDailyByProduct: { HBM: 0, DRAM: 1, NAND: 1 } });
assert.equal(noContract.shipments.find(s => s.product === "HBM")!.fulfillmentPct, 0, "계약 0이면 이행률 0");

console.log("✅ daily snapshot passed");
