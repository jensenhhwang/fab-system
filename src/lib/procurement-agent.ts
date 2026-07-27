// 입고(PROCUREMENT) 에이전트 — 그림자모드(MVP-0) 순수 로직 (DB 접근 없음, 테스트 가능)
//
// 안전 원칙(패브 검증):
// - MVP-0는 그림자모드: 실제 발주·입고를 절대 실행하지 않는다. "자동이면 이렇게 했을 것"만 산출.
// - 수량은 결정론 엔진(scenario-engine.recommendMaterialOrders)이 이미 계산한 값을 그대로 사용.
// - 위험물(GAS/CHM)·단일 승인 공급사 자재는 자율레벨 상한 L2(제안까지) — 자동입고 금지.
// - 리드타임·공급사 미등록이면 자동 판단 보류(BLOCKED) — 사람이 마스터를 정비해야 함.

import type { MaterialRecommendation } from "@/lib/scenario-engine";

export const PROCUREMENT_AGENT_POLICY_VERSION = "PROCUREMENT_SHADOW_V0";

export type AutonomyCeiling = 2 | 4;
export type AutonomyLevel = 2 | 4;
export type ProcurementStepStatus = "OK" | "WARN" | "BLOCKED";
export type ShadowVerdict = "WOULD_AUTO_RECEIVE" | "WOULD_PROPOSE" | "BLOCKED";

// 역할 분담: 엔진(사실 계산) → 에이전트(추천+근거, 여기) → 사람(승인/조정, UI).
// 추천은 결정론 규칙이다(LLM 아님) — 근거를 기존 reasonCodes와 같은 방식으로 투명하게 노출한다.
export type AutonomyRecommendation = { level: AutonomyLevel; rationale: string; code: string };

export type ProcurementChainStep = {
  key: "PLAN_SIGNAL" | "SHORTAGE" | "LEAD_TIME" | "ORDER_DECISION";
  title: string;
  status: ProcurementStepStatus;
  detail: string;
  metrics: { label: string; value: string }[];
};

export type ProcurementReasoningChain = {
  materialId: string;
  materialCode: string;
  materialName: string;
  category: string;
  unit: string;
  classification: MaterialRecommendation["classification"];
  urgencyDay: number | null; // safeOrderByDay (작을수록 급함, null은 뒤로)
  autonomyCeiling: AutonomyCeiling;
  ceilingReason: string | null;
  autonomyRecommendation: AutonomyRecommendation;
  autonomyOverride: AutonomyLevel | null;
  effectiveAutonomy: AutonomyLevel;
  reasonCodes: string[];
  proposedQuantity: number;
  supplierName: string | null;
  verdict: ShadowVerdict;
  verdictText: string;
  steps: ProcurementChainStep[];
};

export type ProcurementShadowReport = {
  generatedAt: string;
  policyVersion: string;
  scenarioLabel: string;
  shadowMode: true;
  chains: ProcurementReasoningChain[];
  summary: { actionable: number; wouldAutoReceive: number; wouldPropose: number; blocked: number };
};

// reasonCode → 사람이 읽는 한국어 서술 (유리 조종석 "근거 원문" 토글용)
export const REASON_NARRATIVE: Record<string, string> = {
  EXISTING_SHORTAGE: "기준 계획에서도 이미 보충이 필요한 자재입니다.",
  SCENARIO_CAUSED_SHORTAGE: "생산계획/What-if 변경으로 새로 부족이 발생합니다.",
  LEAD_TIME_MISSING: "리드타임이 등록되지 않아 발주 마감을 계산할 수 없습니다.",
  SUPPLIER_MISSING: "승인 공급사가 없어 자동 발주를 만들 수 없습니다.",
  PROCUREMENT_POLICY_MISSING: "MOQ·발주배수가 연결되지 않아 순부족량만 표시합니다.",
  QUALITY_BLOCKED: "품질 보류 재고가 있어 가용재고에서 제외했습니다.",
  RESERVED_STOCK: "예약 재고가 있어 가용재고에서 제외했습니다.",
  EXPIRY_RISK: "30일 내 만료 예정 재고가 있습니다.",
  HAZMAT_AUTONOMY_CAP: "위험물(가스·케미컬)은 안전 정책상 자동입고가 금지되어 제안까지만 가능합니다.",
  SINGLE_SOURCE_CAP: "단일 승인 공급사 자재라 자동입고가 제한되어 제안까지만 가능합니다.",
  CEILING_LOCKED: "자율 상한이 L2로 고정돼 있어 에이전트가 추천할 여지가 없습니다.",
  STABLE_PATTERN_L4: "반복적으로 발생하는 안정적 부족 패턴이고 위험 신호가 없어 에이전트가 자동입고를 추천합니다.",
  NOVEL_SHORTAGE_L2: "생산계획/What-if 변경으로 새로 발생한 부족이라 에이전트가 사람 확인을 추천합니다.",
  WARNING_PRESENT_L2: "품질보류·만료임박 등 주의 신호가 있어 에이전트가 사람 확인을 추천합니다.",
};

