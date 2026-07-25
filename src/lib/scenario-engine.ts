export type ProductDemand = { HBM: number; DRAM: number; NAND: number };
export type ScenarioMaterial = {
  id: string; code: string; name: string; category: string; unit: string; currentQuantity: number;
  baseDailyUsage: number; ropDays: number; productDailyUsage: ProductDemand;
  warehouseCode: string; warehouseName: string; occupancyFactor: number;
  leadTimeDays?: number | null; supplierName?: string | null;
  safeLeadTimeDays?: number | null; leadTimeSource?: "CURRENT" | "STANDARD" | "LEGACY" | "MISSING";
  procurementAlternatives?: { supplierName: string; standardDays: number | null; emergencyOrderAllowed: boolean }[];
  reservedQuantity?: number;
  qualityBlockedQuantity?: number;
  expiringQuantity30d?: number;
  confirmedInboundByDay?: { day: number; quantity: number }[];
  procurementPolicies?: Partial<Record<"M20" | "M21" | "M22", { moq: number; orderMultiple: number }>>;
  inventoryLedgerVariance?: number | null;
  usageSource?: string;
  usageSourceVersion?: string | null;
  usageConfidence?: "HIGH" | "MEDIUM" | "LOW" | "CALIBRATION_REQUIRED";
};

export type ProductionIncreaseInput = {
  product: keyof ProductDemand;
  startDay: number;
  increasePct: number;
  durationDays: number;
  horizonDays: number;
  replenishmentMode: "ROP" | "STOCKOUT";
  coverageDays: number;
};

export type ProductionPlanEvent = {
  id: string;
  product: keyof ProductDemand;
  startDay: number;
  changePct: number;
  durationDays: number;
};

export type ProductionPlanInput = {
  events: ProductionPlanEvent[];
  horizonDays: number;
  replenishmentMode: "ROP" | "STOCKOUT";
  coverageDays: number;
};

export type DemandDriver = { product: keyof ProductDemand; changePct: number; dailyDelta: number };

export type InboundAction = {
  materialId: string; code: string; name: string; unit: string;
  inboundDay: number; orderDay: number | null; quantity: number;
  leadTimeDays: number | null; supplierName: string | null;
  priority: "OVERDUE" | "NOW" | "PLANNED" | "LEAD_TIME_MISSING";
  reason: "EXISTING_RISK" | "PRODUCTION_CHANGE";
  projectedBeforeInbound: number; targetQuantity: number;
  drivers: DemandDriver[];
  safeOrderDay: number | null;
  leadTimeSource: ScenarioMaterial["leadTimeSource"];
  procurementAlternatives: NonNullable<ScenarioMaterial["procurementAlternatives"]>;
};

export type ProductionMaterialPlan = {
  material: ScenarioMaterial;
  basePoints: TimelinePoint[];
  scenarioPoints: TimelinePoint[];
  actions: InboundAction[];
  additionalDailyUsage: number;
};

export type ProductionIncreasePlan = {
  input: ProductionPlanInput;
  actions: InboundAction[];
  materials: ProductionMaterialPlan[];
  status: "FEASIBLE" | "URGENT" | "LEAD_TIME_MISSING";
};

export type MaterialRecommendationWarning = {
  code:
    | "EXISTING_SHORTAGE"
    | "LEAD_TIME_MISSING"
    | "SUPPLIER_MISSING"
    | "PROCUREMENT_POLICY_MISSING"
    | "QUALITY_BLOCKED"
    | "RESERVED_STOCK"
    | "EXPIRY_RISK"
    | "INVENTORY_LEDGER_MISMATCH"
    | "LOW_USAGE_CONFIDENCE";
  label: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
};

export type MaterialRecommendation = {
  material: ScenarioMaterial;
  baseline: { grossRequirement: number; recommendedInbound: number; firstNeedDay: number | null };
  scenario: { grossRequirement: number; recommendedInbound: number; firstNeedDay: number | null };
  netInputs: {
    onHand: number;
    reserved: number;
    qualityBlocked: number;
    available: number;
    confirmedInbound: number;
  };
  additionalRequirement: number;
  incrementalOrderQuantity: number;
  policyAdjustedOrderQuantity: number;
  needByDay: number | null;
  normalOrderByDay: number | null;
  safeOrderByDay: number | null;
  classification: "EXISTING_SHORTAGE" | "SCENARIO_CAUSED_SHORTAGE" | "NO_INCREMENTAL_ORDER";
  warnings: MaterialRecommendationWarning[];
  evidence: {
    formulaVersion: "MATERIAL_COPILOT_V1";
    usageSource: string;
    usageSourceVersion: string | null;
  };
};

