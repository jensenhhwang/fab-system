import { randomUUID } from "crypto";
import { collections } from "@/lib/db";
import { advanceAggregateWip } from "@/lib/lot-route";
import { getRouteMaster, expandRouteMaster } from "@/lib/route-master";
import { M20_MATERIAL_CONSUMPTION } from "@/lib/material-consumption";
import { buildStepConsumption, computeBurn, type StepConsumption } from "@/lib/twin/burn";
import { planInbound, settleArrivals, updateBurnEma } from "@/lib/twin/inbound";
import { getBaseLeadTime } from "@/lib/twin/lead-time";
import { getOrInitTwinState, acquireTwinLock, releaseTwinLock } from "@/lib/twin/state";
import { burnInventoryProjection, increaseInventoryProjection } from "@/lib/inventory-projection";

const LOCK_TTL_MS = 30_000;
const EMA_ALPHA = 0.2;
const MAX_DT_DAYS = 3; // 오래 멈췄다 재개 시 catch-up 폭주 방지

export type TwinTickResult = {
  advanced: number;
  burnedByMaterial: Record<string, number>;
  shortfalls: Record<string, number>;
  newPOs: number;
  receipts: number;
  skipped?: "PAUSED" | "LOCKED";
};

let cachedStepConsumption: StepConsumption | null = null;
async function getStepConsumption(): Promise<StepConsumption> {
  if (cachedStepConsumption) return cachedStepConsumption;
  const routeMaster = await getRouteMaster("M20", "HBM");
  if (!routeMaster) return new Map();
  const visits = expandRouteMaster(routeMaster);
  cachedStepConsumption = buildStepConsumption(visits, [...M20_MATERIAL_CONSUMPTION]);
  return cachedStepConsumption;
}

// 자재의 대표 창고: 재고가 가장 많은 inventory 문서의 warehouseId.
async function resolveWarehouse(materialId: string): Promise<string | null> {
  const { inventory } = await collections();
  const doc = await inventory.find({ materialId }).sort({ quantity: -1 }).limit(1).next();
  return doc?.warehouseId ?? null;
}

export async function executeTwinTick(now: Date = new Date()): Promise<TwinTickResult> {
  const empty: TwinTickResult = { advanced: 0, burnedByMaterial: {}, shortfalls: {}, newPOs: 0, receipts: 0 };
  const state = await getOrInitTwinState();
  if (state.status !== "RUNNING") return { ...empty, skipped: "PAUSED" };

  const owner = randomUUID();
  if (!(await acquireTwinLock(owner, LOCK_TTL_MS))) return { ...empty, skipped: "LOCKED" };

  try {
    const { inventory, materials, twinPurchaseOrders, twinBurnEvents } = await collections();
    const dtDays = Math.min(MAX_DT_DAYS, Math.max(1e-6, (now.getTime() - state.lastTickAt.getTime()) / 86_400_000));

    // ① WIP 진행 → ② 소모 계산
    const adv = await advanceAggregateWip("M20", "HBM");
    const stepConsumption = await getStepConsumption();
    const burn = computeBurn(adv.advancedFromStepIndex, stepConsumption);

    const burnedByMaterial: Record<string, number> = {};
    const shortfalls: Record<string, number> = {};
    for (const [materialId, qty] of burn) {
      if (qty <= 0) continue;
      const warehouseId = await resolveWarehouse(materialId);
      if (!warehouseId) continue;
      const { burned, shortfall } = await burnInventoryProjection({ materialId, warehouseId, quantity: qty });
      burnedByMaterial[materialId] = burned;
      if (shortfall > 0) shortfalls[materialId] = shortfall;

      // 실측 일일 소모율 EMA 갱신
      const inv = await inventory.findOne({ materialId, warehouseId });
      const observedDaily = burned / dtDays;
      const nextEma = updateBurnEma(inv?.avgDailyBurn ?? 0, observedDaily, EMA_ALPHA);
      await inventory.updateOne({ materialId, warehouseId }, { $set: { avgDailyBurn: nextEma } });

      await twinBurnEvents.insertOne({ _id: randomUUID(), tickAt: now, materialId, burnedQty: burned, shortfallQty: shortfall });
    }

    // ③ 입고: 전체 M20 자재에 대해 ROP 점검·발주, 도착 정산 (이번 tick에 소모되지 않은 자재도 도착 PO는 반드시 정산되어야 함)
    let newPOs = 0;
    let receipts = 0;
    const materialIds = [...new Set(M20_MATERIAL_CONSUMPTION.map((r) => r.materialId))];
    for (const materialId of materialIds) {
      const warehouseId = await resolveWarehouse(materialId);
      if (!warehouseId) continue;
      const inv = await inventory.findOne({ materialId, warehouseId });
      const mat = await materials.findOne({ _id: materialId });
      if (!inv || !mat) continue;

      const openPOs = await twinPurchaseOrders.find({ materialId, status: { $ne: "RECEIVED" } }).toArray();
      const inTransit = openPOs.reduce((s, po) => s + po.qty, 0);
      const plan = planInbound({ onHand: inv.quantity, inTransit, avgDailyBurn: inv.avgDailyBurn ?? 0, ropDays: mat.ropDays });
      if (plan) {
        const leadTimeDays = getBaseLeadTime(mat.category);
        await twinPurchaseOrders.insertOne({
          _id: randomUUID(), materialId, qty: plan.qty, orderedAt: now,
          etaAt: new Date(now.getTime() + leadTimeDays * 86_400_000), leadTimeDays, status: "ORDERED",
        });
        newPOs++;
      }

      const arrivals = settleArrivals(openPOs, now);
      for (const r of arrivals.receipts) {
        await increaseInventoryProjection({ materialId: r.materialId, warehouseId, quantity: r.qty });
        receipts++;
      }
      if (arrivals.arrivedPoIds.length > 0) {
        await twinPurchaseOrders.updateMany({ _id: { $in: arrivals.arrivedPoIds } }, { $set: { status: "RECEIVED" } });
      }
    }

    const { twinEngineState } = await collections();
    await twinEngineState.updateOne({ _id: "singleton" }, { $set: { lastTickAt: now } });
    return { advanced: adv.advanced, burnedByMaterial, shortfalls, newPOs, receipts };
  } finally {
    await releaseTwinLock(owner);
  }
}