const nf = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });

function dayLabel(day: number | null): string {
  if (day === null) return "미정";
  if (day === 0) return "오늘(D+0)";
  return day > 0 ? `D+${day}` : `D${day}`;
}

function autonomyCeiling(r: MaterialRecommendation): { level: AutonomyCeiling; reason: string | null; code: string | null } {
  const cat = (r.material.category ?? "").toUpperCase();
  if (cat === "GAS" || cat === "CHM") {
    return { level: 2, reason: "위험물(가스·케미컬) 자동입고 금지", code: "HAZMAT_AUTONOMY_CAP" };
  }
  const alt = r.material.procurementAlternatives ?? [];
  if (alt.length <= 1) {
    return { level: 2, reason: "단일 승인 공급사 — 자동입고 제한", code: "SINGLE_SOURCE_CAP" };
  }
  return { level: 4, reason: null, code: null };
}

// 에이전트 추천 레이어: 엔진이 이미 계산한 사실(분류·경고)만 보고 자율등급을 "추천"한다.
// 상한을 넘는 추천은 절대 하지 않는다 — 상한이 2면 추천도 2로 고정.
function recommendAutonomyLevel(r: MaterialRecommendation, ceiling: AutonomyCeiling): AutonomyRecommendation {
  if (ceiling === 2) {
    return { level: 2, rationale: REASON_NARRATIVE.CEILING_LOCKED, code: "CEILING_LOCKED" };
  }
  const hasHighWarning = r.warnings.some((w) => w.severity === "HIGH");
  if (r.classification === "EXISTING_SHORTAGE" && !hasHighWarning) {
    return { level: 4, rationale: REASON_NARRATIVE.STABLE_PATTERN_L4, code: "STABLE_PATTERN_L4" };
  }
  if (r.classification === "SCENARIO_CAUSED_SHORTAGE") {
    return { level: 2, rationale: REASON_NARRATIVE.NOVEL_SHORTAGE_L2, code: "NOVEL_SHORTAGE_L2" };
  }
  return { level: 2, rationale: REASON_NARRATIVE.WARNING_PRESENT_L2, code: "WARNING_PRESENT_L2" };
}

