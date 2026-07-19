import { collections } from "@/lib/db";
import {
  FOUP_WIP_BOOTSTRAP_VERSION,
  M20_DAILY_LOT_RELEASE,
  M20_DOWNSTREAM_WIP_EQUIVALENT,
  M20_END_TO_END_WIP_EQUIVALENT,
  M20_TARGET_OCCUPIED_FOUP,
  M20_TARGET_PHYSICAL_FOUP,
  M20_TARGET_RESERVE_FOUP,
  M20_WATCHED_LOT_COUNT,
  type FoupFleetProjection,
} from "@/lib/foup-wip-model";

export async function getM20FoupFleetProjection(): Promise<FoupFleetProjection> {
  const { productionCarriers, lotCarrierAssignments, waferLots, foupWipBootstrapManifests } = await collections();
  const carrierFilter = { fabId: "M20" as const, carrierType: "FOUP" as const, bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION };
  const [manifest, physicalFleet, occupied, activeLots, activeAssignments, watched, zoneRows, stateRows] = await Promise.all([
    foupWipBootstrapManifests.findOne({ _id: FOUP_WIP_BOOTSTRAP_VERSION }),
    productionCarriers.countDocuments(carrierFilter),
    productionCarriers.countDocuments({ ...carrierFilter, state: "ASSIGNED_IN_PROCESS" }),
    waferLots.countDocuments({
      fabId: "M20", product: "HBM", status: "IN_PROGRESS",
      cohort: { $in: ["WATCHED", "MODELED_FOUP"] },
      bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION,
    }),
    lotCarrierAssignments.countDocuments({ fabId: "M20", status: "ACTIVE", bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION }),
    waferLots.countDocuments({
      fabId: "M20", product: "HBM", status: "IN_PROGRESS", watched: true,
      bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION,
    }),
    productionCarriers.aggregate<{ _id: string; count: number }>([
      { $match: { ...carrierFilter, state: "ASSIGNED_IN_PROCESS" } },
      { $group: { _id: { $ifNull: ["$currentProcessCode", "UNKNOWN"] }, count: { $sum: 1 } } },
    ]).toArray(),
    productionCarriers.aggregate<{ _id: string; count: number }>([
      { $match: { ...carrierFilter, state: { $ne: "ASSIGNED_IN_PROCESS" } } },
      { $group: { _id: "$state", count: { $sum: 1 } } },
    ]).toArray(),
  ]);

  return {
    bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION,
    manifestStatus: manifest?.status ?? "NOT_APPLIED",
    source: "MODELED_BASELINE",
    accuracy: { count: "LEDGER_EXACT", position: "ZONE_DERIVED", visualization: "WATCHED_LIVE_ONLY" },
    target: {
      physicalFleet: M20_TARGET_PHYSICAL_FOUP,
      occupied: M20_TARGET_OCCUPIED_FOUP,
      reserve: M20_TARGET_RESERVE_FOUP,
      watched: M20_WATCHED_LOT_COUNT,
      dailyRelease: M20_DAILY_LOT_RELEASE,
      downstreamWipEquivalent: M20_DOWNSTREAM_WIP_EQUIVALENT,
      endToEndWipEquivalent: M20_END_TO_END_WIP_EQUIVALENT,
    },
    actual: {
      physicalFleet,
      occupied,
      reserve: physicalFleet - occupied,
      watched,
      activeLots,
      activeAssignments,
    },
    zoneCounts: Object.fromEntries(zoneRows.map((row) => [row._id, row.count])),
    reserveStateCounts: Object.fromEntries(stateRows.map((row) => [row._id, row.count])),
    downstreamStatus: "NOT_BOOTSTRAPPED",
  };
}
