import { randomUUID } from "crypto";
import type { Product } from "@/lib/db";
import type { FabId } from "@/lib/fab-domain";
import { collections } from "@/lib/db";
import { advanceAggregateWip, releaseAggregateWip } from "@/lib/lot-route";
import { getRouteMaster, expandRouteMaster } from "@/lib/route-master";
import { materialConsumptionFor } from "@/lib/material-consumption";
import { buildStepConsumption, computeBurn, type StepConsumption } from "@/lib/twin/burn";
import { planInbound, settleArrivals, updateBurnEma } from "@/lib/twin/inbound";
import { getBaseLeadTime } from "@/lib/twin/lead-time";
import { getOrInitTwinState, acquireTwinLock, releaseTwinLock } from "@/lib/twin/state";
import { burnInventoryProjection, increaseInventoryProjection } from "@/lib/inventory-projection";
import { isRoleAutomationReady } from "@/lib/operations-automation-gate-server";
import { autonomyCeiling } from "@/lib/procurement-agent";
import { loadLiveScenarioMaterials } from "@/lib/material-scenario-server";
import { warehouseVerdict } from "@/lib/logistics-agent";
import { getWarehouseCapacity } from "@/lib/queries";
import { coverageState, criticalMaterialIds, type MaterialSignal } from "@/lib/materials-agent";
import { finishedGoodsPerWafer, finishedGoodsUnit, FINISHED_GOODS_WAREHOUSE_ID, applyFinalTestQueue } from "@/lib/finished-goods";
import { ACTIVE_PRODUCTION_PRODUCTS, getProductionConfig } from "@/lib/fab-production-config";
import { advanceStepBucketWip, releaseStepBucketWip } from "@/lib/twin/step-bucket";

const LOCK_TTL_MS = 30_000;
const EMA_ALPHA = 0.2;

// 한 tick은 각 due 로트를 정확히 공정 스텝 1개만큼 진행시킨다. 실제 팹에서 한 스텝의
// 소요시간 = 사이클타임 / 전체 스텝수 이므로, 한 tick이 나타내는 sim-time도 그만큼이다.
// avgDailyBurn을 실벽시계(5초)로 정규화하면 ~1.7만배 폭발하므로 이 sim-day로 정규화한다.
export function simDaysPerTick(cycleDays: number, totalSteps: number): number {
  if (totalSteps <= 0) return 1;
  return cycleDays / totalSteps;
}

export type TwinTickResult = {
  advanced: number;
  burnedByMaterial: Record<string, number>;
  shortfalls: Record<string, number>;
  newPOs: number;
  receipts: number;
  released: number;
  held: number;
  blocked: number;
  finishedGoodsAdded: number;
  finishedGoodsAddedByProduct: Partial<Record<Product, number>>;
  skipped?: "PAUSED" | "LOCKED" | "ROLE_GATE";
};

// 제품별 stepConsumption(공정 스텝 → 소모 자재) 캐시. route+원단위는 정적이므로 1회만 만든다.
const stepConsumptionCache = new Map<Product, { stepConsumption: StepConsumption; totalSteps: number }>();
async function getStepConsumption(fabId: FabId, product: Product): Promise<{ stepConsumption: StepConsumption; totalSteps: number }> {
  const cached = stepConsumptionCache.get(product);
  if (cached) return cached;
  const routeMaster = await getRouteMaster(fabId, product);
  if (!routeMaster) return { stepConsumption: new Map(), totalSteps: 0 };
  const visits = expandRouteMaster(routeMaster);
  const built = {
    stepConsumption: buildStepConsumption(visits, [...materialConsumptionFor(product)]),
    totalSteps: visits.length,
  };
  stepConsumptionCache.set(product, built);
  return built;
}

