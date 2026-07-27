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

// CSM-004: 상한은 L4지만 SCENARIO_CAUSED_SHORTAGE(신규 변화)라 에이전트는 L2를 추천 → 기본은 제안까지만
assert.equal(csm.autonomyCeiling, 4, "CSM 다중공급사 → 상한 L4");
assert.equal(csm.autonomyRecommendation.level, 2, "신규 변화라 에이전트 추천은 L2");
assert.equal(csm.autonomyRecommendation.code, "NOVEL_SHORTAGE_L2");
assert.equal(csm.effectiveAutonomy, 2, "override 없으면 추천값 그대로 적용");
assert.equal(csm.verdict, "WOULD_PROPOSE", "추천이 L2라 기본은 제안");
assert.equal(csm.proposedQuantity, 500, "MOQ 반영 발주량");

// 위험물 → L2 상한, 제안만, 추천도 상한에 고정
assert.equal(gas.autonomyCeiling, 2, "GAS → L2 상한");
assert.equal(gas.autonomyRecommendation.level, 2, "상한이 2면 추천도 2로 고정");
assert.equal(gas.autonomyRecommendation.code, "CEILING_LOCKED");
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

// 요약 집계 (CSM-004 기본이 WOULD_PROPOSE로 바뀌어 GAS-004와 합쳐 2건)
assert.equal(report.summary.actionable, 3);
assert.equal(report.summary.wouldAutoReceive, 0);
assert.equal(report.summary.wouldPropose, 2);
assert.equal(report.summary.blocked, 1);

// ── 에이전트 추천: 안정적 반복 부족(EXISTING_SHORTAGE) + 위험신호 없음 + 다중공급사 → L4 추천 ──
const stableRec = rec({
  material: mat({
    id: "CSM-020", code: "CSM-020", name: "PVD 타겟", category: "CSM", unit: "EA",
    procurementAlternatives: [
      { supplierName: "A", standardDays: 14, emergencyOrderAllowed: true },
      { supplierName: "B", standardDays: 20, emergencyOrderAllowed: false },
    ],
  }),
  classification: "EXISTING_SHORTAGE",
  baseline: { grossRequirement: 0, recommendedInbound: 200, firstNeedDay: 5 },
  incrementalOrderQuantity: 0,
  policyAdjustedOrderQuantity: 0,
  warnings: [],
});
const stableReport = buildProcurementShadow([stableRec], "위험 점검", now);
const stable = stableReport.chains[0];
assert.equal(stable.autonomyRecommendation.level, 4, "안정적 반복 부족 + 무경고 → 에이전트가 L4 추천");
assert.equal(stable.autonomyRecommendation.code, "STABLE_PATTERN_L4");
assert.equal(stable.effectiveAutonomy, 4, "override 없어도 추천대로 적용");
assert.equal(stable.verdict, "WOULD_AUTO_RECEIVE");
assert.ok(stable.verdictText.includes("에이전트 추천 L4"), "판정문구에 추천 출처 표기");

// ── 사람 override: 에이전트가 L2 추천했어도 사람이 L4로 확정하면 상한 이내에서 반영 ──
const overrideUp = buildProcurementShadow(recs, "M20 HBM +20%", now, { "CSM-004": 4 });
const csmOverridden = overrideUp.chains.find((c) => c.materialId === "CSM-004")!;
assert.equal(csmOverridden.autonomyRecommendation.level, 2, "에이전트 추천 자체는 안 바뀜");
assert.equal(csmOverridden.autonomyOverride, 4, "사람 override 기록됨");
assert.equal(csmOverridden.effectiveAutonomy, 4, "override가 적용값을 덮어씀");
assert.equal(csmOverridden.verdict, "WOULD_AUTO_RECEIVE");
assert.ok(csmOverridden.verdictText.includes("사람이 L4 확정"));

// ── 안전 백스탑: 위험물(상한 L2)에 사람이 L4 override를 시도해도 절대 못 넘는다 ──
const overrideBlocked = buildProcurementShadow(recs, "M20 HBM +20%", now, { "GAS-004": 4 });
const gasOverridden = overrideBlocked.chains.find((c) => c.materialId === "GAS-004")!;
assert.equal(gasOverridden.autonomyOverride, 4, "override 시도 자체는 기록");
assert.equal(gasOverridden.effectiveAutonomy, 2, "하드 상한이 override를 이긴다");
assert.equal(gasOverridden.verdict, "WOULD_PROPOSE", "위험물은 override로도 자동입고로 못 감");

// 빈 입력
const empty = buildProcurementShadow([], "없음", now);
assert.equal(empty.chains.length, 0);
assert.equal(empty.summary.actionable, 0);

console.log("✅ procurement-agent 그림자 로직 + 자율등급 추천/override 통과");
