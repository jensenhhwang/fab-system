import "dotenv/config";
import { computeStepAdvance, computeStepRelease, buildSeedCounts } from "../src/lib/twin/step-bucket";
import type { StepConsumption } from "../src/lib/twin/burn";

function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); }

// buildSeedCounts: 합이 정확히 target, 균등 분포.
const seed = buildSeedCounts(5, 12);
assert(seed.reduce((s, c) => s + c, 0) === 12, `seed 합=${seed.reduce((s, c) => s + c, 0)}`);
assert(Math.max(...seed) - Math.min(...seed) <= 1, "seed 균등");

// 소모 없음, 차단 없음: 한 스텝 시프트 + 마지막 스텝 완료.
const noConsumption: StepConsumption = new Map();
const counts = [10, 20, 30]; // 3스텝
const adv = computeStepAdvance({ counts, stepConsumption: noConsumption, blockedMaterialIds: new Set(), finishedGoodsCapacityOver: false, wafersPerFoup: 25 });
assert(JSON.stringify(adv.nextCounts) === JSON.stringify([0, 10, 20]), `nextCounts=${JSON.stringify(adv.nextCounts)}`);
assert(adv.completedFoup === 30, `completedFoup=${adv.completedFoup}`);
assert(adv.completedWaferQty === 30 * 25, `completedWaferQty=${adv.completedWaferQty}`);

// 자재 소모: 스텝 1이 MAT-A를 wafer당 2 소모. 스텝1 count=20, wafers=500 → burn 1000.
const withConsumption: StepConsumption = new Map([[1, [{ materialId: "MAT-A", equivalentPerWafer: 2 }]]]);
const adv2 = computeStepAdvance({ counts: [0, 20, 0], stepConsumption: withConsumption, blockedMaterialIds: new Set(), finishedGoodsCapacityOver: false, wafersPerFoup: 25 });
assert(adv2.burnByMaterial.get("MAT-A") === 1000, `burn=${adv2.burnByMaterial.get("MAT-A")}`);

// 자재 차단: MAT-A가 CRITICAL이면 스텝1 count는 제자리, 소모 0.
const adv3 = computeStepAdvance({ counts: [0, 20, 0], stepConsumption: withConsumption, blockedMaterialIds: new Set(["MAT-A"]), finishedGoodsCapacityOver: false, wafersPerFoup: 25 });
assert(JSON.stringify(adv3.nextCounts) === JSON.stringify([0, 20, 0]), `blocked nextCounts=${JSON.stringify(adv3.nextCounts)}`);
assert(adv3.blockedFoup === 20 && (adv3.burnByMaterial.get("MAT-A") ?? 0) === 0, "blocked no burn");

// 완제품 창고 CAPACITY_OVER: 마지막 스텝 완료 차단.
const adv4 = computeStepAdvance({ counts: [0, 0, 30], stepConsumption: noConsumption, blockedMaterialIds: new Set(), finishedGoodsCapacityOver: true, wafersPerFoup: 25 });
assert(adv4.completedFoup === 0 && adv4.nextCounts[2] === 30, "fg capacity over blocks completion");

// release: target 여유만큼 step0에 투입.
const rel = computeStepRelease({ counts: [0, 0, 0], dailyRate: 100, simDays: 1, carry: 0, target: 50 });
assert(rel.released === 50 && rel.nextCounts[0] === 50, `released=${rel.released}`); // room=50이 wanted=100을 캡
const rel2 = computeStepRelease({ counts: [50, 0, 0], dailyRate: 100, simDays: 1, carry: 0, target: 50 });
assert(rel2.released === 0, "만재고면 release 0");

console.log("✅ step-bucket 순수함수 OK");