export type MaterialRecommendationPlan = {
  recommendations: MaterialRecommendation[];
  summary: {
    affectedMaterials: number;
    incrementalOrders: number;
    urgentOrders: number;
    attentionMaterials: number;
  };
};

function normalizeEvent(event: ProductionPlanEvent): ProductionPlanEvent {
  return {
    ...event,
    startDay: Math.max(0, Math.round(event.startDay)),
    changePct: Math.max(-100, Math.min(300, event.changePct)),
    durationDays: Math.max(1, Math.round(event.durationDays)),
  };
}

function activeProductChanges(events: ProductionPlanEvent[], day: number): ProductDemand {
  const changes: ProductDemand = { HBM: 0, DRAM: 0, NAND: 0 };
  for (const event of events) {
    if (day >= event.startDay && day < event.startDay + event.durationDays) {
      changes[event.product] += event.changePct;
    }
  }
  for (const product of Object.keys(changes) as (keyof ProductDemand)[]) {
    changes[product] = Math.max(-100, changes[product]);
  }
  return changes;
}

function dailyUsageForPlan(material: ScenarioMaterial, events: ProductionPlanEvent[], day: number) {
  const productTotal = Object.values(material.productDailyUsage).reduce((sum, value) => sum + value, 0);
  const nonProductUsage = Math.max(0, material.baseDailyUsage - productTotal);
  const changes = activeProductChanges(events, day);
  return nonProductUsage + (Object.keys(material.productDailyUsage) as (keyof ProductDemand)[]).reduce(
    (sum, product) => sum + material.productDailyUsage[product] * (1 + changes[product] / 100),
    0,
  );
}

function simulateMaterialReplenishment(
  material: ScenarioMaterial,
  events: ProductionPlanEvent[],
  input: Pick<ProductionPlanInput, "horizonDays" | "coverageDays" | "replenishmentMode">,
) {
  const reserved = Math.max(0, material.reservedQuantity ?? 0);
  const qualityBlocked = Math.max(0, material.qualityBlockedQuantity ?? 0);
  let quantity = Math.max(0, material.currentQuantity - reserved - qualityBlocked);
  let grossRequirement = 0;
  let recommendedInbound = 0;
  let firstNeedDay: number | null = null;
  const inboundByDay = new Map<number, number>();
  for (const inbound of material.confirmedInboundByDay ?? []) {
    const day = Math.max(0, Math.round(inbound.day));
    inboundByDay.set(day, (inboundByDay.get(day) ?? 0) + Math.max(0, inbound.quantity));
  }

  for (let day = 0; day < input.horizonDays; day++) {
    quantity += inboundByDay.get(day) ?? 0;
    const usage = dailyUsageForPlan(material, events, day);
    grossRequirement += usage;
    quantity -= usage;
    const target = input.replenishmentMode === "ROP" ? usage * material.ropDays : 0;
    if (quantity < target) {
      const inbound = Math.max(0, target + usage * input.coverageDays - quantity);
      if (firstNeedDay === null) firstNeedDay = day;
      recommendedInbound += inbound;
      quantity += inbound;
    }
  }

  return {
    grossRequirement: Math.round(grossRequirement * 100) / 100,
    recommendedInbound: Math.round(recommendedInbound * 100) / 100,
    firstNeedDay,
  };
}

function applyOrderPolicy(quantity: number, policy?: { moq: number; orderMultiple: number }) {
  if (quantity <= 0) return 0;
  if (!policy) return Math.ceil(quantity * 100) / 100;
  const minimum = Math.max(quantity, Math.max(0, policy.moq));
  if (policy.orderMultiple <= 0) return Math.ceil(minimum * 100) / 100;
  return Math.ceil(minimum / policy.orderMultiple) * policy.orderMultiple;
}

