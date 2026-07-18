import { collections } from "@/lib/db";
import type { Product } from "@/lib/db";
import { PRODUCT_TO_FAB, type FabId } from "@/lib/fab-domain";
import { dailyPlanKWafer, utilizedMonthlyKWafer } from "@/lib/fab-scenario";
import { getActualsForDate, PRODUCTS } from "@/lib/production-actuals";

export type MaterialStatus = "critical" | "warning" | "ok" | "safe";

export type MaterialUsageByProduct = {
  product: Product;
  fabId: FabId;
  producedQty: number | null; // null = 아직 미확정(계획치로 잠정 표시)
  planQty: number;
  coefficient: number; // MODELED_BASELINE: K-wafer당 자재 사용량
  usage: number;
  confirmed: boolean;
};

export type LiveMaterialRow = {
  materialId: string;
  code: string;
  name: string;
  unit: string;
  category: string;
  current: number;
  safetyStock: number;
  ropDays: number;
  todayUsage: number;
  projectedClose: number;
  closeDoh: number;
  status: MaterialStatus;
  statusReason: string;
  usageByProduct: MaterialUsageByProduct[];
  sharedAcrossFabs: boolean;
  allConfirmed: boolean;
};

const STATUS_ORDER: Record<MaterialStatus, number> = { critical: 0, warning: 1, ok: 2, safe: 3 };

function statusFor(projectedClose: number, safetyStock: number, dailyUsage: number, ropDays: number): { status: MaterialStatus; reason: string } {
  if (dailyUsage <= 0) return { status: "safe", reason: "오늘 사용 실적 없음" };
  const doh = projectedClose / dailyUsage;
  if (projectedClose < 0 || doh < 3) return { status: "critical", reason: `마감 DOH ${doh.toFixed(1)}일` };
  if (projectedClose < safetyStock || doh < ropDays) return { status: "warning", reason: `안전기준 ${ropDays}일 미만` };
  if (doh < ropDays * 2) return { status: "ok", reason: "계획 범위 내" };
  return { status: "safe", reason: "완충재고 충분" };
}

export async function buildLiveDailyControl(date: string): Promise<LiveMaterialRow[]> {
  const { materials, inventory, processUsage } = await collections();
  const [actuals, materialDocs, inventoryDocs, usageDocs] = await Promise.all([
    getActualsForDate(date),
    materials.find({}).toArray(),
    inventory.find({}).toArray(),
    processUsage.find({}).toArray(),
  ]);

  const inventoryByMaterial = new Map<string, { quantity: number; avgDailyUsage: number }>();
  for (const row of inventoryDocs) {
    const acc = inventoryByMaterial.get(row.materialId) ?? { quantity: 0, avgDailyUsage: 0 };
    acc.quantity += row.quantity;
    acc.avgDailyUsage += row.avgDailyUsage;
    inventoryByMaterial.set(row.materialId, acc);
  }

  const usageByMaterial = new Map<string, typeof usageDocs>();
  for (const row of usageDocs) {
    const list = usageByMaterial.get(row.materialId) ?? [];
    list.push(row);
    usageByMaterial.set(row.materialId, list);
  }

  const rows: LiveMaterialRow[] = [];
  for (const material of materialDocs) {
    const usageRows = usageByMaterial.get(material._id);
    if (!usageRows?.length) continue; // 공정 사용 실적이 없는 자재는 이 화면 대상이 아님

    const productsUsed = PRODUCTS.filter((product) => usageRows.some((row) => row.product === product));
    const usageByProduct: MaterialUsageByProduct[] = productsUsed.map((product) => {
      const monthlyQty = usageRows.filter((row) => row.product === product).reduce((sum, row) => sum + row.monthlyQty, 0);
      const monthlyBase = utilizedMonthlyKWafer(product);
      const coefficient = monthlyBase > 0 ? monthlyQty / monthlyBase : 0;
      const actual = actuals[product];
      const producedQty = actual?.producedQty ?? null;
      const planQty = dailyPlanKWafer(product);
      const usage = coefficient * (producedQty ?? planQty);
      return { product, fabId: PRODUCT_TO_FAB[product], producedQty, planQty, coefficient, usage, confirmed: producedQty !== null };
    });

    const todayUsage = usageByProduct.reduce((sum, item) => sum + item.usage, 0);
    const inv = inventoryByMaterial.get(material._id) ?? { quantity: 0, avgDailyUsage: 0 };
    const current = inv.quantity;
    const projectedClose = current - todayUsage;
    const dailyUsageRate = todayUsage > 0 ? todayUsage : inv.avgDailyUsage;
    const closeDoh = dailyUsageRate > 0 ? projectedClose / dailyUsageRate : Infinity;
    const { status, reason } = statusFor(projectedClose, material.safetyStock, dailyUsageRate, material.ropDays);

    rows.push({
      materialId: material._id, code: material.code, name: material.name, unit: material.unit, category: material.category,
      current, safetyStock: material.safetyStock, ropDays: material.ropDays,
      todayUsage, projectedClose, closeDoh, status, statusReason: reason,
      usageByProduct, sharedAcrossFabs: usageByProduct.length >= 2,
      allConfirmed: usageByProduct.every((item) => item.confirmed),
    });
  }

  rows.sort((a, b) => (STATUS_ORDER[a.status] === STATUS_ORDER[b.status] ? a.closeDoh - b.closeDoh : STATUS_ORDER[a.status] - STATUS_ORDER[b.status]));
  return rows;
}
