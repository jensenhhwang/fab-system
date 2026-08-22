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

// Twin 발주 루프 등 MaterialRecommendation 전체를 안 만드는 호출부에서도 재사용할 수 있도록
// category·procurementAlternatives·supplyMode만 받는다(김구매 판단 없이 Twin이 발주를 쏘던
// 문제 수정). I2 회귀: GAS/CHM 카테고리 전체를 위험물로 뭉뚱그렸더니 44종 중 41종이 승인대기로
// 쌓였다 — 실제로는 벌크가스(N2·Ar 등)·벌크케미컬(BCDS)은 밴더관리 자동보충이 업계 관행이라
// 사람 승인이 필요 없고, 개별 실린더(SPECIALTY_CYLINDER)에 든 특수가스만 진짜 위험물 취급이
// 필요하다. supplyMode가 없으면(레거시 호출부) 이전처럼 category만으로 보수적으로 판단한다.
export function autonomyCeiling(
  material: Pick<MaterialRecommendation["material"], "category" | "procurementAlternatives"> & { supplyMode?: MaterialRecommendation["material"]["supplyMode"] },
): { level: AutonomyCeiling; reason: string | null; code: string | null } {
  const cat = (material.category ?? "").toUpperCase();
  const isHazmatCategory = cat === "GAS" || cat === "CHM";
  // supplyMode가 있으면 그걸로 정밀 판정한다: 개별 실린더(SPECIALTY_CYLINDER)만 진짜 위험물
  // 상한 대상이다. 벌크(BULK_GAS/BULK_CHEMICAL)는 밴더관리 자동보충이 업계 관행이라 제외하고,
  // 드럼/캐니스터 화학물질은 위험물 상한이 아니라 아래 단일소싱 여부로만 판정한다(대부분
  // 실제로도 단일 공급사라 자연스럽게 걸러진다). supplyMode가 없으면(레거시 호출부) 이전처럼
  // category만으로 보수적으로 판단한다.
  const isHazmatCylinder = material.supplyMode
    ? material.supplyMode === "SPECIALTY_CYLINDER"
    : isHazmatCategory;
  if (isHazmatCylinder) {
    return { level: 2, reason: "위험물(가스·케미컬) 자동입고 금지", code: "HAZMAT_AUTONOMY_CAP" };
  }
  // procurementAlternatives는 "주 공급사를 제외한" 대체 공급사 목록이다(buildProcurementSummary).
  // 즉 승인 공급사가 1곳뿐이면 alternatives는 0건 — 단일소싱 판정은 <=1이 아니라 0건이어야 한다.
  const alt = material.procurementAlternatives ?? [];
  if (alt.length === 0) {
    return { level: 2, reason: "단일 승인 공급사 — 자동입고 제한", code: "SINGLE_SOURCE_CAP" };
  }
  return { level: 4, reason: null, code: null };
}

// Twin 발주 루프(engine.ts)가 새 PO를 만들 때 쓰는 초기 상태 — 자율등급과 무관하게 항상 ORDERED.
//
// 2026-08-11 사용자 결정: 승인 게이트를 제거하고 2026-08-08 정책("김구매가 스스로 판단해서
// 실행하고, 사람의 승인 클릭을 요구하지 않는다")으로 완전 복귀한다. 08-09에 되살렸던 L2 게이트는
// 시간 단위가 twin과 어긋나 있었다 — PENDING_APPROVAL은 실벽시계로 풀리는데(60분 SLA) 자재
// 소모는 sim-time으로 가속돼서, 그 60분이 실측 약 103 sim일이었다(tick 26.2초 × 0.75 sim일/tick).
// 자재 ropDays가 7~45일이니 승인을 기다리는 동안 ROP의 2~15배 시간이 흘러 전 자재가 차례로
// 결품났다(실관측: 44종 중 19종 CRITICAL/STOCKOUT, M20 로트 14,040개 전부 materialBlockedAt으로
// 라인 정지). 이 가속비에서는 사람이 실시간으로 승인을 누를 시간 자체가 없으므로, 게이트를 두는
// 것이 곧 교착이다. 위험물·단일소싱 분류와 사유(autonomyCeiling·autonomyReason)는 engine.ts가
// 계속 PO에 기록하므로 "왜 이 발주가 민감한가"의 투명성은 유지된다 — 사람은 사후에 REJECT할 수 있다.
export function initialPurchaseOrderStatus(_ceilingLevel: AutonomyCeiling): "PENDING_APPROVAL" | "ORDERED" {
  return "ORDERED";
}