export function recommendMaterialOrders(
  sourceMaterials: ScenarioMaterial[],
  rawInput: ProductionPlanInput,
  fabId: "M20" | "M21" | "M22" | null,
): MaterialRecommendationPlan {
  const input: ProductionPlanInput = {
    ...rawInput,
    events: rawInput.events.map(normalizeEvent),
    horizonDays: Math.max(1, Math.round(rawInput.horizonDays)),
    coverageDays: Math.max(1, Math.round(rawInput.coverageDays)),
  };
  const products = new Set(input.events.map(event => event.product));
  const relevant = sourceMaterials.filter(material => material.baseDailyUsage > 0 && (
    products.size === 0 || [...products].some(product => material.productDailyUsage[product] > 0)
  ));

  const recommendations = relevant.map<MaterialRecommendation>(material => {
    const baseline = simulateMaterialReplenishment(material, [], input);
    const scenario = simulateMaterialReplenishment(material, input.events, input);
    const incrementalRaw = Math.max(0, scenario.recommendedInbound - baseline.recommendedInbound);
    const incrementalOrderQuantity = Math.round(incrementalRaw * 100) / 100;
    const policy = fabId ? material.procurementPolicies?.[fabId] : undefined;
    const policyAdjustedOrderQuantity = applyOrderPolicy(incrementalOrderQuantity, policy);
    const reserved = Math.max(0, material.reservedQuantity ?? 0);
    const qualityBlocked = Math.max(0, material.qualityBlockedQuantity ?? 0);
    const confirmedInbound = (material.confirmedInboundByDay ?? []).reduce((sum, inbound) => sum + Math.max(0, inbound.quantity), 0);
    const warnings: MaterialRecommendationWarning[] = [];
    if (baseline.recommendedInbound > 0) warnings.push({ code: "EXISTING_SHORTAGE", label: "기준 계획에서도 보충 필요", severity: "HIGH" });
    if (material.leadTimeDays == null) warnings.push({ code: "LEAD_TIME_MISSING", label: "리드타임 미등록", severity: "HIGH" });
    if (!material.supplierName) warnings.push({ code: "SUPPLIER_MISSING", label: "승인 공급사 미등록", severity: "HIGH" });
    if (incrementalOrderQuantity > 0 && !policy) warnings.push({ code: "PROCUREMENT_POLICY_MISSING", label: "MOQ·발주배수 미연결", severity: "MEDIUM" });
    if (qualityBlocked > 0) warnings.push({ code: "QUALITY_BLOCKED", label: `품질 보류 ${qualityBlocked.toLocaleString("ko-KR")}${material.unit}`, severity: "HIGH" });
    if (reserved > 0) warnings.push({ code: "RESERVED_STOCK", label: `예약 ${reserved.toLocaleString("ko-KR")}${material.unit}`, severity: "LOW" });
    if ((material.expiringQuantity30d ?? 0) > 0) warnings.push({ code: "EXPIRY_RISK", label: `30일 내 만료 ${(material.expiringQuantity30d ?? 0).toLocaleString("ko-KR")}${material.unit}`, severity: "MEDIUM" });
    if (material.inventoryLedgerVariance != null && Math.abs(material.inventoryLedgerVariance) > Math.max(1, material.currentQuantity * 0.01)) {
      warnings.push({ code: "INVENTORY_LEDGER_MISMATCH", label: "집계재고·Lot 원장 차이", severity: "MEDIUM" });
    }
    if (material.usageConfidence === "LOW" || material.usageConfidence === "CALIBRATION_REQUIRED") {
      warnings.push({ code: "LOW_USAGE_CONFIDENCE", label: "원단위 보정 필요", severity: "MEDIUM" });
    }
    const needByDay = scenario.firstNeedDay;
    const normalOrderByDay = needByDay === null || material.leadTimeDays == null ? null : needByDay - material.leadTimeDays;
    const safeOrderByDay = needByDay === null || material.safeLeadTimeDays == null ? null : needByDay - material.safeLeadTimeDays;
    return {
      material,
      baseline,
      scenario,
      netInputs: {
        onHand: material.currentQuantity,
        reserved,
        qualityBlocked,
        available: Math.max(0, material.currentQuantity - reserved - qualityBlocked),
        confirmedInbound,
      },
      additionalRequirement: Math.round(Math.max(0, scenario.grossRequirement - baseline.grossRequirement) * 100) / 100,
      incrementalOrderQuantity,
      policyAdjustedOrderQuantity,
      needByDay,
      normalOrderByDay,
      safeOrderByDay,
      classification: incrementalOrderQuantity > 0
        ? "SCENARIO_CAUSED_SHORTAGE"
        : baseline.recommendedInbound > 0 ? "EXISTING_SHORTAGE" : "NO_INCREMENTAL_ORDER",
      warnings,
      evidence: {
        formulaVersion: "MATERIAL_COPILOT_V1",
        usageSource: material.usageSource ?? "UNKNOWN",
        usageSourceVersion: material.usageSourceVersion ?? null,
      },
    };
  }).sort((a, b) => {
    const aUrgency = a.normalOrderByDay ?? Number.MAX_SAFE_INTEGER;
    const bUrgency = b.normalOrderByDay ?? Number.MAX_SAFE_INTEGER;
    return aUrgency - bUrgency || b.policyAdjustedOrderQuantity - a.policyAdjustedOrderQuantity || a.material.code.localeCompare(b.material.code);
  });

  return {
    recommendations,
    summary: {
      affectedMaterials: recommendations.length,
      incrementalOrders: recommendations.filter(item => item.incrementalOrderQuantity > 0).length,
      urgentOrders: recommendations.filter(item => item.incrementalOrderQuantity > 0 && (item.normalOrderByDay === null || item.normalOrderByDay <= 0)).length,
      attentionMaterials: recommendations.filter(item => item.warnings.length > 0).length,
    },
  };
}

