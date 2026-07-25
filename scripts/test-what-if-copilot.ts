import assert from "node:assert/strict";
import {
  buildWhatIfCandidates,
  fallbackNarrative,
  normalizeWhatIfRequest,
} from "../src/lib/what-if-copilot";
import { recommendMaterialOrders, type ScenarioMaterial } from "../src/lib/scenario-engine";

const material: ScenarioMaterial = {
  id: "MAT-URGENT",
  code: "MAT-URGENT",
  name: "긴급 테스트 자재",
  category: "CHM",
  unit: "kg",
  currentQuantity: 50,
  baseDailyUsage: 10,
  ropDays: 5,
  productDailyUsage: { HBM: 10, DRAM: 0, NAND: 0 },
  warehouseCode: "WH-1",
  warehouseName: "테스트 창고",
  occupancyFactor: 1,
  leadTimeDays: 20,
  supplierName: "테스트 공급사",
  procurementPolicies: { M20: { moq: 100, orderMultiple: 50 } },
  usageSource: "MODELED_BASELINE",
  usageSourceVersion: "TEST_V1",
  usageConfidence: "MEDIUM",
};

const input = {
  events: [{ id: "event-1", product: "HBM" as const, startDay: 0, changePct: 20, durationDays: 30 }],
  horizonDays: 30,
  replenishmentMode: "ROP" as const,
  coverageDays: 30,
};
const plan = recommendMaterialOrders([material], input, "M20");
const candidates = buildWhatIfCandidates(plan, "M20");

assert.equal(candidates.length, 1, "긴급 재고 위험은 행동 후보가 되어야 합니다.");
assert.equal(candidates[0]?.severity, "URGENT", "이미 발주 마감이 지난 후보는 긴급이어야 합니다.");
assert.equal(candidates[0]?.material.id, material.id, "후보는 원본 자재 ID를 보존해야 합니다.");
assert.ok(candidates[0]?.reasonCodes.includes("SCENARIO_CAUSED_SHORTAGE"), "What-if가 만든 부족임을 근거 코드로 남겨야 합니다.");
assert.equal(candidates[0]?.recommendedQuantity % 50, 0, "권장 대응량은 발주 배수를 반영해야 합니다.");

const fallback = fallbackNarrative(candidates[0]!);
assert.equal(fallback.candidateId, candidates[0]?.id, "AI 실패 문구도 기존 후보 ID만 사용해야 합니다.");
assert.ok(candidates[0]?.allowedActions.includes(fallback.actionCode), "Fallback 행동은 허용된 행동이어야 합니다.");

assert.deepEqual(normalizeWhatIfRequest({ fabId: "M20", input }), { fabId: "M20", input }, "유효 입력은 정규화되어야 합니다.");
assert.equal(normalizeWhatIfRequest({ fabId: "M99", input }), null, "알 수 없는 Fab은 거부해야 합니다.");
assert.equal(normalizeWhatIfRequest({
  fabId: "M20",
  input: { ...input, events: [{ ...input.events[0], product: "UNKNOWN" }] },
}), null, "알 수 없는 제품은 거부해야 합니다.");

console.log("✅ What-if AI 행동 후보 계약 통과");
