import assert from "node:assert/strict";
import { buildProcurementShadow } from "../src/lib/procurement-agent";
import type { MaterialRecommendation, ScenarioMaterial } from "../src/lib/scenario-engine";

function mat(over: Partial<ScenarioMaterial> & Pick<ScenarioMaterial, "id" | "code" | "name" | "category" | "unit">): ScenarioMaterial {
  return {
    currentQuantity: 0,
    baseDailyUsage: 1,
    productDailyUsage: { HBM: 1, DRAM: 0, NAND: 0 },
    leadTimeDays: 14,
    safeLeadTimeDays: 21,
    supplierName: "기본공급사",
    ...over,
  } as ScenarioMaterial;
}

function rec(over: Partial<MaterialRecommendation> & Pick<MaterialRecommendation, "material" | "classification">): MaterialRecommendation {
  return {
    baseline: { grossRequirement: 0, recommendedInbound: 0, firstNeedDay: null },
    scenario: { grossRequirement: 0, recommendedInbound: 0, firstNeedDay: 9 },
    netInputs: { onHand: 100, reserved: 0, qualityBlocked: 0, available: 100, confirmedInbound: 0 },
    additionalRequirement: 500,
    incrementalOrderQuantity: 480,
    policyAdjustedOrderQuantity: 500,
    needByDay: 9,
    normalOrderByDay: -5,
    safeOrderByDay: -12,
    warnings: [],
    evidence: { formulaVersion: "MATERIAL_COPILOT_V1", usageSource: "MODELED_BASELINE", usageSourceVersion: null },
    ...over,
  } as MaterialRecommendation;
}

const now = new Date(2026, 6, 26, 9, 0, 0).toISOString();

const recs: MaterialRecommendation[] = [
  // L4 가능: 소모품(CSM), 대체 공급사 2개, 발주 필요
  rec({
    material: mat({
      id: "CSM-004", code: "CSM-004", name: "CMP 패드", category: "CSM", unit: "EA",
      procurementAlternatives: [
        { supplierName: "A", standardDays: 14, emergencyOrderAllowed: true },
        { supplierName: "B", standardDays: 20, emergencyOrderAllowed: false },
      ],
    }),
    classification: "SCENARIO_CAUSED_SHORTAGE",
    safeOrderByDay: -3,
  }),
  // 위험물(GAS): L2 상한 → 제안만
  rec({
    material: mat({
      id: "GAS-004", code: "GAS-004", name: "실란 (SiH₄)", category: "GAS", unit: "봄베",
      procurementAlternatives: [
        { supplierName: "X", standardDays: 14, emergencyOrderAllowed: false },
        { supplierName: "Y", standardDays: 30, emergencyOrderAllowed: false },
      ],
    }),
    classification: "EXISTING_SHORTAGE",
    safeOrderByDay: -20,
    baseline: { grossRequirement: 0, recommendedInbound: 300, firstNeedDay: 4 },
    incrementalOrderQuantity: 0,
    policyAdjustedOrderQuantity: 0,
  }),
  // 리드타임 미등록 → BLOCKED
  rec({
    material: mat({
      id: "CSM-009", code: "CSM-009", name: "Probe Card", category: "CSM", unit: "EA",
      leadTimeDays: null, safeLeadTimeDays: null,
      procurementAlternatives: [{ supplierName: "Z", standardDays: null, emergencyOrderAllowed: false }],
    }),
    classification: "SCENARIO_CAUSED_SHORTAGE",
    safeOrderByDay: null,
    warnings: [{ code: "LEAD_TIME_MISSING", label: "리드타임 미등록", severity: "HIGH" }],
  }),
  // 발주 불필요 → 제외
  rec({
    material: mat({ id: "UTL-001", code: "UTL-001", name: "DIW", category: "UTL", unit: "L" }),
    classification: "NO_INCREMENTAL_ORDER",
  }),
];

const report = buildProcurementShadow(recs, "M20 HBM +20% (What-if #S-2041)", now);

// 그림자모드 표시 + 발주 불필요 제외
assert.equal(report.shadowMode, true);
assert.equal(report.chains.length, 3, "NO_INCREMENTAL_ORDER 제외 → 3건");
assert.equal(report.policyVersion, "PROCUREMENT_SHADOW_V0");

// 정렬: 안전마감 급한 순 (GAS -20 → CSM-004 -3 → Probe null 마지막)
assert.deepEqual(report.chains.map((c) => c.materialCode), ["GAS-004", "CSM-004", "CSM-009"], "urgency 정렬");

const csm = report.chains.find((c) => c.materialId === "CSM-004")!;
const gas = report.chains.find((c) => c.materialId === "GAS-004")!;
const probe = report.chains.find((c) => c.materialId === "CSM-009")!;

// L4 소모품 → 잠정입고 실행했을 것
assert.equal(csm.autonomyCeiling, 4, "CSM 다중공급사 → L4");
assert.equal(csm.verdict, "WOULD_AUTO_RECEIVE");
assert.ok(csm.verdictText.includes("잠정입고"), "L4 판정 문구");
assert.equal(csm.proposedQuantity, 500, "MOQ 반영 발주량");

// 위험물 → L2 상한, 제안만
assert.equal(gas.autonomyCeiling, 2, "GAS → L2 상한");
assert.equal(gas.verdict, "WOULD_PROPOSE");
assert.ok(gas.reasonCodes.includes("HAZMAT_AUTONOMY_CAP"), "위험물 상한 reasonCode");
assert.ok(gas.ceilingReason?.includes("위험물"));
assert.equal(gas.proposedQuantity, 300, "EXISTING_SHORTAGE는 기준 보충량 사용");

// 리드타임 미등록 → BLOCKED
assert.equal(probe.verdict, "BLOCKED", "리드타임 미등록 → BLOCKED");
const leadStep = probe.steps.find((s) => s.key === "LEAD_TIME")!;
assert.equal(leadStep.status, "BLOCKED");

// 4단계 사슬 항상 존재
for (const c of report.chains) {
  assert.deepEqual(c.steps.map((s) => s.key), ["PLAN_SIGNAL", "SHORTAGE", "LEAD_TIME", "ORDER_DECISION"], "4단계 사슬");
}

// 요약 집계
assert.equal(report.summary.actionable, 3);
assert.equal(report.summary.wouldAutoReceive, 1);
assert.equal(report.summary.wouldPropose, 1);
assert.equal(report.summary.blocked, 1);

// 빈 입력
const empty = buildProcurementShadow([], "없음", now);
assert.equal(empty.chains.length, 0);
assert.equal(empty.summary.actionable, 0);

console.log("✅ procurement-agent 그림자 로직 통과");
