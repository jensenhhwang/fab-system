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
