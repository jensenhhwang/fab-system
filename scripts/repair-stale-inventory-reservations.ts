import "dotenv/config";
import { randomUUID } from "node:crypto";
import { getDb, getMongoClient, type HandlingUnitDoc, type InventoryLotDoc } from "../src/lib/db";

type ReservationRepairAudit = {
  _id: string;
  status: "APPLIED" | "ROLLED_BACK";
  createdAt: Date;
  rolledBackAt?: Date;
  beforeHandlingUnits: HandlingUnitDoc[];
  beforeLots: InventoryLotDoc[];
};

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const rollbackIndex = args.indexOf("--rollback");
const rollbackBatchId = rollbackIndex >= 0 ? args[rollbackIndex + 1] : undefined;

async function findCandidates() {
  const db = await getDb();
  const handlingUnits = db.collection<HandlingUnitDoc>("handlingUnits");
  const inventoryLots = db.collection<InventoryLotDoc>("inventoryLots");
  const reserved = await handlingUnits.find({
    logisticsStatus: { $in: ["RESERVED", "STAGED"] },
  }).toArray();
  const candidates: Array<{ unit: HandlingUnitDoc; lot: InventoryLotDoc }> = [];
  const blocked: string[] = [];
  for (const unit of reserved) {
    if (!unit.reservedTransferOrderId || !unit.reservedWorkOrderId) {
      blocked.push(`${unit._id}: 예약 참조 ID 일부가 없음`);
      continue;
    }
    const [transfer, workOrder, lot] = await Promise.all([
      db.collection<{ _id: string }>("transferOrders").findOne({ _id: unit.reservedTransferOrderId }),
      db.collection<{ _id: string }>("workOrders").findOne({ _id: unit.reservedWorkOrderId }),
      inventoryLots.findOne({ _id: unit.inventoryLotId }),
    ]);
    if (transfer || workOrder) continue;
    if (!lot || lot.qualityStatus === "CONSUMED") {
      blocked.push(`${unit._id}: 활성 Lot을 찾을 수 없음`);
      continue;
    }
    if (lot.availableQuantity + unit.quantity > lot.quantity + 1e-6) {
      blocked.push(`${unit._id}: 예약 해제 시 Lot 총량 초과`);
      continue;
    }
    candidates.push({ unit, lot });
  }
  return { candidates, blocked };
}

async function rollback(batchId: string): Promise<void> {
  const db = await getDb();
  const audits = db.collection<ReservationRepairAudit>("inventoryReservationRepairAudits");
  const audit = await audits.findOne({ _id: batchId });
  if (!audit) throw new Error(`RESERVATION_REPAIR_BATCH_NOT_FOUND:${batchId}`);
  if (audit.status !== "APPLIED") throw new Error(`RESERVATION_REPAIR_BATCH_NOT_APPLIED:${audit.status}`);
  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      for (const before of audit.beforeHandlingUnits) {
        await db.collection<HandlingUnitDoc>("handlingUnits").replaceOne({ _id: before._id }, before, { session });
      }
      for (const before of audit.beforeLots) {
        await db.collection<InventoryLotDoc>("inventoryLots").replaceOne({ _id: before._id }, before, { session });
      }
      await audits.updateOne(
        { _id: batchId, status: "APPLIED" },
        { $set: { status: "ROLLED_BACK", rolledBackAt: new Date() } },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
  console.log(`[reservation-repair] rolledBack batch=${batchId}`);
}

async function main(): Promise<void> {
  if (rollbackIndex >= 0) {
    if (!rollbackBatchId) throw new Error("--rollback 뒤에 batch ID가 필요합니다.");
    await rollback(rollbackBatchId);
    return;
  }

  const { candidates, blocked } = await findCandidates();
  console.log(`[reservation-repair] candidates=${candidates.length} blocked=${blocked.length} mode=${apply ? "APPLY" : "DRY_RUN"}`);
  for (const item of candidates) {
    console.log(`${item.unit._id}\tlot=${item.lot._id}\trelease=${item.unit.quantity}`);
  }
  for (const item of blocked) console.error(`[BLOCKED] ${item}`);
  if (blocked.length > 0) throw new Error(`RESERVATION_REPAIR_BLOCKED:${blocked.length}`);
  if (!apply) {
    console.log("변경 없음. 실제 적용: npx tsx scripts/repair-stale-inventory-reservations.ts --apply");
    return;
  }
  if (candidates.length === 0) {
    console.log("변경 없음.");
    return;
  }

  const db = await getDb();
  const batchId = `RESERVATION-REPAIR-${new Date().toISOString()}-${randomUUID().slice(0, 6)}`;
  const now = new Date();
  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await db.collection<ReservationRepairAudit>("inventoryReservationRepairAudits").insertOne({
        _id: batchId,
        status: "APPLIED",
        createdAt: now,
        beforeHandlingUnits: candidates.map((item) => item.unit),
        beforeLots: candidates.map((item) => item.lot),
      }, { session });
      for (const { unit, lot } of candidates) {
        const huResult = await db.collection<HandlingUnitDoc>("handlingUnits").updateOne({
          _id: unit._id,
          logisticsStatus: unit.logisticsStatus,
          reservedTransferOrderId: unit.reservedTransferOrderId,
          reservedWorkOrderId: unit.reservedWorkOrderId,
          version: unit.version,
        }, {
          $set: { logisticsStatus: "STORED", updatedAt: now },
          $unset: { reservedTransferOrderId: "", reservedWorkOrderId: "" },
          $inc: { version: 1 },
        }, { session });
        if (!huResult.modifiedCount) throw new Error(`STALE_HU_CHANGED:${unit._id}`);
        const lotResult = await db.collection<InventoryLotDoc>("inventoryLots").updateOne({
          _id: lot._id,
          availableQuantity: lot.availableQuantity,
          qualityStatus: lot.qualityStatus,
        }, {
          $inc: { availableQuantity: unit.quantity },
          $set: { updatedAt: now },
        }, { session });
        if (!lotResult.modifiedCount) throw new Error(`STALE_LOT_CHANGED:${lot._id}`);
      }
    });
  } finally {
    await session.endSession();
  }
  console.log(`[reservation-repair] applied batch=${batchId}`);
  console.log(`rollback: npx tsx scripts/repair-stale-inventory-reservations.ts --rollback ${batchId}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await (await getMongoClient()).close();
    } catch {
      // 연결 전 실패
    }
  });
