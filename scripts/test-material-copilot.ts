import assert from "node:assert/strict";
import { parseMaterialScenarioPrompt } from "../src/lib/material-copilot";
import { recommendMaterialOrders, type ScenarioMaterial } from "../src/lib/scenario-engine";

const snapshotAt = "2026-07-22T00:00:00.000Z";
const interpreted = parseMaterialScenarioPrompt(
  "다음 달 1일부터 M20 HBM 생산을 6주간 20% 늘려줘",
  snapshotAt,
);
assert.equal(interpreted.fabId, "M20");
assert.equal(interpreted.events[0]?.product, "HBM");
assert.equal(interpreted.events[0]?.changePct, 20);
assert.equal(interpreted.events[0]?.startDay, 10);
assert.equal(interpreted.events[0]?.durationDays, 42);
assert.deepEqual(interpreted.missingFields, []);

const incomplete = parseMaterialScenarioPrompt("HBM 생산을 20% 늘려줘", snapshotAt);
assert.deepEqual(incomplete.missingFields, ["FAB", "시작일", "유지 기간"]);
assert.equal(incomplete.events.length, 0);

const riskReview = parseMaterialScenarioPrompt("지금 주의할 자재를 알려줘", snapshotAt);
assert.equal(riskReview.intent, "RISK_REVIEW");
assert.deepEqual(riskReview.missingFields, []);

const material: ScenarioMaterial = {
  id: "MAT-1",
  code: "MAT-1",
  name: "테스트 자재",
  category: "CHM",
  unit: "kg",
  currentQuantity: 1_000,
  baseDailyUsage: 10,
  ropDays: 10,
  productDailyUsage: { HBM: 10, DRAM: 0, NAND: 0 },
  warehouseCode: "WH-1",
  warehouseName: "테스트 창고",
  occupancyFactor: 1,
  leadTimeDays: 7,
  safeLeadTimeDays: 10,
  supplierName: "테스트 공급사",
  confirmedInboundByDay: [],
  procurementPolicies: { M20: { moq: 100, orderMultiple: 50 } },
  usageSource: "MES_ACTUAL",
  usageSourceVersion: "TEST_V1",
  usageConfidence: "HIGH",
};

const input = {
  events: [{ id: "event", product: "HBM" as const, startDay: 0, changePct: 100, durationDays: 60 }],
  horizonDays: 60,
  replenishmentMode: "ROP" as const,
  coverageDays: 30,
};
const first = recommendMaterialOrders([material], input, "M20");
const second = recommendMaterialOrders([material], input, "M20");
assert.deepEqual(first, second, "같은 스냅샷과 입력은 같은 결과를 내야 합니다.");
const recommendation = first.recommendations[0];
assert.ok(recommendation.incrementalOrderQuantity > 0, "증산 시 추가 발주량이 있어야 합니다.");
assert.ok(recommendation.scenario.recommendedInbound > recommendation.baseline.recommendedInbound);
assert.equal(recommendation.policyAdjustedOrderQuantity % 50, 0, "발주배수를 적용해야 합니다.");
assert.equal(recommendation.classification, "SCENARIO_CAUSED_SHORTAGE");

console.log("material copilot tests passed");
