import assert from "node:assert/strict";
import {
  autonomyCeiling, approvalEscalationTier, buildProcurementShadow, initialPurchaseOrderStatus,
  shouldAutoApprovePendingOrder, buildLiveProcurementShadow, type ProcurementLiveOrderSignal,
} from "../src/lib/procurement-agent";
import type { MaterialRecommendation, ScenarioMaterial } from "../src/lib/scenario-engine";

// P1a 회귀: autonomyCeiling을 MaterialRecommendation 없이, category·procurementAlternatives만으로
// 직접 호출할 수 있어야 한다(Twin 발주 루프가 재사용할 수 있게 시그니처를 축소했다).
//
// I2 회귀 배경: GAS/CHM 카테고리 전체를 위험물로 뭉뚱그려 L2를 걸었더니(승인 필요) 44종 중
// 41종이 승인대기로 쌓였다. 실제로는 벌크가스(N2·Ar 등)·벌크케미컬(BCDS)은 밴더관리 자동보충이
// 업계 관행이라 승인이 필요없고, 개별 실린더(SPECIALTY_CYLINDER)에 든 특수가스만 진짜 위험물
// 취급이 필요하다. supplyMode로 더 정확하게 판정한다.
assert.equal(autonomyCeiling({ category: "GAS", supplyMode: "SPECIALTY_CYLINDER", procurementAlternatives: [{ supplierName: "X", standardDays: 10, emergencyOrderAllowed: false }] }).level, 2, "개별 실린더 특수가스는 대체공급사 있어도 L2");
assert.equal(autonomyCeiling({ category: "GAS", supplyMode: "BULK_GAS", procurementAlternatives: [{ supplierName: "X", standardDays: 10, emergencyOrderAllowed: false }] }).level, 4, "벌크가스는 밴더관리 자동보충 — 대체공급사 있으면 L4");
assert.equal(autonomyCeiling({ category: "CHM", supplyMode: "BULK_CHEMICAL", procurementAlternatives: [{ supplierName: "X", standardDays: 10, emergencyOrderAllowed: false }] }).level, 4, "벌크케미컬(BCDS)도 대체공급사 있으면 L4");
assert.equal(autonomyCeiling({ category: "CHM", supplyMode: "DRUM_CHEMICAL", procurementAlternatives: [] }).level, 2, "드럼케미컬도 단일소싱이면 L2(위험물 사유는 아니지만)");
assert.equal(autonomyCeiling({ category: "CSM", procurementAlternatives: [] }).level, 2, "단일소싱은 L2 상한");
assert.equal(autonomyCeiling({ category: "CSM", procurementAlternatives: [{ supplierName: "X", standardDays: 10, emergencyOrderAllowed: false }] }).level, 4, "대체공급사 있으면 L4");

// K4 회귀 배경(2026-08-11, K1·K2를 대체): 승인 게이트의 시간 단위가 sim-time과 어긋나 있었다.
// PENDING_APPROVAL은 실벽시계 60분을 기다려 풀리는데(K2의 SLA 절충), twin의 소모는 sim-time으로
// 가속돼서 그 60분이 실측 약 103 sim일에 해당했다(측정: tick 26.2초 × 0.75 sim일/tick =
// 1.72 sim일/실분). 자재의 ropDays는 7~45일이라, 재발주가 걸린 뒤 승인만 기다리다 ROP의 2~15배
// 시간이 흘러 전 자재가 차례로 결품났다 — 실관측: 44종 중 19종 CRITICAL/STOCKOUT(13종 재고 0),
// M20 IN_PROGRESS 로트 14,040개 전부 materialBlockedAt으로 라인 완전 정지, 전구체 공급실은
// 최다소모 TEOS(Si) 재고 0인 채 저소모 TEMAHf가 방의 38%를 73일치로 점유.
// 사용자 결정(2026-08-11): 승인 게이트 자체를 제거하고 2026-08-08 정책("김구매가 스스로 판단해서
// 실행하고, 사람의 승인 클릭을 요구하지 않는다")으로 완전 복귀한다 — 이 가속비에서는 사람이
// 실시간으로 승인 버튼을 누를 시간 자체가 존재하지 않으므로, 게이트를 두면 그게 곧 교착이다.
// autonomyCeiling의 분류·사유는 계속 PO에 기록되므로(engine.ts) 투명성은 유지된다.
assert.equal(initialPurchaseOrderStatus(2), "ORDERED", "L2(위험물·단일소싱)도 사람 승인 없이 바로 발주 — 분류·사유는 PO에 기록만 한다");
assert.equal(initialPurchaseOrderStatus(4), "ORDERED", "L4는 지금까지처럼 바로 자동 발주");

