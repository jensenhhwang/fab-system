export type ProductDemand = { HBM: number; DRAM: number; NAND: number };
export type ScenarioMaterial = {
  id: string; code: string; name: string; category: string; unit: string; currentQuantity: number;
  baseDailyUsage: number; ropDays: number; productDailyUsage: ProductDemand;
  warehouseCode: string; warehouseName: string; occupancyFactor: number;
};
export type ScenarioPlan = { name: string; inboundQuantity: number; inboundDay: number; demand: ProductDemand };
export type DailyScenarioPoint = { day: number; opening: number; inbound: number; usage: number; closing: number; shortage: number };
export type ScenarioResult = {
  name: string; effectiveDailyUsage: number; endingQuantity: number; firstSafetyStockDay: number | null;
  firstStockoutDay: number | null; maxShortage: number; points: DailyScenarioPoint[];
};

// ─── 타임라인 시나리오 (멀티 이벤트) ────────────────────────

export type TimelineEvent = {
  id: string;
  day: number;
  product: keyof ProductDemand | "ALL";
  changePct: number;
};

export type PurchasePlan = {
  id: string;
  materialId: string;
  dayOffset: number;
  quantity: number;
};

export type TimelinePoint = { day: number; closing: number; doh: number };

export type TimelineMaterialResult = {
  materialId: string;
  name: string;
  unit: string;
  ropDays: number;
  currentQuantity: number;
  points: TimelinePoint[];           // 발주 없는 기준선
  withPlanPoints: TimelinePoint[];   // 발주 계획 반영
  stockoutDay: number | null;
  safetyStockDay: number | null;
  planStockoutDay: number | null;    // 발주 계획 반영 후 소진일
  planSafetyStockDay: number | null;
  orderNeededByDay: number | null;
  recommendedQty: number;
  resolvedByPlan: boolean;           // 발주 계획으로 결품이 해소됐는가
};

