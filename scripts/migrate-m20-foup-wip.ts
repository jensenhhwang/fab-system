import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { collections, type LotCarrierAssignmentDoc, type ProductionCarrierDoc, type WaferLotDoc } from "../src/lib/db";
import { expandRouteMaster } from "../src/lib/route-master";
import { normalizeProcessCode } from "../src/lib/route-contract";
import {
  buildM20SteadyStateSlots,
  FOUP_WIP_BOOTSTRAP_VERSION,
  FOUP_WIP_DWELL_MODEL,
  M20_DAILY_LOT_RELEASE,
  M20_TARGET_OCCUPIED_FOUP,
  M20_TARGET_PHYSICAL_FOUP,
  M20_TARGET_RESERVE_FOUP,
  M20_WAFERS_PER_FOUP,
  M20_WATCHED_LOT_COUNT,
  modeledFoupCode,
  modeledWaferLotId,
  nextKstMidnight,
} from "../src/lib/foup-wip-model";

const apply = process.argv.includes("--apply");
const WATCHED_CODES = Array.from({ length: M20_WATCHED_LOT_COUNT }, (_, index) => `FOUP-${String(index + 1).padStart(2, "0")}`);
const BATCH_SIZE = 2_000;

function chunks<T>(items: T[], size = BATCH_SIZE): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