// K4-b: shouldAutoApprovePendingOrder는 남긴다 — 게이트 제거 이전에 이미 PENDING_APPROVAL로
// 쌓여 있던 PO와, 사람이 화면에서 직접 만든 발주를 풀어주는 backstop이다. 신규 발주가 더는
// 이 상태로 생성되지 않으므로 위 103 sim일 문제의 경로는 아니다.
assert.equal(shouldAutoApprovePendingOrder(59), false, "59분은 아직 URGENT 전이라 자동승인 안 됨");
assert.equal(shouldAutoApprovePendingOrder(60), true, "60분(URGENT 티어)이면 자동승인");
assert.equal(shouldAutoApprovePendingOrder(120), true, "그 이상 방치돼도 계속 자동승인 대상");

// K3 회귀 배경: 관제탑의 김구매 카드가 실제 twin 발주 상태가 아니라 별도의 그림자 조종석
// 시뮬레이션(buildProcurementShadow, "자동모드였다면 ~했을 것")을 그대로 보여주고 있었다 —
// 진짜로 발주를 실행하는 engine.ts 결과와 무관했다. buildLiveProcurementShadow는 실제
// twinPurchaseOrders 상태(PENDING_APPROVAL·INBOUND_HOLD)만 보고 가정법 없이 서술해야 한다.
function liveSignal(overrides: Partial<ProcurementLiveOrderSignal>): ProcurementLiveOrderSignal {
  return {
    materialId: "GAS-004", materialCode: "GAS-004", materialName: "실란", unit: "kg",
    qty: 500, status: "PENDING_APPROVAL", waitingMinutes: 10, autonomyReason: "위험물(가스·케미컬) 자동입고 금지",
    ...overrides,
  };
}

const emptyLive = buildLiveProcurementShadow([], "2026-08-10T00:00:00Z");
assert.equal(emptyLive.top, null, "대기·보류가 없으면 top이 없다");
assert.deepEqual(emptyLive.summary, { pendingApproval: 0, urgent: 0, inboundHeld: 0 });

const waitingLive = buildLiveProcurementShadow([liveSignal({ waitingMinutes: 10 })], "2026-08-10T00:00:00Z");
assert.equal(waitingLive.top?.verdict, "APPROVAL_WAITING", "60분 미만은 대기 상태");
assert.ok(!waitingLive.top!.verdictText.includes("것"), `가정법("~것") 문구가 남아있으면 안 된다 (got ${waitingLive.top!.verdictText})`);
assert.ok(waitingLive.top!.verdictText.includes("10분"), "실제 경과시간을 그대로 서술해야 한다");

const urgentLive = buildLiveProcurementShadow([liveSignal({ waitingMinutes: 75 })], "2026-08-10T00:00:00Z");
assert.equal(urgentLive.top?.verdict, "APPROVAL_URGENT", "60분 이상은 긴급");
assert.ok(urgentLive.top!.verdictText.includes("자동 승인"), "SLA 타임아웃으로 자동 승인된다는 사실을 알려줘야 한다");
assert.equal(urgentLive.summary.urgent, 1);

const heldLive = buildLiveProcurementShadow(
  [liveSignal({ materialId: "UTL-001", materialCode: "UTL-001", materialName: "초순수", status: "INBOUND_HOLD", waitingMinutes: 5, autonomyReason: null })],
  "2026-08-10T00:00:00Z",
);
assert.equal(heldLive.top?.verdict, "INBOUND_HELD");
assert.equal(heldLive.summary.inboundHeld, 1);
assert.equal(heldLive.summary.pendingApproval, 0, "INBOUND_HOLD는 승인대기 건수에 안 잡힌다");

