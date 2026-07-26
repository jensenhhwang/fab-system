import "dotenv/config";
import { randomUUID } from "crypto";
import {
  collections,
  getDb,
  getMongoClient,
  type InventoryDoc,
  type MaterialDoc,
  type MaterialSupplierDoc,
  type SupplyMode,
  type WarehouseDoc,
} from "../src/lib/db";
import { materialFactor } from "../src/lib/capacity";
import { getMaterialDailyUsage } from "../src/lib/queries";
import {
  OPERATIONAL_INVENTORY_BASELINE_VERSION,
  MODELED_WAREHOUSE_CAPACITY_BASELINE,
  calculateOperationalOpeningTarget,
  operationalInventoryProfile,
} from "../src/lib/inventory-realism";
import { currentLeadTime } from "../src/lib/procurement";
import { getCanonicalFacility, getSupplyProfile } from "../src/lib/warehouse-storage-rules";

type Proposal = {
  material: MaterialDoc;
  supplyMode: SupplyMode;
  facilityId: string;
  currentRows: InventoryDoc[];
  currentQuantity: number;
  targetQuantity: number;
  delta: number;
  dailyUsage: number;
  protectedDays: number;
  projectedDoh: number | null;
  inventoryUnit: string;
  purchaseUnit?: string;
  purchaseToInventoryFactor?: number;
  inventoryToStorageFactor?: number;
  duplicateRows: number;
};

type RealismAuditDoc = {
  _id: string;
  version: typeof OPERATIONAL_INVENTORY_BASELINE_VERSION;
  status: "APPLIED" | "ROLLED_BACK";
  beforeMaterials: MaterialDoc[];
  beforeInventory: InventoryDoc[];
  beforeWarehouses: WarehouseDoc[];
  materialIds: string[];
  summary: {
    materialCount: number;
    inventoryRowsBefore: number;
    inventoryRowsAfter: number;
    duplicateRowsRemoved: number;
    totalDelta: number;
  };
  createdAt: Date;
  rolledBackAt?: Date;
};

const apply = process.argv.includes("--apply");
const rollbackIndex = process.argv.findIndex((argument) => argument === "--rollback");
const rollbackBatchId = rollbackIndex >= 0 ? process.argv[rollbackIndex + 1] : null;

function approvedLeadTime(
  links: MaterialSupplierDoc[],
  materialId: string,
  now: Date,
): number {
  const candidates = links
    .filter((link) => link.materialId === materialId && link.qualificationStatus !== "SUSPENDED")
    .sort((left, right) => {
      const leftRank = left.sourcingRole === "PRIMARY" || left.isPrimary ? 0 : 1;
      const rightRank = right.sourcingRole === "PRIMARY" || right.isPrimary ? 0 : 1;
      return leftRank - rightRank;
    });
  const selected = candidates[0];
  return selected ? currentLeadTime(selected, now).days ?? selected.leadTimeDays ?? 0 : 0;
}

async function buildProposals(now: Date): Promise<{
  proposals: Proposal[];
}> {
  const dbCollections = await collections();
  const [materials, inventoryRows, links, usage] = await Promise.all([
    dbCollections.materials.find({}).sort({ code: 1 }).toArray(),
    dbCollections.inventory.find({}).toArray(),
    dbCollections.materialSuppliers.find({}).toArray(),
    getMaterialDailyUsage(),
  ]);
  const proposals = materials.map((material): Proposal => {
    const supplyMode = material.supplyMode ?? getSupplyProfile(material.code).mode;
    const profile = operationalInventoryProfile({
      materialCode: material.code,
      currentUnit: material.unit,
      supplyMode,
    });
    const currentRows = inventoryRows.filter((row) => row.materialId === material._id);
    const currentQuantity = currentRows.reduce((sum, row) => sum + row.quantity, 0);
    const dailyUsage = usage.get(material._id)?.daily ?? 0;
    const target = calculateOperationalOpeningTarget({
      currentQuantity,
      safetyStock: material.safetyStock,
      dailyUsage,
      ropDays: material.ropDays,
      leadTimeDays: approvedLeadTime(links, material._id, now),
      supplyMode,
    });
    return {
      material,
      supplyMode,
      facilityId: getCanonicalFacility(material.code),
      currentRows,
      currentQuantity,
      targetQuantity: target.targetQuantity,
      delta: target.delta,
      dailyUsage,
      protectedDays: target.protectedDays,
      projectedDoh: target.projectedDoh,
      inventoryUnit: profile.inventoryUnit,
      purchaseUnit: profile.purchaseUnit,
      purchaseToInventoryFactor: profile.purchaseToInventoryFactor,
      inventoryToStorageFactor: profile.inventoryToStorageFactor,
      duplicateRows: Math.max(0, currentRows.length - 1),
    };
  });
  return { proposals };
}

