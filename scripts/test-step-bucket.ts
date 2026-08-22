import assert from "node:assert/strict";
import { buildSeedCounts, computeStepFlow } from "../src/lib/twin/step-bucket";
import type { StepConsumption } from "../src/lib/twin/burn";

const EPSILON = 1e-9;

function assertClose(actual: number, expected: number, message: string): void {
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message}: expected=${expected}, actual=${actual}`);
}

function assertCountsClose(actual: number[], expected: number[], message: string): void {
  assert.equal(actual.length, expected.length, `${message}: length`);
  actual.forEach((value, index) => assertClose(value, expected[index], `${message}[${index}]`));
}

const seed = buildSeedCounts(5, 12);
assert.equal(seed.reduce((sum, count) => sum + count, 0), 12);
assert.ok(Math.max(...seed) - Math.min(...seed) <= 1, "seed는 route에 균등 분포한다");

const noConsumption: StepConsumption = new Map();
const baseInput = {
  counts: [10, 20, 30],
  quantumCount: 1,
  quantumOperatingDays: 0.1,
  stepDwellDays: 1,
  dailyRate: 3,
  target: 60,
  stepConsumption: noConsumption,
  blockedMaterialIds: new Set<string>(),
  finishedGoodsCapacityOver: false,
  wafersPerFoup: 25,
};

const result = computeStepFlow(baseInput);
assertCountsClose(result.nextCounts, [9.3, 19, 29], "10% 부분 이동");
assertClose(result.advancedFoup, 6, "전체 이동 FOUP_EQ");
assertClose(result.completedFoup, 3, "마지막 스텝 완료량");
assertClose(result.completedWaferQty, 75, "완료 웨이퍼");
assertClose(result.releasedFoup, 0.3, "운영시간 비례 투입");
assertClose(result.processedOperatingDays, 0.1, "처리 운영시간");
assertClose(
  result.nextCounts.reduce((sum, count) => sum + count, 0),
  baseInput.counts.reduce((sum, count) => sum + count, 0) + result.releasedFoup - result.completedFoup,
  "WIP 질량보존",
);

const noTime = computeStepFlow({ ...baseInput, quantumCount: 0 });
assertCountsClose(noTime.nextCounts, baseInput.counts, "운영시간 0이면 무이동");
assert.equal(noTime.advancedFoup, 0);
assert.equal(noTime.releasedFoup, 0);

const withConsumption: StepConsumption = new Map([
  [1, [{ materialId: "MAT-A", equivalentPerWafer: 2 }]],
]);
const burn = computeStepFlow({
  ...baseInput,
  counts: [0, 20, 0],
  target: 20,
  dailyRate: 0,
  stepConsumption: withConsumption,
});
assertClose(burn.burnByMaterial.get("MAT-A") ?? 0, 100, "2 FOUP×25 wafer×2 원단위");

const materialBlocked = computeStepFlow({
  ...baseInput,
  counts: [0, 20, 0],
  target: 20,
  dailyRate: 0,
  stepConsumption: withConsumption,
  blockedMaterialIds: new Set(["MAT-A"]),
});
assertCountsClose(materialBlocked.nextCounts, [0, 20, 0], "자재 차단은 제자리");
assertClose(materialBlocked.blockedFoup, 2, "이번 퀀텀에 이동할 양만 차단 집계");
assert.equal(materialBlocked.burnByMaterial.get("MAT-A") ?? 0, 0);

const finishedGoodsBlocked = computeStepFlow({
  ...baseInput,
  counts: [0, 0, 30],
  target: 30,
  dailyRate: 0,
  finishedGoodsCapacityOver: true,
});
assertCountsClose(finishedGoodsBlocked.nextCounts, [0, 0, 30], "완제품 포화는 마지막 스텝 유지");
assert.equal(finishedGoodsBlocked.completedFoup, 0);
assertClose(finishedGoodsBlocked.blockedFoup, 3, "마지막 스텝 이동 예정량 차단");

const tenAtOnce = computeStepFlow({ ...baseInput, quantumCount: 10 });
let splitCounts = baseInput.counts;
let splitCompleted = 0;
let splitReleased = 0;
for (let i = 0; i < 10; i++) {
  const step = computeStepFlow({ ...baseInput, counts: splitCounts, quantumCount: 1 });
  splitCounts = step.nextCounts;
  splitCompleted += step.completedFoup;
  splitReleased += step.releasedFoup;
}
assertCountsClose(tenAtOnce.nextCounts, splitCounts, "퀀텀 분할 불변성");
assertClose(tenAtOnce.completedFoup, splitCompleted, "완료량 분할 불변성");
assertClose(tenAtOnce.releasedFoup, splitReleased, "투입량 분할 불변성");

const steady = computeStepFlow({
  ...baseInput,
  counts: [10, 10, 10],
  quantumCount: 100,
  dailyRate: 10,
  target: 30,
});
assertCountsClose(steady.nextCounts, [10, 10, 10], "정상상태 WIP 유지");
assertClose(steady.completedFoup, 100, "10 운영일×10 FOUP/day 완료");
assertClose(steady.releasedFoup, 100, "완료량만큼 재투입");

console.log("✅ step-bucket 운영시간 부분 흐름 통과");