// 랭킹: INBOUND_HELD/APPROVAL_URGENT(긴급)가 APPROVAL_WAITING(일반 대기)보다 우선해야 한다
const mixed = buildLiveProcurementShadow(
  [
    liveSignal({ materialId: "A", materialCode: "A", materialName: "일반대기자재", waitingMinutes: 5 }),
    liveSignal({ materialId: "B", materialCode: "B", materialName: "긴급자재", waitingMinutes: 90 }),
  ],
  "2026-08-10T00:00:00Z",
);
assert.equal(mixed.top?.code, "B", "긴급(URGENT)이 일반 대기보다 먼저 보여야 한다");

// J1 회귀 배경: PENDING_APPROVAL이 며칠째 방치돼도 관제탑 배지가 그냥 "N건"이라고만 떠서
// 아무도 안 눌렀다 — 방치시간에 따라 긴급도를 올려서 눈에 띄게 한다.
assert.equal(approvalEscalationTier(5), "NORMAL", "15분 미만은 정상");
assert.equal(approvalEscalationTier(15), "WARNING", "15분부터 주의");
assert.equal(approvalEscalationTier(59), "WARNING", "60분 미만은 계속 주의");
assert.equal(approvalEscalationTier(60), "URGENT", "60분부터 긴급");
assert.equal(approvalEscalationTier(500), "URGENT", "그 이상도 긴급");

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
      supplyMode: "SPECIALTY_CYLINDER",
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

// ── 회귀: procurementAlternatives는 "주 공급사 제외" 목록이라, 승인 공급사 정확히 2곳(대체 1건)이면
// 이미 단일소싱이 아니다. 라이브에서 발견된 버그(alt.length<=1로 잘못 체크 → 2공급사도 L2로 오판)의 재발 방지. ──
const twoSupplierRec = rec({
  material: mat({
    id: "CSM-001", code: "CSM-001", name: "CMP 슬러리", category: "CSM", unit: "캔",
    procurementAlternatives: [{ supplierName: "대체공급사", standardDays: 20, emergencyOrderAllowed: false }],
  }),
  classification: "EXISTING_SHORTAGE",
  baseline: { grossRequirement: 0, recommendedInbound: 100, firstNeedDay: 5 },
  incrementalOrderQuantity: 0,
  policyAdjustedOrderQuantity: 0,
  warnings: [],
});
const twoSupplierChain = buildProcurementShadow([twoSupplierRec], "위험 점검", now).chains[0];
assert.equal(twoSupplierChain.autonomyCeiling, 4, "승인 공급사 2곳(대체 1건)이면 단일소싱 아님 → L4 상한");

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

// ── reasonCodes 중복 금지: scenario-engine이 EXISTING_SHORTAGE를 classification과
// warnings[].code 양쪽에 동시에 넣기 때문에(baseline.recommendedInbound > 0일 때),
// 그대로 합치면 같은 문자열이 두 번 들어가 React key 충돌(같은 key `EXISTING_SHORTAGE`
// 두 번)이 난다. reasonCodes는 항상 고유해야 한다.
const dupRec = rec({
  material: mat({ id: "CHM-020", code: "CHM-020", name: "테스트 케미컬", category: "CHM", unit: "L" }),
  classification: "EXISTING_SHORTAGE",
  baseline: { grossRequirement: 0, recommendedInbound: 300, firstNeedDay: 4 },
  warnings: [{ code: "EXISTING_SHORTAGE", label: "기준 계획에서도 보충 필요", severity: "HIGH" }],
});
const dupChain = buildProcurementShadow([dupRec], "위험 점검", now).chains[0];
const uniqueCodes = new Set(dupChain.reasonCodes);
assert.equal(uniqueCodes.size, dupChain.reasonCodes.length, `reasonCodes에 중복이 있으면 안 된다 (got ${JSON.stringify(dupChain.reasonCodes)})`);

console.log("✅ procurement-agent 그림자 로직 + 자율등급 추천/override 통과");