async function projectedCapacity(proposals: Proposal[]): Promise<Array<{
  facilityId: string;
  mode: string;
  occupancy: number;
  limit: number;
  currentLimit: number;
  utilization: number;
  allowed: boolean;
}>> {
  const { warehouses } = await collections();
  const warehouseDocs = await warehouses.find({}).toArray();
  return warehouseDocs.map((warehouse) => {
    const rows = proposals.filter((proposal) => proposal.facilityId === warehouse._id);
    const mode = warehouse.capacityMode ?? "SPACE";
    let occupancy = 0;
    if (mode === "TANK_LEVEL") {
      const activeRows = rows.filter((row) => row.targetQuantity > 0);
      occupancy = activeRows.length ? 68 : 0;
    } else if (mode === "CONTINUOUS") {
      occupancy = 100;
    } else {
      for (const row of rows) {
        const prospectiveMaterial = {
          ...row.material,
          unit: row.inventoryUnit,
          inventoryToStorageFactor: row.inventoryToStorageFactor,
        };
        const factor = warehouse.type === "MRO"
          ? 1
          : ["HAZMAT", "PRECURSOR"].includes(warehouse.type)
            ? row.inventoryToStorageFactor ?? 1
            : materialFactor(prospectiveMaterial);
        occupancy += row.targetQuantity * factor;
      }
    }
    const modeledCapacity = MODELED_WAREHOUSE_CAPACITY_BASELINE[warehouse._id] ?? warehouse.totalCapacity;
    const limit = warehouse.legalLimit ?? modeledCapacity;
    return {
      facilityId: warehouse._id,
      mode,
      occupancy,
      limit,
      currentLimit: warehouse.legalLimit ?? warehouse.totalCapacity,
      utilization: limit > 0 ? occupancy / limit * 100 : 0,
      allowed: mode === "CONTINUOUS" || occupancy <= limit,
    };
  });
}

