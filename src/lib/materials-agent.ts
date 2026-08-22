// 자재(MATERIALS) 에이전트 — 그림자모드 순수 로직 (DB 접근 없음, 테스트 가능)
// PROCUREMENT의 procurement-agent.ts와 동일한 역할 분담: 엔진(사실 계산)은 이미
// control-tower-snapshot-server.ts가 하고 있고, 여기서는 그 사실을 verdict로 승격만 한다.
// 모든 결과는 읽기 전용 의견이며 재고/자재 마스터를 실행하거나 변경하지 않는다.

export const MATERIALS_AGENT_POLICY_VERSION = "MATERIALS_SHADOW_V0";

export type MaterialCoverageState = "STOCKOUT" | "CRITICAL" | "BELOW_ROP" | "NO_BURN" | "NORMAL";
export type MaterialsVerdict = "COVERAGE_CRITICAL" | "COVERAGE_WATCH" | "DATA_GAP" | "COVERAGE_NORMAL";

export type MaterialSignal = {
  materialId: string;
  code: string;
  name: string;
  unit: string;
  ropDays: number;
  quantity: number;
  dailyBurn: number;
  coverageDays: number | null;
  state: MaterialCoverageState;
};

export type MaterialsRuleItem = {
  materialId: string;
  code: string;
  name: string;
  verdict: MaterialsVerdict;
  verdictText: string;
  coverageDays: number | null;
};

export type MaterialsShadowReport = {
  generatedAt: string;
  policyVersion: string;
  scenarioLabel: string;
  shadowMode: true;
  top: MaterialsRuleItem | null;
  summary: { critical: number; watch: number; dataGap: number };
};

// control-tower-snapshot-server.ts의 판정과 동일한 규칙(단일 출처로 여기서만 정의하고 재사용한다).
export function coverageState(quantity: number, dailyBurn: number, ropDays: number): MaterialCoverageState {
  if (quantity <= 0) return "STOCKOUT";
  if (dailyBurn <= 0) return "NO_BURN";
  const days = quantity / dailyBurn;
  if (days < Math.max(1, ropDays * 0.5)) return "CRITICAL";
  if (days < ropDays) return "BELOW_ROP";
  return "NORMAL";
}

const STATE_RANK: Record<MaterialCoverageState, number> = {
  STOCKOUT: 4, CRITICAL: 4, BELOW_ROP: 3, NO_BURN: 2, NORMAL: 1,
};

function verdictOf(state: MaterialCoverageState): MaterialsVerdict {
  if (state === "STOCKOUT" || state === "CRITICAL") return "COVERAGE_CRITICAL";
  if (state === "BELOW_ROP") return "COVERAGE_WATCH";
  if (state === "NO_BURN") return "DATA_GAP";
  return "COVERAGE_NORMAL";
}

function verdictTextOf(signal: MaterialSignal, verdict: MaterialsVerdict): string {
  const nf = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });
  if (verdict === "COVERAGE_CRITICAL") {
    return signal.coverageDays === null
      ? `${signal.name} 재고 소진 — 즉시 확인이 필요합니다.`
      : `${signal.name} 커버리지 ${nf.format(signal.coverageDays)}일 — ROP(${signal.ropDays}일)의 절반 미만입니다.`;
  }
  if (verdict === "COVERAGE_WATCH") {
    return `${signal.name} 커버리지 ${nf.format(signal.coverageDays ?? 0)}일 — ROP(${signal.ropDays}일) 미만이라 보충이 필요합니다.`;
  }
  if (verdict === "DATA_GAP") {
    return `${signal.name}의 일일 소모율이 확인되지 않아 커버리지를 계산할 수 없습니다.`;
  }
  return `${signal.name}은(는) 정상 범위입니다.`;
}

// 긴급 조달 대상 — COVERAGE_CRITICAL(재고 소진 임박). Twin의 입고 정산(settleArrivals)이
// 재사용해서, 목적창고가 용량 초과여도 이 자재만은 보류하지 않고 받는다.
// BELOW_ROP·NO_BURN·NORMAL은 아직 여유가 있으니 긴급 대상이 아니다.
export function criticalMaterialIds(signals: MaterialSignal[]): Set<string> {
  return new Set(
    signals
      .filter((s) => s.state === "STOCKOUT" || s.state === "CRITICAL")
      .map((s) => s.materialId),
  );
}

// 라인 차단 대상 — 재고가 실제로 0인 자재만. Twin의 WIP 진행(advanceAggregateWip·
// advanceStepBucketWip)이 다음 스텝에 이 자재를 쓰는 로트를 배치에서 제외해, "자재 없이
// 공정을 통과한" 물리적 모순을 막는다.
//
// 2026-08-11까지는 criticalMaterialIds 하나가 차단과 긴급 조달 양쪽에 쓰였다. 그래서 재고가
// 넉넉해도 커버리지가 ropDays의 절반 밑이면 라인이 섰는데, 두 가지 문제가 있었다:
//  ① 물리적으로 틀리다 — 실관측으로 라인을 세우던 6종 중 4종이 재고 보유 상태였고,
//     PKG-LBD-001은 재고 862만 개·커버리지 13.5일인데 ropDays(30)×0.5=15일에 못 미친다고
//     전체 라인을 세우고 있었다. 실제 팹은 그 상황에서 라인을 세우지 않고 긴급 조달로 대응한다.
//  ② 재주문 정책과 구조적으로 충돌한다(docs/fab-operating-baseline.md R1) — 재주문은
//     커버리지가 max(ropDays, 리드타임)일 때 걸리는데 화물은 리드타임 뒤에 도착하므로,
//     ropDays < 2 × 리드타임인 자재는 발주가 제때 나가도 도착 전에 ropDays×0.5를 지나
//     반드시 라인이 선다(44종 중 17종 해당).
// 두 신호의 역할을 나눠서 상보적으로 만든다 — CRITICAL은 긴급 조달을 발동시키고,
// STOCKOUT만 라인을 세운다. 차단 대상은 항상 긴급 대상의 부분집합이다.
export function blockingMaterialIds(signals: MaterialSignal[]): Set<string> {
  return new Set(
    signals
      .filter((s) => s.state === "STOCKOUT")
      .map((s) => s.materialId),
  );
}

export function buildMaterialsShadow(signals: MaterialSignal[], now: string): MaterialsShadowReport {
  const ranked = signals
    .filter((s) => s.state !== "NORMAL")
    .sort((a, b) => {
      const rankDiff = STATE_RANK[b.state] - STATE_RANK[a.state];
      if (rankDiff !== 0) return rankDiff;
      if (a.coverageDays === null) return 1;
      if (b.coverageDays === null) return -1;
      return a.coverageDays - b.coverageDays;
    });

  const topSignal = ranked[0] ?? null;
  const top: MaterialsRuleItem | null = topSignal ? {
    materialId: topSignal.materialId,
    code: topSignal.code,
    name: topSignal.name,
    verdict: verdictOf(topSignal.state),
    verdictText: verdictTextOf(topSignal, verdictOf(topSignal.state)),
    coverageDays: topSignal.coverageDays,
  } : null;

  return {
    generatedAt: now,
    policyVersion: MATERIALS_AGENT_POLICY_VERSION,
    scenarioLabel: "현재 재고 커버리지 점검",
    shadowMode: true,
    top,
    summary: {
      critical: signals.filter((s) => s.state === "STOCKOUT" || s.state === "CRITICAL").length,
      watch: signals.filter((s) => s.state === "BELOW_ROP").length,
      dataGap: signals.filter((s) => s.state === "NO_BURN").length,
    },
  };
}
