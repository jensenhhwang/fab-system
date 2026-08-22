// tick 진단 — "엔진이 도는가"와 "팹이 만드는가"를 분리해서 판정하는 순수 로직 (DB 접근 없음).
//
// 배경: twin tick은 지금까지 "루프를 돌았는가"만 셌다. 그래서 자재 결품·창고 초과로 WIP이 전부
// 멈춰도 lastTickAt은 계속 갱신됐고, 화면은 초록불을 켠 채였다(실관측: 08-09 10:01 이후 자재
// 소모 0건인데 tick은 정상 갱신, 헤더는 "DATA CONNECTED" 펄스 유지). 산출이 없는 tick은 성공한
// tick이 아니다 — 이 파일이 그 정의를 코드로 못박는다.
//
// materials-agent.ts / logistics-agent.ts와 같은 패턴: 사실 계산은 서버가 하고, 여기서는 그
// 사실을 판정(verdict)으로 승격만 한다.

export const TICK_DIAGNOSIS_POLICY_VERSION = "TICK_DIAGNOSIS_V1";

// 산출이 끊긴 지 이 시간을 넘으면 지연/정지로 본다. tick 실측 소요가 ~95초라 몇 tick 정도의
// 공백은 정상 변동으로 흡수하고, 그보다 확실히 긴 구간만 이상으로 승격한다.
export const DEGRADED_AFTER_MIN = 15;
export const STOPPED_AFTER_MIN = 60;

export type LifeSignLevel = "ALIVE" | "DEGRADED" | "STOPPED";

export type LifeSign = {
  level: LifeSignLevel;
  minutesSinceOutput: number | null; // 산출 이력이 없으면 null
};

// 해제 실행자 — "이 정체를 누가 푸는가". 화면의 처방 버튼이 이 값으로 갈린다.
// CODE_DEFECT는 사람이 어떤 버튼을 눌러도 안 풀리는 것으로, 화면이 자기 한계를 고백하는 값이다.
export type ReleaseActor = "AGENT" | "HUMAN" | "UNASSIGNED" | "CODE_DEFECT";

export type BlockReasonCode =
  | "ENGINE_PAUSED"
  | "EMA_STARVATION"
  | "MATERIAL_CRITICAL"
  | "FG_CAPACITY_OVER"
  | "PENDING_APPROVAL"
  | "INBOUND_HOLD";

export type BlockReason = {
  reason: BlockReasonCode;
  impactLabel: string;       // 이 정체가 무엇을 얼마나 멈추고 있는가
  releaseCondition: string;  // 무엇이 충족되면 풀리는가
  releaseActor: ReleaseActor;
  deepLink: string | null;   // 처방 화면으로 가는 경로 (없으면 null)
};

export type TickDiagnosisInput = {
  now: Date;
  engineStatus: "RUNNING" | "PAUSED";
  lastTickAt: Date | null;
  lastOutputAt: Date | null;   // 마지막으로 완제품이 실제로 적립된 시각
  burnedTotal: number;         // 최근 관측 구간의 실제 소모 합
  shortfallTotal: number;      // 같은 구간의 부족분 합
  criticalMaterials: { materialId: string; code: string; state: string }[];
  capacityOverFinishedGoods: { warehouseId: string; utilization: number }[];
  pendingApprovalCount: number;
  inboundHoldCount: number;
  blockedLots: number;
  // avgDailyBurn이 설계수요보다 구조적으로 낮게 수렴한 자재들. 비어 있으면 아사 아님.
  // 최근 소모 이벤트가 아니라 재고 원장에서 판정해야 한다 — 생산이 완전히 멈추면 새 소모
  // 이벤트가 안 생겨서, 가장 심하게 굶고 있을 때 오히려 충족률이 건강해 보인다.
  starvedMaterials: { code: string; avgDailyBurn: number; designDaily: number }[];
};

export type TickDiagnosis = {
  policyVersion: string;
  lifeSign: LifeSign;
  fulfillment: number | null;  // burned / (burned + shortfall)
  blockReasons: BlockReason[]; // 심각도순
  topBlockReason: BlockReason | null;
};

// 충족률. 부족분을 분모에 포함해야 "자재 없이 통과한 웨이퍼"가 지표에 드러난다 —
// 소모량만 보면 재고가 마를수록 숫자가 작아져서 오히려 조용해진다.
export function fulfillmentRate(burnedTotal: number, shortfallTotal: number): number | null {
  const demand = burnedTotal + shortfallTotal;
  if (demand <= 0) return null;
  return burnedTotal / demand;
}

export function lifeSignOf(now: Date, lastOutputAt: Date | null): LifeSign {
  if (!lastOutputAt) return { level: "STOPPED", minutesSinceOutput: null };
  const minutes = Math.floor((now.getTime() - lastOutputAt.getTime()) / 60_000);
  if (minutes >= STOPPED_AFTER_MIN) return { level: "STOPPED", minutesSinceOutput: minutes };
  if (minutes >= DEGRADED_AFTER_MIN) return { level: "DEGRADED", minutesSinceOutput: minutes };
  return { level: "ALIVE", minutesSinceOutput: minutes };
}