// avgDailyBurn EMA가 부트스트랩(리셋 직후) 시 걸러지지 않고 폭주하던 문제(실관측: CSM-001
// 설계 173/일 대비 실측 7,083/일, 41배)의 상한 기준 — 설계기준 수요(NORMAL 시나리오)의
// 3배까지는 정상적인 수요 증가로 인정하고, 그 이상은 catch-up burst로 간주해 잘라낸다.
// 자재는 3팹이 공유하므로 설계 수요도 HBM/DRAM/NAND 전 제품의 합으로 잡는다.
const BURN_EMA_CEILING_MULTIPLIER = 3;
let cachedDesignDailyDemand: Map<string, number> | null = null;
function getDesignDailyDemand(): Map<string, number> {
  if (cachedDesignDailyDemand) return cachedDesignDailyDemand;
  const demand = new Map<string, number>();
  for (const { fabId, product } of ACTIVE_PRODUCTION_PRODUCTS) {
    const cfg = getProductionConfig(fabId, product);
    if (!cfg) continue;
    const dailyWaferStarts = cfg.waferStartsPerMonth / 30;
    for (const row of materialConsumptionFor(product)) {
      demand.set(row.materialId, (demand.get(row.materialId) ?? 0) + row.equivalentPerWafer * dailyWaferStarts);
    }
  }
  cachedDesignDailyDemand = demand;
  return cachedDesignDailyDemand;
}

// 3팹이 소모하는 전체 자재 집합(발주·게이팅 대상). 자재 재고는 fab 공유이므로 합집합으로 1회만 다룬다.
function allConsumedMaterialIds(): string[] {
  const set = new Set<string>();
  for (const { product } of ACTIVE_PRODUCTION_PRODUCTS) {
    for (const row of materialConsumptionFor(product)) set.add(row.materialId);
  }
  return [...set];
}

// 자재의 대표 창고: 재고가 가장 많은 inventory 문서의 warehouseId.
async function resolveWarehouse(materialId: string): Promise<string | null> {
  const { inventory } = await collections();
  const doc = await inventory.find({ materialId }).sort({ quantity: -1 }).limit(1).next();
  return doc?.warehouseId ?? null;
}