async function main() {
  const {
    routeMasters, waferLots, waferLotStepEvents, productionCarriers,
    lotCarrierAssignments, foupWipBootstrapManifests,
  } = await collections();
  const route = await routeMasters.findOne({ fabId: "M20", product: "HBM", isActive: true });
  if (!route || route._id !== "M20:HBM:V3") throw new Error("활성 M20:HBM:V3 Route가 필요합니다.");
  const visits = expandRouteMaster(route);
  const dicingStepIndex = visits.findIndex((visit) => visit.operationCode === "DICING");
  if (dicingStepIndex <= 0) throw new Error("P10.DICING 진입 경계를 찾을 수 없습니다.");
  const preDicingVisits = visits.slice(0, dicingStepIndex);

  const existingManifest = await foupWipBootstrapManifests.findOne({ _id: FOUP_WIP_BOOTSTRAP_VERSION });
  const bootstrapEndAt = existingManifest?.bootstrapEndAt ?? nextKstMidnight(new Date());
  const slots = buildM20SteadyStateSlots(bootstrapEndAt, preDicingVisits);
  const existingWatchedRows = await waferLots.find({
    fabId: "M20", product: "HBM", foupCode: { $in: WATCHED_CODES }, status: "IN_PROGRESS",
  }).sort({ createdAt: -1 }).toArray();
  const watchedByCode = new Map<string, WaferLotDoc>();
  for (const lot of existingWatchedRows) if (!watchedByCode.has(lot.foupCode)) watchedByCode.set(lot.foupCode, lot);
  const existingLegacyAggregate = await waferLots.countDocuments({ fabId: "M20", product: "HBM", cohort: "AGGREGATE" });
  const existingModeledLots = await waferLots.countDocuments({ fabId: "M20", product: "HBM", cohort: "MODELED_FOUP", bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION });
  const existingModeledCarriers = await productionCarriers.countDocuments({ fabId: "M20", carrierType: "FOUP", bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION });
  const existingAssignments = await lotCarrierAssignments.countDocuments({ fabId: "M20", status: "ACTIVE", bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION });
  const modeledLotTarget = M20_TARGET_OCCUPIED_FOUP - M20_WATCHED_LOT_COUNT;

  console.table([
    { item: "기존 활성 Watched", current: watchedByCode.size, target: M20_WATCHED_LOT_COUNT, add: M20_WATCHED_LOT_COUNT - watchedByCode.size },
    { item: "MODELED_FOUP Lot", current: existingModeledLots, target: modeledLotTarget, add: Math.max(0, modeledLotTarget - existingModeledLots) },
    { item: "Physical FOUP", current: existingModeledCarriers, target: M20_TARGET_PHYSICAL_FOUP, add: Math.max(0, M20_TARGET_PHYSICAL_FOUP - existingModeledCarriers) },
    { item: "Active Assignment", current: existingAssignments, target: M20_TARGET_OCCUPIED_FOUP, add: Math.max(0, M20_TARGET_OCCUPIED_FOUP - existingAssignments) },
    { item: "Legacy AGGREGATE 보존 전환", current: existingLegacyAggregate, target: 0, add: -existingLegacyAggregate },
  ]);
  console.log(`[foup-wip] mode=${apply ? "APPLY" : "DRY_RUN"} route=${route._id} preDicingVisits=${preDicingVisits.length} interval=[${new Date(bootstrapEndAt.getTime() - 90 * 86_400_000).toISOString()}, ${bootstrapEndAt.toISOString()})`);
  if (!apply) return;

  const now = new Date();
  const snapshotPath = `/private/tmp/m20-foup-wip-before-${now.toISOString().replaceAll(":", "-")}.json`;
  const legacySnapshot = await waferLots.find(
    { fabId: "M20", product: "HBM", cohort: "AGGREGATE" },
    { projection: { _id: 1, status: 1, cohort: 1, routeMasterId: 1, foupCode: 1 } },
  ).toArray();
  await writeFile(snapshotPath, JSON.stringify({ capturedAt: now.toISOString(), legacyAggregate: legacySnapshot }, null, 2), "utf8");

  await foupWipBootstrapManifests.updateOne(
    { _id: FOUP_WIP_BOOTSTRAP_VERSION },
    {
      $setOnInsert: { _id: FOUP_WIP_BOOTSTRAP_VERSION, fabId: "M20", createdAt: now },
      $set: {
        routeMasterId: route._id, status: "PREPARING", mode: "STEADY_STATE_BOOTSTRAP",
        dwellModel: FOUP_WIP_DWELL_MODEL, bootstrapEndAt, snapshotPath,
        targetCounts: { physicalFleet: M20_TARGET_PHYSICAL_FOUP, occupied: M20_TARGET_OCCUPIED_FOUP, reserve: M20_TARGET_RESERVE_FOUP, watched: M20_WATCHED_LOT_COUNT },
        updatedAt: now,
      },
    },
    { upsert: true },
  );

  try {
    await Promise.all([
      productionCarriers.createIndex({ fabId: 1, carrierType: 1, bootstrapVersion: 1, state: 1, currentProcessCode: 1 }),
      waferLots.createIndex({ fabId: 1, product: 1, cohort: 1, bootstrapVersion: 1, status: 1 }),
      lotCarrierAssignments.createIndex({ carrierId: 1 }, { unique: true, partialFilterExpression: { status: "ACTIVE" } }),
      lotCarrierAssignments.createIndex({ lotId: 1 }, { unique: true, partialFilterExpression: { status: "ACTIVE" } }),
    ]);

    await waferLots.updateMany(
      { fabId: "M20", product: "HBM", cohort: "AGGREGATE" },
      { $set: { cohort: "LEGACY_AGGREGATE", status: "DONE", updatedAt: now } },
    );

    const watchedLots: WaferLotDoc[] = [];
    for (const [index, foupCode] of WATCHED_CODES.entries()) {
      const existing = watchedByCode.get(foupCode);
      const modeledSlot = slots[slots.length - M20_WATCHED_LOT_COUNT + index];
      if (existing) {
        await waferLots.updateOne({ _id: existing._id }, { $set: {
          cohort: "WATCHED", watched: true, waferQty: M20_WAFERS_PER_FOUP,
          bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION, modeledReleaseAt: modeledSlot.releaseAt,
          source: existing.source ?? "MODELED_BASELINE", updatedAt: now,
        } });
        watchedLots.push({ ...existing, cohort: "WATCHED", watched: true, waferQty: M20_WAFERS_PER_FOUP, bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION, modeledReleaseAt: modeledSlot.releaseAt });
      } else {
        const lot: WaferLotDoc = {
          _id: `WLOT:M20:HBM:WATCHED:${foupCode}`,
          fabId: "M20", product: "HBM", routeMasterId: route._id, foupCode,
          status: "IN_PROGRESS", cohort: "WATCHED", currentStepIndex: modeledSlot.currentStepIndex,
          currentNodeId: modeledSlot.currentNodeId, lastEventAt: modeledSlot.releaseAt,
          waferQty: M20_WAFERS_PER_FOUP, watched: true, source: "MODELED_BASELINE",
          bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION, modeledReleaseAt: modeledSlot.releaseAt,
          nextTransitionAt: modeledSlot.nextTransitionAt, dwellModel: FOUP_WIP_DWELL_MODEL,
          createdBy: "FOUP_WIP_BOOTSTRAP", createdAt: now, updatedAt: now,
        };
        await waferLots.updateOne({ _id: lot._id }, { $setOnInsert: lot }, { upsert: true });
        watchedLots.push(lot);
      }
    }

    const modeledSlots = slots.slice(0, modeledLotTarget);
    const modeledLots: WaferLotDoc[] = modeledSlots.map((slot) => {
      const dailySequence = slot.slotIndex % M20_DAILY_LOT_RELEASE + 1;
      const foupCode = modeledFoupCode(slot.slotIndex + 1);
      return {
        _id: modeledWaferLotId(slot.releaseAt, dailySequence),
        fabId: "M20", product: "HBM", routeMasterId: route._id, foupCode,
        status: "IN_PROGRESS", cohort: "MODELED_FOUP", currentStepIndex: slot.currentStepIndex,
        currentNodeId: slot.currentNodeId, lastEventAt: slot.releaseAt,
        waferQty: M20_WAFERS_PER_FOUP, watched: false, source: "MODELED_BASELINE",
        bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION, modeledReleaseAt: slot.releaseAt,
        nextTransitionAt: slot.nextTransitionAt, dwellModel: FOUP_WIP_DWELL_MODEL,
        createdBy: "FOUP_WIP_BOOTSTRAP", createdAt: now, updatedAt: now,
      };
    });
    for (const batch of chunks(modeledLots)) {
      await waferLots.bulkWrite(batch.map((lot) => ({ updateOne: { filter: { _id: lot._id }, update: { $setOnInsert: lot }, upsert: true } })), { ordered: false });
    }

    const completedByLot = new Map<string, number>();
    const watchedIds = watchedLots.map((lot) => lot._id);
    const completedRows = await waferLotStepEvents.aggregate<{ _id: string; count: number }>([
      { $match: { lotId: { $in: watchedIds }, completedAt: { $exists: true } } },
      { $group: { _id: "$lotId", count: { $sum: 1 } } },
    ]).toArray();
    for (const row of completedRows) completedByLot.set(row._id, row.count);
    const routeById = new Map((await routeMasters.find({ _id: { $in: [...new Set(watchedLots.map((lot) => lot.routeMasterId))] } }).toArray()).map((doc) => [doc._id, expandRouteMaster(doc)]));
    const watchedProcess = new Map(watchedLots.map((lot) => {
      const lotVisits = routeById.get(lot.routeMasterId) ?? visits;
      const index = Math.min(lotVisits.length - 1, completedByLot.get(lot._id) ?? lot.currentStepIndex ?? 0);
      return [lot._id, normalizeProcessCode(lotVisits[index]?.processCode ?? "P01")];
    }));

    const watchedCarriers: ProductionCarrierDoc[] = watchedLots.map((lot) => ({
      _id: lot.foupCode, fabId: "M20", carrierType: "FOUP", capacity: M20_WAFERS_PER_FOUP,
      capacityUnit: "WAFER", state: "ASSIGNED_IN_PROCESS", movementStatus: "STATIONARY",
      currentProcessCode: watchedProcess.get(lot._id) ?? "P01", currentLocationId: `FAB-M20__${watchedProcess.get(lot._id) ?? "P01"}__WIP`,
      source: "MODELED_BASELINE", bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION,
      positionAccuracy: "ZONE_DERIVED", updatedAt: now,
    }));
    const modeledCarriers: ProductionCarrierDoc[] = Array.from({ length: M20_TARGET_PHYSICAL_FOUP - M20_WATCHED_LOT_COUNT }, (_, index) => {
      const sequence = index + 1;
      const lot = modeledLots[index];
      const occupied = sequence <= modeledLotTarget;
      return {
        _id: modeledFoupCode(sequence), fabId: "M20", carrierType: "FOUP", capacity: M20_WAFERS_PER_FOUP,
        capacityUnit: "WAFER", state: occupied ? "ASSIGNED_IN_PROCESS" : "AVAILABLE",
        movementStatus: "STATIONARY", currentProcessCode: occupied ? normalizeProcessCode(visits[lot.currentStepIndex ?? 0]?.processCode ?? "P01") : undefined,
        currentLocationId: occupied ? `FAB-M20__${normalizeProcessCode(visits[lot.currentStepIndex ?? 0]?.processCode ?? "P01")}__WIP` : "FAB-M20__FOUP-RESERVE",
        source: "MODELED_BASELINE", bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION,
        positionAccuracy: "ZONE_DERIVED", updatedAt: now,
      };
    });
    for (const batch of chunks([...watchedCarriers, ...modeledCarriers])) {
      await productionCarriers.bulkWrite(batch.map((carrier) => ({ updateOne: { filter: { _id: carrier._id }, update: { $setOnInsert: carrier }, upsert: true } })), { ordered: false });
    }

    const assignments: LotCarrierAssignmentDoc[] = [
      ...watchedLots.map((lot) => ({
        _id: `ASSIGN:${lot.foupCode}:${lot._id}`, fabId: "M20" as const, lotId: lot._id, carrierId: lot.foupCode,
        carrierType: "FOUP" as const, status: "ACTIVE" as const, assignedAt: lot.modeledReleaseAt ?? lot.createdAt,
        source: "MODELED_BASELINE" as const, bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION, updatedAt: now,
      })),
      ...modeledLots.map((lot) => ({
        _id: `ASSIGN:${lot.foupCode}:${lot._id}`, fabId: "M20" as const, lotId: lot._id, carrierId: lot.foupCode,
        carrierType: "FOUP" as const, status: "ACTIVE" as const, assignedAt: lot.modeledReleaseAt ?? lot.createdAt,
        source: "MODELED_BASELINE" as const, bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION, updatedAt: now,
      })),
    ];
    for (const batch of chunks(assignments)) {
      await lotCarrierAssignments.bulkWrite(batch.map((assignment) => ({ updateOne: { filter: { _id: assignment._id }, update: { $setOnInsert: assignment }, upsert: true } })), { ordered: false });
    }

    const carrierFilter = { fabId: "M20" as const, carrierType: "FOUP" as const, bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION };
    const [physicalFleet, occupied, activeLots, activeAssignments, watched, duplicateCarrier, duplicateLot] = await Promise.all([
      productionCarriers.countDocuments(carrierFilter),
      productionCarriers.countDocuments({ ...carrierFilter, state: "ASSIGNED_IN_PROCESS" }),
      waferLots.countDocuments({ fabId: "M20", product: "HBM", status: "IN_PROGRESS", cohort: { $in: ["WATCHED", "MODELED_FOUP"] }, bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION }),
      lotCarrierAssignments.countDocuments({ fabId: "M20", status: "ACTIVE", bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION }),
      waferLots.countDocuments({ fabId: "M20", product: "HBM", status: "IN_PROGRESS", watched: true, bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION }),
      lotCarrierAssignments.aggregate([{ $match: { fabId: "M20", status: "ACTIVE" } }, { $group: { _id: "$carrierId", count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }, { $limit: 1 }]).hasNext(),
      lotCarrierAssignments.aggregate([{ $match: { fabId: "M20", status: "ACTIVE" } }, { $group: { _id: "$lotId", count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }, { $limit: 1 }]).hasNext(),
    ]);
    const reserve = physicalFleet - occupied;
    if (physicalFleet !== M20_TARGET_PHYSICAL_FOUP || occupied !== M20_TARGET_OCCUPIED_FOUP || reserve !== M20_TARGET_RESERVE_FOUP
      || activeLots !== M20_TARGET_OCCUPIED_FOUP || activeAssignments !== M20_TARGET_OCCUPIED_FOUP || watched !== M20_WATCHED_LOT_COUNT
      || duplicateCarrier || duplicateLot) {
      throw new Error(`검증 실패: fleet=${physicalFleet}, occupied=${occupied}, reserve=${reserve}, lots=${activeLots}, assignments=${activeAssignments}, watched=${watched}, duplicateCarrier=${duplicateCarrier}, duplicateLot=${duplicateLot}`);
    }
    const actualCounts = { physicalFleet, occupied, reserve, watched, activeLots, activeAssignments };
    await foupWipBootstrapManifests.updateOne({ _id: FOUP_WIP_BOOTSTRAP_VERSION }, { $set: { status: "ACTIVE", actualCounts, updatedAt: new Date() }, $unset: { error: "" } });
    console.log(`✅ M20 FOUP WIP bootstrap ACTIVE: fleet=${physicalFleet}, occupied=${occupied}, reserve=${reserve}, watched=${watched}, assignments=${activeAssignments}`);
    console.log(`snapshot=${snapshotPath}`);
  } catch (error) {
    await foupWipBootstrapManifests.updateOne({ _id: FOUP_WIP_BOOTSTRAP_VERSION }, { $set: { status: "FAILED", error: error instanceof Error ? error.message : String(error), updatedAt: new Date() } });
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