// 심각도 순서: 눌러도 안 풀리는 것(엔진 정지·코드 결함)을 먼저 알려야 사람이 헛수고를 안 한다.
// 그 다음은 실제로 라인을 세우고 있는 순서(자재 → 완제품창고 → 발주경로).
const SEVERITY: BlockReasonCode[] = [
  "ENGINE_PAUSED",
  "EMA_STARVATION",
  "MATERIAL_CRITICAL",
  "FG_CAPACITY_OVER",
  "PENDING_APPROVAL",
  "INBOUND_HOLD",
];

function fmt(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}

export function diagnoseTick(input: TickDiagnosisInput): TickDiagnosis {
  const reasons: BlockReason[] = [];

  if (input.engineStatus !== "RUNNING") {
    reasons.push({
      reason: "ENGINE_PAUSED",
      impactLabel: "Twin 엔진이 정지 상태 — 모든 생산이 진행되지 않습니다",
      releaseCondition: "엔진을 RUNNING으로 전환",
      releaseActor: "HUMAN",
      deepLink: "/usage",
    });
  }

  // 재고 부족분이 EMA에 반영되지 않아 발주 기준선이 실수요보다 낮게 수렴하는 상태.
  // 게이트를 아무리 열어도 발주 자체가 안 나가므로 화면의 어떤 버튼으로도 해소되지 않는다.
  if (input.starvedMaterials.length > 0) {
    const worst = [...input.starvedMaterials]
      .sort((a, b) => a.avgDailyBurn / a.designDaily - b.avgDailyBurn / b.designDaily)[0];
    const pct = Math.round((worst.avgDailyBurn / worst.designDaily) * 100);
    reasons.push({
      reason: "EMA_STARVATION",
      impactLabel: `자재 ${input.starvedMaterials.length}종의 발주 기준선이 설계수요 미달 — 최저 ${worst.code} ${pct}% (${fmt(worst.avgDailyBurn)}/일 vs 설계 ${fmt(worst.designDaily)}/일)`,
      releaseCondition: "소모 EMA 입력을 실제 요청량(소모+부족)으로 교정",
      releaseActor: "CODE_DEFECT",
      deepLink: null,
    });
  }

  if (input.criticalMaterials.length > 0) {
    const codes = input.criticalMaterials.slice(0, 3).map((m) => m.code).join(", ");
    const more = input.criticalMaterials.length > 3 ? ` 외 ${input.criticalMaterials.length - 3}종` : "";
    reasons.push({
      reason: "MATERIAL_CRITICAL",
      impactLabel: `자재 ${input.criticalMaterials.length}종 결품/임계 (${codes}${more}) — ${fmt(input.blockedLots)} 로트 대기`,
      releaseCondition: "해당 자재 입고 반영",
      releaseActor: "HUMAN",
      deepLink: "/warehouse",
    });
  }

  for (const wh of input.capacityOverFinishedGoods) {
    reasons.push({
      reason: "FG_CAPACITY_OVER",
      impactLabel: `완제품 창고 ${wh.warehouseId} ${Math.round(wh.utilization)}% 초과 — 마지막 스텝 차단`,
      releaseCondition: "출하로 재고 감축 또는 웨이퍼 투입 감산",
      // 출하를 담당할 에이전트(정영업)가 아직 없다. 지금은 사람이 스크립트로만 푼다.
      releaseActor: "UNASSIGNED",
      deepLink: "/finished-goods",
    });
  }

  if (input.pendingApprovalCount > 0) {
    reasons.push({
      reason: "PENDING_APPROVAL",
      impactLabel: `승인 대기 발주 ${fmt(input.pendingApprovalCount)}건 — 해당 자재의 후속 발주 차단`,
      // 김구매가 60분(approvalEscalationTier URGENT) 경과분을 자동 승인한다. 사람이 더 빨리
      // 눌러도 되므로 deepLink는 남겨둔다.
      releaseCondition: "발주 승인, 또는 60분 경과 시 김구매가 자동 승인",
      releaseActor: "AGENT",
      deepLink: "/procurement-cockpit",
    });
  }

  if (input.inboundHoldCount > 0) {
    reasons.push({
      reason: "INBOUND_HOLD",
      impactLabel: `입고 보류 ${fmt(input.inboundHoldCount)}건 — 창고 용량 회복 대기`,
      releaseCondition: "목적 창고가 CAPACITY_OVER를 벗어나면 자동 입고",
      // settleArrivals가 매 tick 재정산하므로 사람이 개입하지 않아도 풀린다.
      releaseActor: "AGENT",
      deepLink: "/warehouse",
    });
  }

  reasons.sort((a, b) => SEVERITY.indexOf(a.reason) - SEVERITY.indexOf(b.reason));

  const lifeSign = input.engineStatus !== "RUNNING"
    ? { level: "STOPPED" as const, minutesSinceOutput: lifeSignOf(input.now, input.lastOutputAt).minutesSinceOutput }
    : lifeSignOf(input.now, input.lastOutputAt);

  return {
    policyVersion: TICK_DIAGNOSIS_POLICY_VERSION,
    lifeSign,
    fulfillment: fulfillmentRate(input.burnedTotal, input.shortfallTotal),
    blockReasons: reasons,
    topBlockReason: reasons[0] ?? null,
  };
}
