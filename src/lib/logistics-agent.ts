// 물류(LOGISTICS) 에이전트 — 그림자모드 순수 로직 (DB 접근 없음, 테스트 가능)
// 창고 용량(공간·법적 한도)을 verdict로 승격만 한다. 실제 입고·이동을 실행하지 않는다.

export const LOGISTICS_AGENT_POLICY_VERSION = "LOGISTICS_SHADOW_V0";

export type LogisticsVerdict = "CAPACITY_OVER" | "CAPACITY_WATCH" | "INBOUND_NORMAL";

export type WarehouseSignal = {
  code: string;
  name: string;
  utilization: number;
  legalUtilization: number | null;
  // 없으면 SPACE로 본다 — 기존 호출자(창고 대부분)의 동작을 그대로 유지하기 위한 기본값.
  capacityMode?: "SPACE" | "TANK_LEVEL" | "CONTINUOUS";
};

export type LogisticsRuleItem = {
  code: string;
  name: string;
  verdict: LogisticsVerdict;
  verdictText: string;
  highestUtilization: number;
};

export type LogisticsShadowReport = {
  generatedAt: string;
  policyVersion: string;
  scenarioLabel: string;
  shadowMode: true;
  top: LogisticsRuleItem | null;
  summary: { over: number; watch: number; openPOs: number };
};

// CONTINUOUS 모드 시설(UPW-01 초순수 생산시설)은 적치 개념이 없어 getWarehouseCapacity가
// occupancy를 항상 100으로 고정한다 — "탱크에 얼마나 쌓였나"가 아니라 "현장에서 계속 만들어
// Loop로 흘려보낸다"는 뜻이다. 그 고정값 100을 포화 임계값(>=100)에 그대로 넣으면 이 시설은
// 영구 CAPACITY_OVER가 되고, 목적창고가 이곳인 PO는 settleArrivals에서 무조건 INBOUND_HOLD로
// 묶여 영구 결품이 된다. 용량 판정 대상에서 제외하는 건 inventory-policy.ts의 capacityDecision이
// 이미 쓰고 있는 규칙("현장 연속공급 품목은 자동 기준수량 적용 대상이 아니다")과 같다.
// 0을 반환해 verdict·랭킹·over/watch 카운트에서 한 번에 빠지게 한다.
function highestOf(wh: WarehouseSignal): number {
  if (wh.capacityMode === "CONTINUOUS") return 0;
  return Math.max(wh.utilization, wh.legalUtilization ?? 0);
}

function verdictOf(highest: number): LogisticsVerdict {
  if (highest >= 100) return "CAPACITY_OVER";
  if (highest >= 80) return "CAPACITY_WATCH";
  return "INBOUND_NORMAL";
}

// Twin의 실제 입고 게이팅(settleArrivals)이 재사용한다 — 관제탑 표시용 판단과
// 창고에 실제로 넣을지 말지가 서로 다른 계산을 쓰면(오늘처럼) 다시 어긋난다.
export function warehouseVerdict(wh: WarehouseSignal): LogisticsVerdict {
  return verdictOf(highestOf(wh));
}

function verdictTextOf(wh: WarehouseSignal, verdict: LogisticsVerdict): string {
  if (verdict === "CAPACITY_OVER") {
    return `${wh.name} 수용 한계를 초과했습니다 — 대체 적치·긴급 이동 검토가 필요합니다.`;
  }
  if (verdict === "CAPACITY_WATCH") {
    return `${wh.name} 용량이 80%를 넘어서고 있습니다 — 입고 여유를 점검해야 합니다.`;
  }
  return `${wh.name}은(는) 정상 여유가 있습니다.`;
}

export function buildLogisticsShadow(
  warehouses: WarehouseSignal[],
  openPOsCount: number,
  now: string,
): LogisticsShadowReport {
  const ranked = warehouses
    .filter((wh) => highestOf(wh) >= 80)
    .sort((a, b) => highestOf(b) - highestOf(a));

  const topWh = ranked[0] ?? null;
  const top: LogisticsRuleItem | null = topWh ? {
    code: topWh.code,
    name: topWh.name,
    verdict: verdictOf(highestOf(topWh)),
    verdictText: verdictTextOf(topWh, verdictOf(highestOf(topWh))),
    highestUtilization: highestOf(topWh),
  } : null;

  return {
    generatedAt: now,
    policyVersion: LOGISTICS_AGENT_POLICY_VERSION,
    scenarioLabel: "창고 용량·입고 점검",
    shadowMode: true,
    top,
    summary: {
      over: warehouses.filter((wh) => highestOf(wh) >= 100).length,
      watch: warehouses.filter((wh) => highestOf(wh) >= 80 && highestOf(wh) < 100).length,
      openPOs: openPOsCount,
    },
  };
}