// PENDING_APPROVAL이 방치되는 문제(실관측: 며칠째 41건 방치)에 대한 최소 대응 — 관제탑 배지가
// 그냥 "N건"으로만 뜨면 아무도 안 누른다. 방치시간(분)에 따라 긴급도를 올려서 눈에 띄게 한다.
// 승인은 여전히 사람이 하지만, "지금 봐야 하는지"를 시스템이 판단해서 알려준다.
export type ApprovalEscalationTier = "NORMAL" | "WARNING" | "URGENT";
export const APPROVAL_ESCALATION_WARNING_MIN = 15;
export const APPROVAL_ESCALATION_URGENT_MIN = 60;
export function approvalEscalationTier(waitingMinutes: number): ApprovalEscalationTier {
  if (waitingMinutes >= APPROVAL_ESCALATION_URGENT_MIN) return "URGENT";
  if (waitingMinutes >= APPROVAL_ESCALATION_WARNING_MIN) return "WARNING";
  return "NORMAL";
}

// SLA 타임아웃 backstop. 2026-08-11에 승인 게이트를 제거해서(initialPurchaseOrderStatus) twin
// 발주 루프는 더 이상 PENDING_APPROVAL을 만들지 않지만, 게이트 제거 이전에 쌓인 PO와 사람이
// 화면에서 직접 만든 발주는 여전히 이 상태로 존재할 수 있다. 그것들이 영원히 안 풀려서
// planInbound의 inTransit에 잡힌 채 재발주까지 막는 교착을 남기지 않도록, URGENT 티어(60분
// 이상 방치)에 도달하면 자동 승인한다.
export function shouldAutoApprovePendingOrder(waitingMinutes: number): boolean {
  return approvalEscalationTier(waitingMinutes) === "URGENT";
}

// 관제탑의 김구매 카드가 실제 twin 발주 상태가 아니라 별도의 그림자 조종석 계산
// (buildProcurementShadow, "자동모드였다면 ~했을 것")을 그대로 보여주고 있었다 — 진짜로
// 발주를 결정·실행하는 engine.ts(initialPurchaseOrderStatus·shouldAutoApprovePendingOrder)의
// 결과와 무관한 별개 시뮬레이션이었다. 이 함수는 실제 twinPurchaseOrders 상태(PENDING_APPROVAL·
// INBOUND_HOLD)로 "지금 실제로 무슨 일이 있는지"를 서술한다 — 가정법 없음.
export type ProcurementLiveOrderSignal = {
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  qty: number;
  status: "PENDING_APPROVAL" | "INBOUND_HOLD";
  waitingMinutes: number;
  autonomyReason: string | null;
};

export type ProcurementLiveVerdict = "APPROVAL_URGENT" | "INBOUND_HELD" | "APPROVAL_WAITING" | "PROCUREMENT_NORMAL";

const LIVE_VERDICT_RANK: Record<ProcurementLiveVerdict, number> = {
  APPROVAL_URGENT: 3, INBOUND_HELD: 3, APPROVAL_WAITING: 2, PROCUREMENT_NORMAL: 1,
};

function liveVerdictOf(signal: ProcurementLiveOrderSignal): ProcurementLiveVerdict {
  if (signal.status === "INBOUND_HOLD") return "INBOUND_HELD";
  return shouldAutoApprovePendingOrder(signal.waitingMinutes) ? "APPROVAL_URGENT" : "APPROVAL_WAITING";
}

