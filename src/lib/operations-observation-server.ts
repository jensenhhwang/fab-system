import { buildContractLines, operatingMonthRange } from "@/lib/customer-contracts";
import { collections } from "@/lib/db";
import { ACTIVE_PRODUCTION_PRODUCTS, getProductionConfig } from "@/lib/fab-production-config";
import { finishedGoodsWarehouseIds } from "@/lib/finished-goods";
import { warehouseVerdict } from "@/lib/logistics-agent";
import { materialConsumptionFor } from "@/lib/material-consumption";
import { coverageState } from "@/lib/materials-agent";
import type { OperationObservationInput } from "@/lib/operations-monitor";
import { getWarehouseCapacity } from "@/lib/queries";
import { expandRouteMaster, getRouteMaster } from "@/lib/route-master";
import { buildStepConsumption } from "@/lib/twin/burn";
import { lifeSignOf } from "@/lib/twin/tick-diagnosis";
import { operatingDaysToMs } from "@/lib/twin/operating-clock";

const EMA_STARVATION_RATIO = 0.5;

function uniqueGaps(gaps: OperationObservationInput["dataGaps"]) {
  const seen = new Set<string>();
  return gaps.filter((gap) => {
    const key = `${gap.source}:${gap.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function buildOperationObservation(
  now = new Date(),
): Promise<OperationObservationInput> {
  const {
    twinEngineState,
    twinPurchaseOrders,
    inventory,
    materials,
    finishedGoodsEvents,
    waferLots,
    finishedGoods,
    customers,
    shipments,
  } = await collections();

  const consumedIds = new Set<string>();
  const designDaily = new Map<string, number>();
  for (const { fabId, product } of ACTIVE_PRODUCTION_PRODUCTS) {
    const cfg = getProductionConfig(fabId, product);
    if (!cfg) continue;
    const dailyWaferStarts = cfg.waferStartsPerMonth / 30;
    for (const row of materialConsumptionFor(product)) {
      consumedIds.add(row.materialId);
      designDaily.set(
        row.materialId,
        (designDaily.get(row.materialId) ?? 0) + row.equivalentPerWafer * dailyWaferStarts,
      );
    }
  }
  const materialIds = [...consumedIds];

  const [
    state,
    lastOutput,
    inventoryDocs,
    materialDocs,
    openOrders,
    blockedLotGroups,
    finishedGoodsHeldLots,
    warehouseCapacity,
    finishedGoodsDocs,
    customerDocs,
  ] = await Promise.all([
    twinEngineState.findOne({ _id: "singleton" }),
    finishedGoodsEvents.find({ addedQty: { $gt: 0 } }).sort({ tickAt: -1 }).limit(1).next(),
    inventory.find({ materialId: { $in: materialIds } }).toArray(),
    materials.find({ _id: { $in: materialIds } }).toArray(),
    twinPurchaseOrders.find({ status: { $nin: ["RECEIVED", "REJECTED"] } }).toArray(),
    waferLots.aggregate<{
      _id: { routeMasterId: string; currentStepIndex: number };
      lotCount: number;
    }>([
      { $match: { materialBlockedAt: { $exists: true }, currentStepIndex: { $type: "number" } } },
      { $group: { _id: { routeMasterId: "$routeMasterId", currentStepIndex: "$currentStepIndex" }, lotCount: { $sum: 1 } } },
    ]).toArray(),
    waferLots.countDocuments({ finishedGoodsHoldAt: { $exists: true } }),
    getWarehouseCapacity(),
    finishedGoods.find({}).toArray(),
    customers.find({}).toArray(),
  ]);
  if (!state) throw new Error("TWIN_STATE_MISSING");

  const operatingEpochMs = state.operatingEpochMs ?? 0;
  const gaps: OperationObservationInput["dataGaps"] = [];
  if (state.operatingEpochMs == null) gaps.push({ source: "twinEngineState", field: "operatingEpochMs" });

  const invByMaterial = new Map<string, { quantity: number; avgDailyBurn: number }>();
  for (const doc of inventoryDocs) {
    const current = invByMaterial.get(doc.materialId) ?? { quantity: 0, avgDailyBurn: 0 };
    current.quantity += Math.max(0, doc.quantity);
    current.avgDailyBurn = Math.max(current.avgDailyBurn, doc.avgDailyBurn ?? 0);
    invByMaterial.set(doc.materialId, current);
  }
  const materialById = new Map(materialDocs.map((doc) => [doc._id, doc]));

  const materialSignals: OperationObservationInput["materials"] = [];
  const starvedMaterials: OperationObservationInput["starvedMaterials"] = [];
  for (const materialId of materialIds) {
    const mat = materialById.get(materialId);
    const inv = invByMaterial.get(materialId);
    if (!mat) {
      gaps.push({ source: `materials.${materialId}`, field: "master" });
      continue;
    }
    if (!inv) {
      gaps.push({ source: `inventory.${materialId}`, field: "quantity" });
      continue;
    }
    const coverageDays = inv.avgDailyBurn > 0 ? inv.quantity / inv.avgDailyBurn : null;
    const stateValue = coverageState(inv.quantity, inv.avgDailyBurn, mat.ropDays);
    materialSignals.push({
      materialId,
      code: mat.code,
      state: stateValue,
      onHand: inv.quantity,
      coverageDays,
      blockedLots: 0,
    });

    const design = designDaily.get(materialId) ?? 0;
    if (design > 0 && inv.avgDailyBurn < design * EMA_STARVATION_RATIO) {
      starvedMaterials.push({
        materialId,
        code: mat.code,
        avgDailyBurn: inv.avgDailyBurn,
        designDaily: design,
      });
    }
  }

  const criticalIds = new Set(
    materialSignals
      .filter((signal) => signal.state === "STOCKOUT" || signal.state === "CRITICAL")
      .map((signal) => signal.materialId),
  );
  const stepConsumptionByRoute = new Map<string, ReturnType<typeof buildStepConsumption>>();
  await Promise.all(ACTIVE_PRODUCTION_PRODUCTS.map(async ({ fabId, product }) => {
    const route = await getRouteMaster(fabId, product);
    if (!route) return;
    stepConsumptionByRoute.set(
      route._id,
      buildStepConsumption(expandRouteMaster(route), [...materialConsumptionFor(product)]),
    );
  }));
  const blockedLotsByMaterial = new Map<string, number>();
  for (const group of blockedLotGroups) {
    const consumers = stepConsumptionByRoute.get(group._id.routeMasterId)?.get(group._id.currentStepIndex) ?? [];
    for (const consumer of consumers) {
      if (!criticalIds.has(consumer.materialId)) continue;
      blockedLotsByMaterial.set(
        consumer.materialId,
        (blockedLotsByMaterial.get(consumer.materialId) ?? 0) + group.lotCount,
      );
    }
  }
  for (const signal of materialSignals) {
    signal.blockedLots = blockedLotsByMaterial.get(signal.materialId) ?? 0;
  }
  const materialBlockedLots = blockedLotGroups.reduce((sum, group) => sum + group.lotCount, 0);

  const pendingOrders = openOrders.filter((order) => order.status === "PENDING_APPROVAL");
  const oldestPendingApprovalMinutes = pendingOrders.length > 0
    ? Math.max(...pendingOrders.map((order) => (now.getTime() - order.orderedAt.getTime()) / 60_000))
    : 0;
  for (const order of openOrders) {
    if (order.etaOperatingMs == null) gaps.push({ source: `twinPurchaseOrders.${order._id}`, field: "etaOperatingMs" });
  }

  const fgWarehouseIds = new Set(finishedGoodsWarehouseIds());
  const warehouseSignals: OperationObservationInput["warehouses"] = warehouseCapacity.map((warehouse) => {
    const verdict = warehouseVerdict({
      code: warehouse.code,
      name: warehouse.name,
      utilization: warehouse.utilization,
      legalUtilization: warehouse.legalUtilization,
      capacityMode: warehouse.capacityMode,
    });
    return {
      warehouseId: warehouse.id,
      utilization: Math.max(warehouse.utilization, warehouse.legalUtilization ?? 0),
      verdict: verdict === "CAPACITY_OVER"
        ? "CAPACITY_OVER" as const
        : verdict === "CAPACITY_WATCH" ? "WATCH" as const : "NORMAL" as const,
      isFinishedGoods: fgWarehouseIds.has(warehouse.id),
    };
  });

  const { startMs: operatingMonthStartMs, endMs: operatingMonthEndMs } = operatingMonthRange(operatingEpochMs);
  const elapsedOperatingDays = Math.max(
    0,
    Math.min(30, (operatingEpochMs - operatingMonthStartMs) / operatingDaysToMs(1)),
  );
  const contractLines = buildContractLines(customerDocs);
  const currentShipments = await shipments.find({
    shippedOperatingMs: { $gte: operatingMonthStartMs, $lt: operatingMonthEndMs },
  }).toArray();
  const latestShipmentDocs = await Promise.all(
    ACTIVE_PRODUCTION_PRODUCTS.map(({ product }) => (
      shipments.find({ product }).sort({ shippedAt: -1 }).limit(1).next()
    )),
  );
  const quantityByProduct = new Map<string, number>();
  for (const doc of finishedGoodsDocs) {
    quantityByProduct.set(doc.product, (quantityByProduct.get(doc.product) ?? 0) + doc.quantity);
  }
  const shipmentSignals: OperationObservationInput["shipments"] = ACTIVE_PRODUCTION_PRODUCTS.map(
    ({ product }, index) => {
      const committedLines = contractLines.filter((line) => (
        line.product === product && line.contractType !== "SPOT"
      ));
      const committedKeys = new Set(committedLines.map((line) => `${line.customerId}:${line.product}`));
      const shipped = currentShipments
        .filter((doc) => committedKeys.has(`${doc.customerId}:${doc.product}`))
        .reduce((sum, doc) => sum + doc.quantity, 0);
      const dueToDate = committedLines.reduce(
        (sum, line) => sum + (line.contractedMonthlyQty / 30) * elapsedOperatingDays,
        0,
      );
      const latest = latestShipmentDocs[index];
      return {
        product,
        availableQuantity: quantityByProduct.get(product) ?? 0,
        dueRemainingQty: Math.max(0, dueToDate - shipped),
        minutesSinceLastShipment: latest
          ? Math.max(0, (now.getTime() - latest.shippedAt.getTime()) / 60_000)
          : null,
      };
    },
  );

  const lifeSign = lifeSignOf(now, lastOutput?.tickAt ?? null);
  const secondsSinceTick = Math.max(0, Math.floor((now.getTime() - state.lastTickAt.getTime()) / 1_000));
  const tickInProgress = Boolean(
    state.lockedBy
    && state.lockExpiresAt
    && state.lockExpiresAt.getTime() > now.getTime(),
  );

  return {
    recordedAt: now,
    operatingEpochMs,
    engine: {
      status: state.status,
      secondsSinceTick,
      tickInProgress,
      lifeSign: state.status === "PAUSED" ? "STOPPED" : lifeSign.level,
      minutesSinceOutput: lifeSign.minutesSinceOutput,
    },
    materials: materialSignals,
    procurement: {
      pendingApproval: pendingOrders.length,
      oldestPendingApprovalMinutes,
      pendingOrders: pendingOrders.map((order) => ({
        poId: order._id,
        materialId: order.materialId,
        waitingMinutes: Math.max(0, (now.getTime() - order.orderedAt.getTime()) / 60_000),
      })),
      openOrders: openOrders.map((order) => ({
        poId: order._id,
        materialId: order.materialId,
        etaOperatingMs: order.etaOperatingMs ?? null,
      })),
    },
    inbound: {
      held: openOrders
        .filter((order) => order.status === "INBOUND_HOLD")
        .map((order) => ({ poId: order._id, materialId: order.materialId, reason: order.holdReason ?? null })),
    },
    production: { materialBlockedLots, finishedGoodsHeldLots },
    warehouses: warehouseSignals,
    shipments: shipmentSignals,
    starvedMaterials,
    dataGaps: uniqueGaps(gaps),
  };
}