async function rollback(batchId: string): Promise<void> {
  const db = await getDb();
  const audits = db.collection<RealismAuditDoc>("inventoryRealismAudits");
  const audit = await audits.findOne({ _id: batchId, status: "APPLIED" });
  if (!audit) throw new Error(`복구 가능한 현실화 배치를 찾을 수 없습니다: ${batchId}`);
  const { materials, inventory, inventoryMovements, warehouses } = await collections();
  const client = await getMongoClient();
  const session = client.startSession();
  const now = new Date();
  try {
    await session.withTransaction(async () => {
      for (const material of audit.beforeMaterials) {
        await materials.replaceOne({ _id: material._id }, material, { upsert: true, session });
      }
      for (const warehouse of audit.beforeWarehouses) {
        await warehouses.replaceOne({ _id: warehouse._id }, warehouse, { upsert: true, session });
      }
      await inventory.deleteMany({ materialId: { $in: audit.materialIds } }, { session });
      if (audit.beforeInventory.length) await inventory.insertMany(audit.beforeInventory, { session });
      const movements = await inventoryMovements.find({
        requestId: { $regex: `^${batchId}:` },
        type: "ADJUSTMENT",
      }, { session }).toArray();
      for (const movement of movements) {
        await inventoryMovements.insertOne({
          _id: `ROLLBACK-${movement._id}`,
          materialId: movement.materialId,
          type: "ADJUSTMENT",
          quantity: -movement.quantity,
          reason: `운영재고 현실화 복구 · ${batchId}`,
          requestId: `ROLLBACK-${movement.requestId}`,
          userId: "SYSTEM_REALISM",
          createdAt: now,
        }, { session });
      }
      await audits.updateOne(
        { _id: batchId, status: "APPLIED" },
        { $set: { status: "ROLLED_BACK", rolledBackAt: now } },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
  console.log(`[inventory-realism] rolledBack=${batchId}`);
}

async function main(): Promise<void> {
  if (rollbackBatchId) return rollback(rollbackBatchId);
  const now = new Date();
  const { proposals } = await buildProposals(now);
  const capacities = await projectedCapacity(proposals);
  const duplicateRowsRemoved = proposals.reduce((sum, proposal) => sum + proposal.duplicateRows, 0);
  const totalDelta = proposals.reduce((sum, proposal) => sum + proposal.delta, 0);
  console.log(
    `[inventory-realism] mode=${apply ? "APPLY" : "DRY_RUN"} version=${OPERATIONAL_INVENTORY_BASELINE_VERSION}`
    + ` materials=${proposals.length} duplicateRows=${duplicateRowsRemoved} totalDelta=${Math.round(totalDelta)}`,
  );
  for (const capacity of capacities) {
    console.log(
      `[capacity] ${capacity.facilityId}\tmode=${capacity.mode}\toccupancy=${capacity.occupancy.toFixed(1)}`
      + `\tlimit=${capacity.currentLimit}->${capacity.limit}\tutil=${capacity.utilization.toFixed(1)}%`
      + `\t${capacity.allowed ? "OK" : "BLOCKED"}`,
    );
  }
  for (const proposal of proposals.filter((item) => (
    item.delta > 0
    || item.duplicateRows > 0
    || item.material.unit !== item.inventoryUnit
    || item.currentRows[0]?.warehouseId !== item.facilityId
  ))) {
    console.log(
      `${proposal.material.code}\t${proposal.material.unit}->${proposal.inventoryUnit}`
      + `\t${proposal.currentRows.map((row) => row.warehouseId).join("+") || "MISSING"}->${proposal.facilityId}`
      + `\tcurrent=${proposal.currentQuantity.toFixed(2)}\ttarget=${proposal.targetQuantity}`
      + `\tdelta=${proposal.delta.toFixed(2)}\tDOH=${proposal.projectedDoh?.toFixed(1) ?? "N/A"}`
      + `\trows=${proposal.currentRows.length}`,
    );
  }
  const blocked = capacities.filter((capacity) => !capacity.allowed);
  if (blocked.length) {
    throw new Error(`CAPACITY_BLOCKED:${blocked.map((capacity) => capacity.facilityId).join(",")}`);
  }
  if (!apply) {
    console.log("변경 없음. 실제 적용: npm run db:realize-operational-inventory -- --apply");
    return;
  }

  const batchId = `REALISM-${now.toISOString()}-${randomUUID().slice(0, 6)}`;
  const { materials, inventory, inventoryMovements, warehouses } = await collections();
  const db = await getDb();
  const audits = db.collection<RealismAuditDoc>("inventoryRealismAudits");
  const beforeMaterials = proposals.map((proposal) => proposal.material);
  const beforeInventory = proposals.flatMap((proposal) => proposal.currentRows);
  const beforeWarehouses = await warehouses.find({
    _id: { $in: Object.keys(MODELED_WAREHOUSE_CAPACITY_BASELINE) },
  }).toArray();
  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await audits.insertOne({
        _id: batchId,
        version: OPERATIONAL_INVENTORY_BASELINE_VERSION,
        status: "APPLIED",
        beforeMaterials,
        beforeInventory,
        beforeWarehouses,
        materialIds: proposals.map((proposal) => proposal.material._id),
        summary: {
          materialCount: proposals.length,
          inventoryRowsBefore: beforeInventory.length,
          inventoryRowsAfter: proposals.length,
          duplicateRowsRemoved,
          totalDelta,
        },
        createdAt: now,
      }, { session });
      for (const [warehouseId, totalCapacity] of Object.entries(MODELED_WAREHOUSE_CAPACITY_BASELINE)) {
        await warehouses.updateOne(
          { _id: warehouseId },
          {
            $set: {
              totalCapacity,
              notes: `${OPERATIONAL_INVENTORY_BASELINE_VERSION} 계획 기준 capacity. 실측 시설 마스터로 교체 필요`,
            },
          },
          { session },
        );
      }
      for (const proposal of proposals) {
        await materials.updateOne(
          { _id: proposal.material._id },
          {
            $set: {
              unit: proposal.inventoryUnit,
              supplyMode: proposal.supplyMode,
              inventoryBaselineVersion: OPERATIONAL_INVENTORY_BASELINE_VERSION,
              ...(proposal.purchaseUnit ? { purchaseUnit: proposal.purchaseUnit } : {}),
              ...(proposal.purchaseToInventoryFactor != null
                ? { purchaseToInventoryFactor: proposal.purchaseToInventoryFactor }
                : {}),
              ...(proposal.inventoryToStorageFactor != null
                ? { inventoryToStorageFactor: proposal.inventoryToStorageFactor }
                : {}),
            },
            ...(proposal.inventoryToStorageFactor == null ? { $unset: { inventoryToStorageFactor: "" } } : {}),
          },
          { session },
        );
        await inventory.deleteMany({ materialId: proposal.material._id }, { session });
        await inventory.insertOne({
          _id: `${proposal.material._id}__${proposal.facilityId}`,
          materialId: proposal.material._id,
          warehouseId: proposal.facilityId,
          quantity: proposal.targetQuantity,
          avgDailyUsage: proposal.dailyUsage,
          status: "AVAILABLE",
          ...(proposal.supplyMode === "BULK_GAS" || proposal.supplyMode === "BULK_CHEMICAL"
            ? { capacityLimit: Math.ceil(proposal.targetQuantity / 0.68) }
            : {}),
          updatedAt: now,
        }, { session });
        if (proposal.delta !== 0) {
          await inventoryMovements.insertOne({
            _id: `${batchId}:${proposal.material._id}`,
            materialId: proposal.material._id,
            type: "ADJUSTMENT",
            quantity: proposal.delta,
            reason: `운영재고 현실화 · ${OPERATIONAL_INVENTORY_BASELINE_VERSION}`,
            requestId: `${batchId}:${proposal.material._id}`,
            userId: "SYSTEM_REALISM",
            createdAt: now,
          }, { session });
        }
      }
    });
  } finally {
    await session.endSession();
  }
  console.log(`[inventory-realism] applied=${proposals.length} batch=${batchId}`);
  console.log(`rollback: npm run db:realize-operational-inventory -- --rollback ${batchId}`);
}

async function closeMongoClient(): Promise<void> {
  try {
    const client = await getMongoClient();
    await client.close();
  } catch {
    // 연결 전 실패한 경우에는 닫을 클라이언트가 없다.
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeMongoClient);