export async function executeTwinTick(now: Date = new Date()): Promise<TwinTickResult> {
  const empty: TwinTickResult = { advanced: 0, burnedByMaterial: {}, shortfalls: {}, newPOs: 0, receipts: 0, released: 0, held: 0, blocked: 0, finishedGoodsAdded: 0, finishedGoodsAddedByProduct: {} };
  const state = await getOrInitTwinState();
  if (state.status !== "RUNNING") return { ...empty, skipped: "PAUSED" };
  // DB 상태가 수동으로 RUNNING으로 바뀌더라도 레거시 직접 쓰기는 역할 이관 전까지 봉인한다.
  if (!isRoleAutomationReady()) return { ...empty, skipped: "ROLE_GATE" };

  const owner = randomUUID();
  if (!(await acquireTwinLock(owner, LOCK_TTL_MS))) return { ...empty, skipped: "LOCKED" };

  try {
    const { inventory, materials, twinPurchaseOrders, twinBurnEvents, finishedGoods, finishedGoodsEvents } = await collections();

    // 이자재(MATERIALS)의 COVERAGE_CRITICAL 판단을 최생산(PRODUCTION) WIP 진행보다 먼저
    // 계산해야 한다 — advanceAggregateWip가 다음 스텝에 CRITICAL 자재를 쓰는 로트를
    // 배제하려면 "지금 무엇이 CRITICAL인지"를 진행 전에 알아야 한다. 자재는 3팹 공유라 합집합으로 1회.
    const gatingMaterialIds = allConsumedMaterialIds();
    const materialSignals: MaterialSignal[] = [];
    for (const materialId of gatingMaterialIds) {
      const warehouseId = await resolveWarehouse(materialId);
      if (!warehouseId) continue;
      const inv = await inventory.findOne({ materialId, warehouseId });
      const mat = await materials.findOne({ _id: materialId });
      if (!inv || !mat) continue;
      const dailyBurn = inv.avgDailyBurn ?? 0;
      materialSignals.push({
        materialId, code: mat.code, name: mat.name, unit: mat.unit,
        ropDays: mat.ropDays, quantity: inv.quantity, dailyBurn,
        coverageDays: dailyBurn > 0 ? inv.quantity / dailyBurn : null,
        state: coverageState(inv.quantity, dailyBurn, mat.ropDays),
      });
    }
    const blockedMaterialIds = criticalMaterialIds(materialSignals);

    // 박물류(LOGISTICS)의 창고 용량 판정도 WIP 진행보다 먼저 계산해야 한다 — 완제품 창고가
    // CAPACITY_OVER면 이번 tick에 완료될(=완제품이 될) 로트도 자재차단과 같은 방식으로
    // advanceAggregateWip가 막아야 한다. 원자재 입고 게이팅(③)도 같은 값을 재사용한다.
    const warehouseCapacity = await getWarehouseCapacity();
    const capacityOverWarehouseIds = new Set(
      warehouseCapacity
        .filter((wh) => warehouseVerdict({ code: wh.code, name: wh.name, utilization: wh.utilization, legalUtilization: wh.legalUtilization }) === "CAPACITY_OVER")
        .map((wh) => wh.id),
    );
    const finishedGoodsCapacityOver = capacityOverWarehouseIds.has(FINISHED_GOODS_WAREHOUSE_ID);

    // ── 제품 루프: HBM/DRAM/NAND 각각 WIP 진행 → 소모 계산 → 완제품 적립 ──
    // 자재 소모는 fab 공유 재고이므로 제품별 burn을 materialId로 합산한 뒤, 루프 밖에서 1회만 재고에 반영한다.
    const carryByProduct: Partial<Record<Product, number>> = { ...(state.releaseCarryByProduct ?? {}) };
    // 하위호환: 예전 단일 releaseCarry는 HBM 몫으로 이어받는다.
    if (carryByProduct.HBM == null && state.releaseCarry != null) carryByProduct.HBM = state.releaseCarry;

    const burnedByMaterialAgg = new Map<string, number>();
    let totalAdvanced = 0;
    let totalBlocked = 0;
    let totalReleased = 0;
    let hbmSimMsPerDay = 86_400_000;
    const finishedGoodsAddedByProduct: Partial<Record<Product, number>> = {};

    for (const { fabId, product } of ACTIVE_PRODUCTION_PRODUCTS) {
      const cfg = getProductionConfig(fabId, product);
      if (!cfg) continue;
      const { stepConsumption, totalSteps } = await getStepConsumption(fabId, product);
      if (totalSteps === 0) continue;

      // 소모는 tick당 simDays만큼 가속되는데, 리드타임을 실벽시계 day로 잡으면 재고는 초 단위로
      // 마르는데 발주는 며칠 뒤 도착해 영구 결품이 된다. 발주 리드타임도 같은 가속 sim-time으로 환산한다.
      const simDays = simDaysPerTick(cfg.cycleTimeDays, totalSteps);
      const simMsPerDay = simDays > 0 ? state.tickIntervalMs / simDays : 86_400_000;
      if (product === "HBM") hbmSimMsPerDay = simMsPerDay;

      // ① WIP 진행(자재 서킷브레이커 + 완제품 창고 게이팅) → ② 소모 → ①.5 재투입
      // HBM은 per-lot(waferLots), DRAM/NAND는 step-bucket 집계(대규모 WIP 고속 진행).
      let completedWaferQty = 0;
      if (cfg.wipMode === "PER_LOT") {
        const adv = await advanceAggregateWip(fabId, product, { stepConsumption, blockedMaterialIds, finishedGoodsCapacityOver });
        totalAdvanced += adv.advanced;
        totalBlocked += adv.blocked;
        completedWaferQty = adv.completedWaferQty;
        for (const [materialId, qty] of computeBurn(adv.advancedFromStepIndex, stepConsumption)) {
          if (qty > 0) burnedByMaterialAgg.set(materialId, (burnedByMaterialAgg.get(materialId) ?? 0) + qty);
        }
        const release = await releaseAggregateWip(fabId, product, now, simDays, carryByProduct[product] ?? 0);
        carryByProduct[product] = release.nextCarry;
        totalReleased += release.released;
      } else {
        const adv = await advanceStepBucketWip(fabId, product, { stepConsumption, blockedMaterialIds, finishedGoodsCapacityOver, wafersPerFoup: cfg.wafersPerFoup });
        totalAdvanced += adv.advancedFoup;
        totalBlocked += adv.blockedFoup;
        completedWaferQty = adv.completedWaferQty;
        for (const [materialId, qty] of adv.burnByMaterial) {
          if (qty > 0) burnedByMaterialAgg.set(materialId, (burnedByMaterialAgg.get(materialId) ?? 0) + qty);
        }
        const release = await releaseStepBucketWip(fabId, product, simDays, carryByProduct[product] ?? 0, cfg.dailyLotRelease, cfg.targetOccupiedFoup);
        carryByProduct[product] = release.nextCarry;
        totalReleased += release.released;
      }

      // ①.6 이번 tick에 완료된 웨이퍼를 완제품으로 적립. 웨이퍼 수량을 제품별 환산으로 완제품 단위 수로 바꾼다.
      // 패키징(WIP 완료)이 끝났다고 바로 판매재고가 되지 않는다 — 최종테스트(Final Test) 대기열을 거친다.
      const fgId = `${fabId}__${product}__${FINISHED_GOODS_WAREHOUSE_ID}`;
      const newlyCompletedQuantity = completedWaferQty * finishedGoodsPerWafer(product);
      const fgDoc = await finishedGoods.findOne({ _id: fgId });
      const queue = applyFinalTestQueue({
        now, simMsPerDay,
        pendingTestQuantity: fgDoc?.pendingTestQuantity ?? 0,
        pendingTestReadyAt: fgDoc?.pendingTestReadyAt ?? null,
        newlyCompletedQuantity,
      });
      finishedGoodsAddedByProduct[product] = queue.releasedQuantity;
      if (newlyCompletedQuantity > 0 || queue.releasedQuantity > 0) {
        await finishedGoods.updateOne(
          { _id: fgId },
          {
            $inc: { quantity: queue.releasedQuantity },
            $set: {
              updatedAt: now,
              pendingTestQuantity: queue.nextPendingTestQuantity,
              pendingTestReadyAt: queue.nextPendingTestReadyAt,
            },
            $setOnInsert: { fabId, product, warehouseId: FINISHED_GOODS_WAREHOUSE_ID, unit: finishedGoodsUnit(product) },
          },
          { upsert: true },
        );
        await finishedGoodsEvents.insertOne({
          _id: randomUUID(), fabId, product, tickAt: now,
          addedQty: queue.releasedQuantity, queuedQty: newlyCompletedQuantity,
        });
      }
    }

    // ── 누적 소모를 3팹 공유 재고에 1회 반영 ──
    const burnedByMaterial: Record<string, number> = {};
    const shortfalls: Record<string, number> = {};
    // 제품 루프의 simDays는 제품마다 다르므로, EMA 정규화용 대표 simDays는 HBM 기준을 쓴다(발주 리드타임과 동일 기준).
    const emaSimDays = state.tickIntervalMs / hbmSimMsPerDay;
    for (const [materialId, qty] of burnedByMaterialAgg) {
      if (qty <= 0) continue;
      const warehouseId = await resolveWarehouse(materialId);
      if (!warehouseId) continue;
      const { burned, shortfall } = await burnInventoryProjection({ materialId, warehouseId, quantity: qty });
      burnedByMaterial[materialId] = burned;
      if (shortfall > 0) shortfalls[materialId] = shortfall;

      // 실측 일일 소모율 EMA 갱신 — 설계기준 수요(3팹 합)의 3배를 상한으로 catch-up burst를 걸러낸다
      const inv = await inventory.findOne({ materialId, warehouseId });
      const observedDaily = emaSimDays > 0 ? burned / emaSimDays : burned;
      const designDaily = getDesignDailyDemand().get(materialId);
      const ceiling = designDaily != null ? designDaily * BURN_EMA_CEILING_MULTIPLIER : undefined;
      const nextEma = updateBurnEma(inv?.avgDailyBurn ?? 0, observedDaily, EMA_ALPHA, ceiling);
      await inventory.updateOne({ materialId, warehouseId }, { $set: { avgDailyBurn: nextEma } });

      await twinBurnEvents.insertOne({ _id: randomUUID(), tickAt: now, materialId, burnedQty: burned, shortfallQty: shortfall });
    }

    // ③ 입고: 전체 소모 자재에 대해 ROP 점검·발주, 도착 정산 (이번 tick에 소모되지 않은 자재도 도착 PO는 반드시 정산되어야 함)
    // 김구매(PROCUREMENT)의 자율등급 판단을 계산해 PO에 기록한다(투명성). 리드타임은 HBM 기준 simMsPerDay로 가속 환산한다.
    let newPOs = 0;
    let receipts = 0;
    let held = 0;
    const materialIds = allConsumedMaterialIds();
    const { materials: scenarioMaterials } = await loadLiveScenarioMaterials(now);
    const scenarioByMaterial = new Map(scenarioMaterials.map((m) => [m.id, m]));
    for (const materialId of materialIds) {
      const warehouseId = await resolveWarehouse(materialId);
      if (!warehouseId) continue;
      const inv = await inventory.findOne({ materialId, warehouseId });
      const mat = await materials.findOne({ _id: materialId });
      if (!inv || !mat) continue;

      const openPOs = await twinPurchaseOrders.find({ materialId, status: { $nin: ["RECEIVED", "REJECTED"] } }).toArray();
      const inTransit = openPOs.reduce((s, po) => s + po.qty, 0);
      const lastPO = await twinPurchaseOrders.findOne({ materialId }, { sort: { orderedAt: -1 } });
      const plan = planInbound({
        onHand: inv.quantity, inTransit, avgDailyBurn: inv.avgDailyBurn ?? 0, ropDays: mat.ropDays,
        recentOrderQty: lastPO?.qty,
      });
      if (plan) {
        const scenarioMat = scenarioByMaterial.get(materialId);
        const ceiling = autonomyCeiling(scenarioMat
          ? { category: scenarioMat.category, procurementAlternatives: scenarioMat.procurementAlternatives, supplyMode: scenarioMat.supplyMode }
          : { category: mat.category, procurementAlternatives: [], supplyMode: mat.supplyMode });
        const leadTimeDays = getBaseLeadTime(mat.category);
        await twinPurchaseOrders.insertOne({
          _id: randomUUID(), materialId, qty: plan.qty, orderedAt: now,
          etaAt: new Date(now.getTime() + leadTimeDays * hbmSimMsPerDay),
          leadTimeDays,
          status: "ORDERED",
          autonomyCeiling: ceiling.level,
          autonomyReason: ceiling.reason,
          destinationWarehouseId: warehouseId,
        });
        newPOs++;
      }

      const arrivals = settleArrivals(openPOs, now, capacityOverWarehouseIds);
      for (const r of arrivals.receipts) {
        await increaseInventoryProjection({ materialId: r.materialId, warehouseId, quantity: r.qty });
        receipts++;
      }
      if (arrivals.arrivedPoIds.length > 0) {
        await twinPurchaseOrders.updateMany({ _id: { $in: arrivals.arrivedPoIds } }, { $set: { status: "RECEIVED" } });
      }
      if (arrivals.heldPoIds.length > 0) {
        await twinPurchaseOrders.updateMany(
          { _id: { $in: arrivals.heldPoIds }, status: { $ne: "INBOUND_HOLD" } },
          { $set: { status: "INBOUND_HOLD", holdReason: "박물류 판정: 목적창고 CAPACITY_OVER" } },
        );
        held += arrivals.heldPoIds.length;
      }
    }

    const { twinEngineState } = await collections();
    await twinEngineState.updateOne(
      { _id: "singleton" },
      { $set: { lastTickAt: now, releaseCarry: carryByProduct.HBM ?? 0, releaseCarryByProduct: carryByProduct } },
    );

    const finishedGoodsAdded = Object.values(finishedGoodsAddedByProduct).reduce((s, v) => s + (v ?? 0), 0);
    return { advanced: totalAdvanced, burnedByMaterial, shortfalls, newPOs, receipts, released: totalReleased, held, blocked: totalBlocked, finishedGoodsAdded, finishedGoodsAddedByProduct };
  } finally {
    await releaseTwinLock(owner);
  }
}