export function runTimelineScenario(
  material: ScenarioMaterial,
  events: TimelineEvent[],
  plans: PurchasePlan[] = [],
  horizonDays = 90
): TimelineMaterialResult {
  // 1. 이벤트 정렬 + 동일 day·product 중복 제거 (마지막 값 우선)
  const sorted = [...events].sort((a, b) => a.day - b.day || 0);
  const dedupMap = new Map<string, TimelineEvent>();
  for (const ev of sorted) {
    dedupMap.set(`${ev.day}-${ev.product}`, ev);
  }
  const deduped = [...dedupMap.values()].sort((a, b) => a.day - b.day);

  // 2. 구간 덮어쓰기 방식으로 product별 changePct 관리
  const demandPct: Record<string, number> = { HBM: 0, DRAM: 0, NAND: 0 };
  const setDemand = (product: string, pct: number) => {
    if (product === "ALL") { demandPct.HBM = pct; demandPct.DRAM = pct; demandPct.NAND = pct; }
    else demandPct[product] = pct;
  };

  // day=0 이벤트를 초기값으로 선적용
  for (const ev of deduped) {
    if (ev.day === 0) setDemand(ev.product, ev.changePct);
  }

  // day별 이벤트 인덱스
  const eventsByDay = new Map<number, TimelineEvent[]>();
  for (const ev of deduped) {
    if (ev.day > 0) {
      if (!eventsByDay.has(ev.day)) eventsByDay.set(ev.day, []);
      eventsByDay.get(ev.day)!.push(ev);
    }
  }

  const productBase = Object.values(material.productDailyUsage).reduce((s, v) => s + v, 0);

  const getUsage = () => {
    if (productBase === 0) return material.baseDailyUsage;
    return (Object.keys(material.productDailyUsage) as (keyof ProductDemand)[]).reduce(
      (sum, p) => sum + material.productDailyUsage[p] * (1 + (demandPct[p] ?? 0) / 100), 0
    );
  };

  // 이 자재에 해당하는 발주 계획만 필터링
  const materialPlans = plans.filter(p => p.materialId === material.id);

  const simulate = (withPlans: boolean) => {
    let qty = material.currentQuantity;
    const pts: TimelinePoint[] = [];
    let stockoutDay: number | null = null;
    let safetyStockDay: number | null = null;
    let peakUsage = 0;

    // day=0 이벤트 재적용 (demandPct는 이미 위에서 설정됨, 시뮬마다 리셋 필요)
    const localDemandPct: Record<string, number> = { HBM: 0, DRAM: 0, NAND: 0 };
    const localSetDemand = (product: string, pct: number) => {
      if (product === "ALL") { localDemandPct.HBM = pct; localDemandPct.DRAM = pct; localDemandPct.NAND = pct; }
      else localDemandPct[product] = pct;
    };
    for (const ev of deduped) if (ev.day === 0) localSetDemand(ev.product, ev.changePct);
    const localGetUsage = () => {
      if (productBase === 0) return material.baseDailyUsage;
      return (Object.keys(material.productDailyUsage) as (keyof ProductDemand)[]).reduce(
        (sum, p) => sum + material.productDailyUsage[p] * (1 + (localDemandPct[p] ?? 0) / 100), 0
      );
    };

    for (let day = 0; day <= horizonDays; day++) {
      const dayEvs = eventsByDay.get(day);
      if (dayEvs) for (const ev of dayEvs) localSetDemand(ev.product, ev.changePct);

      if (withPlans) {
        for (const plan of materialPlans) {
          if (plan.dayOffset === day) qty += plan.quantity;
        }
      }

      const usage = localGetUsage();
      peakUsage = Math.max(peakUsage, usage);
      const ropThreshold = usage * material.ropDays;
      const shortage = Math.max(0, usage - qty);
      qty = Math.max(0, qty - usage);

      if (safetyStockDay === null && qty < ropThreshold) safetyStockDay = day;
      if (stockoutDay === null && shortage > 0) stockoutDay = day;

      const doh = usage > 0 ? qty / usage : 999;
      pts.push({ day, closing: qty, doh });
    }

    return { pts, stockoutDay, safetyStockDay, peakUsage };
  };

  const base = simulate(false);
  const withPlan = simulate(true);

  const triggerDay = base.stockoutDay ?? base.safetyStockDay;
  const orderNeededByDay = triggerDay !== null ? Math.max(0, triggerDay - material.ropDays) : null;
  const recommendedQty = Math.ceil(base.peakUsage * Math.max(material.ropDays * 3, 30));
  const resolvedByPlan = (base.stockoutDay !== null || base.safetyStockDay !== null)
    && withPlan.stockoutDay === null && withPlan.safetyStockDay === null;

  return {
    materialId: material.id,
    name: material.name,
    unit: material.unit,
    ropDays: material.ropDays,
    currentQuantity: material.currentQuantity,
    points: base.pts,
    withPlanPoints: withPlan.pts,
    stockoutDay: base.stockoutDay,
    safetyStockDay: base.safetyStockDay,
    planStockoutDay: withPlan.stockoutDay,
    planSafetyStockDay: withPlan.safetyStockDay,
    orderNeededByDay,
    recommendedQty,
    resolvedByPlan,
  };
}

// ─── 기존 단일 시점 시나리오 ────────────────────────────────
export function runMaterialScenario(material: ScenarioMaterial, plan: ScenarioPlan, horizonDays = 90): ScenarioResult {
  const productBase = Object.values(material.productDailyUsage).reduce((sum, value) => sum + value, 0);
  const effectiveDailyUsage = productBase > 0
    ? (Object.keys(plan.demand) as (keyof ProductDemand)[]).reduce((sum, product) => sum + material.productDailyUsage[product] * (1 + plan.demand[product] / 100), 0)
    : material.baseDailyUsage;
  const safetyStock = effectiveDailyUsage * material.ropDays;
  let quantity = material.currentQuantity;
  let firstSafetyStockDay: number | null = quantity < safetyStock ? 0 : null;
  let firstStockoutDay: number | null = null;
  let maxShortage = 0;
  const points: DailyScenarioPoint[] = [];
  for (let day = 0; day <= horizonDays; day++) {
    const opening = quantity;
    const inbound = day === plan.inboundDay ? Math.max(0, plan.inboundQuantity) : 0;
    const available = opening + inbound;
    const shortage = Math.max(0, effectiveDailyUsage - available);
    quantity = Math.max(0, available - effectiveDailyUsage);
    if (firstSafetyStockDay === null && quantity < safetyStock) firstSafetyStockDay = day;
    if (firstStockoutDay === null && shortage > 0) firstStockoutDay = day;
    maxShortage = Math.max(maxShortage, shortage);
    points.push({ day, opening, inbound, usage: effectiveDailyUsage, closing: quantity, shortage });
  }
  return { name: plan.name, effectiveDailyUsage, endingQuantity: quantity, firstSafetyStockDay, firstStockoutDay, maxShortage, points };
}