export function planProductionChanges(
  sourceMaterials: ScenarioMaterial[],
  rawInput: ProductionPlanInput,
): ProductionIncreasePlan {
  const input: ProductionPlanInput = {
    ...rawInput,
    events: rawInput.events.map(normalizeEvent),
    horizonDays: Math.max(1, Math.round(rawInput.horizonDays)),
    coverageDays: Math.max(1, Math.round(rawInput.coverageDays)),
  };
  const products = new Set(input.events.map(event => event.product));
  const relevant = sourceMaterials.filter(material =>
    [...products].some(product => material.productDailyUsage[product] > 0),
  );
  const materials = relevant.map<ProductionMaterialPlan>(material => {
    let baseQty = material.currentQuantity;
    let scenarioQty = material.currentQuantity;
    const basePoints: TimelinePoint[] = [];
    const scenarioPoints: TimelinePoint[] = [];
    const actions: InboundAction[] = [];
    for (let day = 0; day <= input.horizonDays; day++) {
      const baseUsage = dailyUsageForPlan(material, [], day);
      const scenarioUsage = dailyUsageForPlan(material, input.events, day);
      baseQty -= baseUsage;
      scenarioQty -= scenarioUsage;
      const target = input.replenishmentMode === "ROP" ? scenarioUsage * material.ropDays : 0;
      if (scenarioQty < target) {
        const quantity = Math.max(0, target + scenarioUsage * input.coverageDays - scenarioQty);
        const roundedQuantity = Math.ceil(quantity * 100) / 100;
        const leadTime = material.leadTimeDays ?? null;
        const orderDay = leadTime === null ? null : day - leadTime;
        const safeOrderDay = material.safeLeadTimeDays == null ? null : day - material.safeLeadTimeDays;
        const baseTarget = input.replenishmentMode === "ROP" ? baseUsage * material.ropDays : 0;
        const changes = activeProductChanges(input.events, day);
        const drivers = (Object.keys(changes) as (keyof ProductDemand)[])
          .filter(product => changes[product] !== 0 && material.productDailyUsage[product] > 0)
          .map(product => ({ product, changePct: changes[product], dailyDelta: material.productDailyUsage[product] * changes[product] / 100 }));
        actions.push({
          materialId: material.id, code: material.code, name: material.name, unit: material.unit,
          inboundDay: day, orderDay, quantity: roundedQuantity, leadTimeDays: leadTime,
          supplierName: material.supplierName ?? null,
          priority: orderDay === null ? "LEAD_TIME_MISSING" : orderDay < 0 ? "OVERDUE" : orderDay === 0 ? "NOW" : "PLANNED",
          reason: baseQty < baseTarget ? "EXISTING_RISK" : "PRODUCTION_CHANGE",
          projectedBeforeInbound: Math.max(0, scenarioQty), targetQuantity: target,
          drivers, safeOrderDay, leadTimeSource: material.leadTimeSource ?? "MISSING",
          procurementAlternatives: material.procurementAlternatives ?? [],
        });
        scenarioQty += roundedQuantity;
      }
      baseQty = Math.max(0, baseQty);
      scenarioQty = Math.max(0, scenarioQty);
      basePoints.push({ day, closing: baseQty, doh: baseUsage > 0 ? baseQty / baseUsage : 999 });
      scenarioPoints.push({ day, closing: scenarioQty, doh: scenarioUsage > 0 ? scenarioQty / scenarioUsage : 999 });
    }
    return {
      material, basePoints, scenarioPoints, actions,
      additionalDailyUsage: Math.max(0, ...Array.from({ length: input.horizonDays + 1 }, (_, day) => dailyUsageForPlan(material, input.events, day) - dailyUsageForPlan(material, [], day))),
    };
  });
  const actions = materials.flatMap(item => item.actions).sort((a, b) =>
    (a.orderDay ?? -999) - (b.orderDay ?? -999) || a.inboundDay - b.inboundDay || a.code.localeCompare(b.code),
  );
  const status = actions.some(action => action.leadTimeDays === null)
    ? "LEAD_TIME_MISSING"
    : actions.some(action => action.priority === "OVERDUE" || action.priority === "NOW") ? "URGENT" : "FEASIBLE";
  return { input, actions, materials, status };
}

export function planProductionIncrease(sourceMaterials: ScenarioMaterial[], input: ProductionIncreaseInput) {
  return planProductionChanges(sourceMaterials, {
    events: [{ id: "legacy", product: input.product, startDay: input.startDay, changePct: input.increasePct, durationDays: input.durationDays }],
    horizonDays: input.horizonDays, replenishmentMode: input.replenishmentMode, coverageDays: input.coverageDays,
  });
}
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