function liveVerdictTextOf(signal: ProcurementLiveOrderSignal, verdict: ProcurementLiveVerdict): string {
  const qtyLabel = `${nf.format(signal.qty)}${signal.unit}`;
  if (verdict === "INBOUND_HELD") {
    return `${signal.materialName} 입고 ${qtyLabel} — 목적창고 용량 초과로 보류 중입니다. 창고 여유가 생기면 자동으로 정산됩니다.`;
  }
  if (verdict === "APPROVAL_URGENT") {
    return `${signal.materialName} 발주 ${qtyLabel} — ${Math.round(signal.waitingMinutes)}분째 승인 대기 중입니다(${signal.autonomyReason ?? "위험물/단일소싱"}). SLA 타임아웃으로 곧 자동 승인됩니다.`;
  }
  return `${signal.materialName} 발주 ${qtyLabel} — 승인 대기 중입니다(${Math.round(signal.waitingMinutes)}분 경과, ${signal.autonomyReason ?? "위험물/단일소싱"}).`;
}

export type ProcurementLiveRuleItem = {
  materialId: string;
  code: string;
  name: string;
  verdict: ProcurementLiveVerdict;
  verdictText: string;
};

export type ProcurementLiveReport = {
  generatedAt: string;
  policyVersion: string;
  scenarioLabel: string;
  shadowMode: true;
  top: ProcurementLiveRuleItem | null;
  summary: { pendingApproval: number; urgent: number; inboundHeld: number };
};

export function buildLiveProcurementShadow(signals: ProcurementLiveOrderSignal[], now: string): ProcurementLiveReport {
  const ranked = signals
    .map((signal) => ({ signal, verdict: liveVerdictOf(signal) }))
    .sort((a, b) => {
      const rankDiff = LIVE_VERDICT_RANK[b.verdict] - LIVE_VERDICT_RANK[a.verdict];
      if (rankDiff !== 0) return rankDiff;
      return b.signal.waitingMinutes - a.signal.waitingMinutes;
    });

  const topEntry = ranked[0] ?? null;
  const top: ProcurementLiveRuleItem | null = topEntry ? {
    materialId: topEntry.signal.materialId,
    code: topEntry.signal.materialCode,
    name: topEntry.signal.materialName,
    verdict: topEntry.verdict,
    verdictText: liveVerdictTextOf(topEntry.signal, topEntry.verdict),
  } : null;

  return {
    generatedAt: now,
    policyVersion: PROCUREMENT_AGENT_POLICY_VERSION,
    scenarioLabel: "실제 발주 상태 점검",
    shadowMode: true,
    top,
    summary: {
      pendingApproval: signals.filter((s) => s.status === "PENDING_APPROVAL").length,
      urgent: signals.filter((s) => liveVerdictOf(s) === "APPROVAL_URGENT").length,
      inboundHeld: signals.filter((s) => s.status === "INBOUND_HOLD").length,
    },
  };
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
    const ceiling = autonomyCeiling(r.material);
    const agentRecommendation = recommendAutonomyLevel(r, ceiling.level);
    const humanOverride = overrides[m.id] ?? null;
    // 안전 백스탑: 사람 override든 에이전트 추천이든 상한을 절대 넘지 못한다.
    const effectiveAutonomy = Math.min(humanOverride ?? agentRecommendation.level, ceiling.level) as AutonomyLevel;
    // EXISTING_SHORTAGE(이벤트 없는 위험점검)는 incremental=0이므로 기준 계획의 보충량을 쓴다.
    const proposedQuantity = r.classification === "EXISTING_SHORTAGE"
      ? r.baseline.recommendedInbound
      : r.policyAdjustedOrderQuantity > 0 ? r.policyAdjustedOrderQuantity : r.incrementalOrderQuantity;

    // scenario-engine은 EXISTING_SHORTAGE를 classification과 warnings[].code 양쪽에
    // 동시에 채우므로(baseline.recommendedInbound > 0), 합친 뒤 반드시 중복을 제거한다 —
    // 안 그러면 화면 목록에서 같은 근거가 두 번 뜨고 React key가 충돌한다.
    const reasonCodes: string[] = [...new Set([
      r.classification,
      ...r.warnings.map((w) => w.code),
      ...(ceiling.code ? [ceiling.code] : []),
      agentRecommendation.code,
    ])];

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