export function buildProcurementShadow(
  recommendations: MaterialRecommendation[],
  scenarioLabel: string,
  now: string,
  overrides: Record<string, AutonomyLevel> = {},
): ProcurementShadowReport {
  const actionable = recommendations.filter((r) => r.classification !== "NO_INCREMENTAL_ORDER");

  const chains: ProcurementReasoningChain[] = actionable.map((r) => {
    const m = r.material;
    const ceiling = autonomyCeiling(r);
    const agentRecommendation = recommendAutonomyLevel(r, ceiling.level);
    const humanOverride = overrides[m.id] ?? null;
    // 안전 백스탑: 사람 override든 에이전트 추천이든 상한을 절대 넘지 못한다.
    const effectiveAutonomy = Math.min(humanOverride ?? agentRecommendation.level, ceiling.level) as AutonomyLevel;
    // EXISTING_SHORTAGE(이벤트 없는 위험점검)는 incremental=0이므로 기준 계획의 보충량을 쓴다.
    const proposedQuantity = r.classification === "EXISTING_SHORTAGE"
      ? r.baseline.recommendedInbound
      : r.policyAdjustedOrderQuantity > 0 ? r.policyAdjustedOrderQuantity : r.incrementalOrderQuantity;

    const reasonCodes: string[] = [r.classification, ...r.warnings.map((w) => w.code)];
    if (ceiling.code) reasonCodes.push(ceiling.code);
    reasonCodes.push(agentRecommendation.code);

    const leadTimeMissing = m.leadTimeDays == null;
    const supplierMissing = !m.supplierName;
    const leadBlocked = leadTimeMissing || supplierMissing;
    // 안전마감이 이미 지났으면(<=0) 시간 압박
    const overdue = r.safeOrderByDay !== null && r.safeOrderByDay <= 0;

    const steps: ProcurementChainStep[] = [
      {
        key: "PLAN_SIGNAL",
        title: "생산계획 신호",
        status: "OK",
        detail: r.classification === "SCENARIO_CAUSED_SHORTAGE"
          ? `${scenarioLabel} 반영으로 ${m.name} 소요가 늘어납니다.`
          : `${m.name}은(는) 현재 기준 계획에서도 보충이 필요합니다.`,
        metrics: [
          { label: "기준 첫 필요", value: dayLabel(r.baseline.firstNeedDay) },
          { label: "시나리오 첫 필요", value: dayLabel(r.scenario.firstNeedDay) },
        ],
      },
      {
        key: "SHORTAGE",
        title: "부족 예측",
        status: r.additionalRequirement > 0 || r.baseline.recommendedInbound > 0 ? "WARN" : "OK",
        detail: `가용 ${nf.format(r.netInputs.available)}${m.unit} · 확정입고 ${nf.format(r.netInputs.confirmedInbound)}${m.unit} 기준, 추가 소요 ${nf.format(r.additionalRequirement)}${m.unit} 예상.`,
        metrics: [
          { label: "가용재고", value: `${nf.format(r.netInputs.available)} ${m.unit}` },
          { label: "예약/품질보류", value: `${nf.format(r.netInputs.reserved + r.netInputs.qualityBlocked)} ${m.unit}` },
          { label: "확정입고", value: `${nf.format(r.netInputs.confirmedInbound)} ${m.unit}` },
          { label: "추가 소요", value: `${nf.format(r.additionalRequirement)} ${m.unit}` },
        ],
      },
      {
        key: "LEAD_TIME",
        title: "리드타임 커버리지",
        status: leadTimeMissing ? "BLOCKED" : overdue ? "WARN" : "OK",
        detail: leadTimeMissing
          ? "리드타임 미등록 — 발주 마감을 계산할 수 없습니다."
          : `리드타임 ${m.leadTimeDays}일. 안전 발주 마감 ${dayLabel(r.safeOrderByDay)}${overdue ? " (이미 지남)" : ""}.`,
        metrics: [
          { label: "리드타임", value: m.leadTimeDays == null ? "미등록" : `${m.leadTimeDays}일` },
          { label: "정상 발주 마감", value: dayLabel(r.normalOrderByDay) },
          { label: "안전 발주 마감", value: dayLabel(r.safeOrderByDay) },
          { label: "첫 필요일", value: dayLabel(r.needByDay) },
        ],
      },
      {
        key: "ORDER_DECISION",
        title: "발주 판단",
        status: leadBlocked ? "BLOCKED" : "OK",
        detail: supplierMissing
          ? "승인 공급사 미등록 — 자동 발주 불가."
          : `${nf.format(proposedQuantity)}${m.unit} 발주 권장${r.policyAdjustedOrderQuantity > r.incrementalOrderQuantity ? ` (순부족 ${nf.format(r.incrementalOrderQuantity)} → MOQ·배수 반영)` : ""}. 공급사 ${m.supplierName ?? "미정"}.`,
        metrics: [
          { label: "순부족", value: `${nf.format(r.incrementalOrderQuantity)} ${m.unit}` },
          { label: "발주 권장", value: `${nf.format(proposedQuantity)} ${m.unit}` },
          { label: "자율 상한", value: `L${ceiling.level}` },
          { label: "에이전트 추천", value: `L${agentRecommendation.level}` },
          { label: "적용 등급", value: `L${effectiveAutonomy}${humanOverride ? " (사람 확정)" : " (에이전트 추천)"}` },
        ],
      },
    ];

    let verdict: ShadowVerdict;
    let verdictText: string;
    if (leadBlocked) {
      verdict = "BLOCKED";
      verdictText = `${leadTimeMissing ? "리드타임" : "승인 공급사"} 미등록으로 자동 판단 보류 — 사람이 마스터를 정비해야 합니다.`;
    } else if (effectiveAutonomy === 4) {
      verdict = "WOULD_AUTO_RECEIVE";
      verdictText = `자동모드였다면 → ${nf.format(proposedQuantity)}${m.unit} 잠정입고(격리) 실행했을 것 (${humanOverride ? "사람이 L4 확정" : "에이전트 추천 L4"}).`;
    } else {
      verdict = "WOULD_PROPOSE";
      const proposeReason = ceiling.reason ?? (humanOverride === 2 ? "사람이 L2로 확정" : agentRecommendation.rationale);
      verdictText = `자동모드였다면 → ${nf.format(proposedQuantity)}${m.unit} 발주 제안했을 것 (${proposeReason}: 사람 승인 필요).`;
    }

    return {
      materialId: m.id,
      materialCode: m.code,
      materialName: m.name,
      category: m.category,
      unit: m.unit,
      classification: r.classification,
      urgencyDay: r.safeOrderByDay,
      autonomyCeiling: ceiling.level,
      ceilingReason: ceiling.reason,
      autonomyRecommendation: agentRecommendation,
      autonomyOverride: humanOverride,
      effectiveAutonomy,
      reasonCodes,
      proposedQuantity,
      supplierName: m.supplierName ?? null,
      verdict,
      verdictText,
      steps,
    };
  });

  chains.sort((a, b) => {
    const au = a.urgencyDay ?? Number.MAX_SAFE_INTEGER;
    const bu = b.urgencyDay ?? Number.MAX_SAFE_INTEGER;
    if (au !== bu) return au - bu;
    return b.proposedQuantity - a.proposedQuantity;
  });

  return {
    generatedAt: now,
    policyVersion: PROCUREMENT_AGENT_POLICY_VERSION,
    scenarioLabel,
    shadowMode: true,
    chains,
    summary: {
      actionable: chains.length,
      wouldAutoReceive: chains.filter((c) => c.verdict === "WOULD_AUTO_RECEIVE").length,
      wouldPropose: chains.filter((c) => c.verdict === "WOULD_PROPOSE").length,
      blocked: chains.filter((c) => c.verdict === "BLOCKED").length,
    },
  };
}
