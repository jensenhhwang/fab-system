// 생산(PRODUCTION) 에이전트 — 그림자모드 순수 로직 (DB 접근 없음, 테스트 가능)
// 작업지시 상태(자재대기·보류)를 verdict로 승격만 한다. 실제 작업지시 상태를 바꾸지 않는다.

export const PRODUCTION_AGENT_POLICY_VERSION = "PRODUCTION_SHADOW_V0";

export type WorkOrderStatus = "QUEUED" | "MATERIAL_WAIT" | "RUNNING" | "HOLD" | "DONE";
export type ProductionVerdict = "MATERIAL_BLOCKED" | "HOLD_RISK" | "ON_TRACK";

export type WorkOrderSignal = {
  id: string;
  fabId: string;
  processCode: string;
  status: WorkOrderStatus;
};

export type ProductionRuleItem = {
  id: string;
  code: string;
  name: string;
  verdict: ProductionVerdict;
  verdictText: string;
};

export type ProductionShadowReport = {
  generatedAt: string;
  policyVersion: string;
  scenarioLabel: string;
  shadowMode: true;
  top: ProductionRuleItem | null;
  summary: { materialBlocked: number; hold: number };
};

const STATUS_RANK: Record<WorkOrderStatus, number> = {
  MATERIAL_WAIT: 3, HOLD: 2, QUEUED: 1, RUNNING: 1, DONE: 0,
};

function verdictOf(status: WorkOrderStatus): ProductionVerdict {
  if (status === "MATERIAL_WAIT") return "MATERIAL_BLOCKED";
  if (status === "HOLD") return "HOLD_RISK";
  return "ON_TRACK";
}

function verdictTextOf(wo: WorkOrderSignal, verdict: ProductionVerdict): string {
  if (verdict === "MATERIAL_BLOCKED") {
    return `${wo.fabId} ${wo.processCode} 작업지시가 자재대기 상태 — 생산계획 차질 위험이 있습니다.`;
  }
  if (verdict === "HOLD_RISK") {
    return `${wo.fabId} ${wo.processCode} 작업지시가 보류 상태입니다.`;
  }
  return `${wo.fabId} ${wo.processCode}은(는) 정상 진행 중입니다.`;
}

export function buildProductionShadow(
  workOrders: WorkOrderSignal[],
  wipCount: number,
  now: string,
): ProductionShadowReport {
  void wipCount;
  const ranked = workOrders
    .filter((wo) => wo.status === "MATERIAL_WAIT" || wo.status === "HOLD")
    .sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status]);

  const topWo = ranked[0] ?? null;
  const top: ProductionRuleItem | null = topWo ? {
    id: topWo.id,
    code: topWo.processCode,
    name: `${topWo.fabId} ${topWo.processCode}`,
    verdict: verdictOf(topWo.status),
    verdictText: verdictTextOf(topWo, verdictOf(topWo.status)),
  } : null;

  return {
    generatedAt: now,
    policyVersion: PRODUCTION_AGENT_POLICY_VERSION,
    scenarioLabel: "작업지시 상태 점검",
    shadowMode: true,
    top,
    summary: {
      materialBlocked: workOrders.filter((wo) => wo.status === "MATERIAL_WAIT").length,
      hold: workOrders.filter((wo) => wo.status === "HOLD").length,
    },
  };
}

// K1: 관제탑의 최생산 판단이 개별 작업지시(workOrders, M20_PILOT/mes 전용 — 레거시 정리 후
// 더 이상 갱신 안 됨)에 묶여있어서, 실제로 지금 자재차단 중인 로트가 12,590개인데도 화면엔
// 며칠 전 죽은 데이터가 그대로 뜨던 문제를 고친다. advanceAggregateWip이 실제로 쓰는 라이브
// 신호(waferLots.materialBlockedAt/finishedGoodsHoldAt 집계)로 직접 판단한다.
export type AggregateWipSignal = {
  fabId: string;
  inProgressCount: number;
  materialBlockedCount: number;
  finishedGoodsHoldCount: number;
};

export function buildAggregateProductionShadow(signal: AggregateWipSignal, now: string): ProductionShadowReport {
  const verdict: ProductionVerdict = signal.materialBlockedCount > 0
    ? "MATERIAL_BLOCKED"
    : signal.finishedGoodsHoldCount > 0 ? "HOLD_RISK" : "ON_TRACK";

  const top: ProductionRuleItem | null = verdict === "ON_TRACK" ? null : {
    id: `${signal.fabId}-AGGREGATE-WIP`,
    code: signal.fabId,
    name: `${signal.fabId} HBM 전체 WIP`,
    verdict,
    verdictText: verdict === "MATERIAL_BLOCKED"
      ? `${signal.fabId} 진행 중 로트 ${signal.inProgressCount.toLocaleString("ko-KR")}개 중 ${signal.materialBlockedCount.toLocaleString("ko-KR")}개가 자재차단 상태 — 이자재의 재고 회복을 기다리고 있습니다.`
      : `${signal.fabId} 완제품 창고 포화로 ${signal.finishedGoodsHoldCount.toLocaleString("ko-KR")}개 로트의 최종 완료가 보류 중입니다.`,
  };

  return {
    generatedAt: now,
    policyVersion: PRODUCTION_AGENT_POLICY_VERSION,
    scenarioLabel: "M20 aggregate WIP 점검",
    shadowMode: true,
    top,
    summary: { materialBlocked: signal.materialBlockedCount, hold: signal.finishedGoodsHoldCount },
  };
}
