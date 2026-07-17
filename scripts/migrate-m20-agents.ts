import "dotenv/config";
import { collections } from "../src/lib/db";
import type { HandlingUnitDoc } from "../src/lib/db";
import { M20_AGENT_POLICY_VERSION, M20_PROCUREMENT_POLICY_V1 } from "../src/lib/m20-agent-policy";

async function ensurePilotHandlingUnit() {
  const { inventoryLots, handlingUnits } = await collections();
  const exact = await handlingUnits.findOne({
    materialId: M20_PROCUREMENT_POLICY_V1.materialId,
    quantity: 98,
    status: "AVAILABLE",
    logisticsStatus: "STORED",
  });
  if (exact) return exact._id;

  const oversized = await handlingUnits.findOne({
    materialId: M20_PROCUREMENT_POLICY_V1.materialId,
    quantity: { $gt: 98 },
    status: "AVAILABLE",
    logisticsStatus: "STORED",
  }, { sort: { quantity: 1 } });
  if (oversized) {
    const pilotId = `HU__${oversized.inventoryLotId}__M20-AGENT-PILOT`;
    const now = new Date();
    const pilot: HandlingUnitDoc = {
      ...oversized,
      _id: pilotId,
      quantity: 98,
      version: 0,
      updatedAt: now,
    };
    const reduced = await handlingUnits.updateOne(
      { _id: oversized._id, quantity: oversized.quantity, status: "AVAILABLE", logisticsStatus: "STORED" },
      { $set: { quantity: Math.round((oversized.quantity - 98) * 100) / 100, updatedAt: now }, $inc: { version: 1 } },
    );
    if (!reduced.modifiedCount) throw new Error("HU 분할 중 원장이 변경되었습니다.");
    await handlingUnits.insertOne(pilot);
    return pilotId;
  }

  const lots = await inventoryLots.find({
    materialId: M20_PROCUREMENT_POLICY_V1.materialId,
    qualityStatus: "AVAILABLE",
    availableQuantity: { $gte: 98 },
    simulated: { $ne: true },
  }).sort({ expiryDate: 1, receivedAt: 1 }).toArray();
  for (const lot of lots) {
    const count = await handlingUnits.countDocuments({ inventoryLotId: lot._id });
    if (count) continue;
    const now = new Date();
    const base = {
      inventoryLotId: lot._id,
      materialId: lot.materialId,
      warehouseId: lot.warehouseId ?? "MWH-02",
      locationId: lot.slotId ?? "MWH-02__M20-PILOT-STORAGE",
      containerType: "PALLET",
      status: "AVAILABLE" as const,
      logisticsStatus: "STORED" as const,
      currentFacilityId: lot.warehouseId ?? "MWH-02",
      currentLocationId: lot.slotId ?? "MWH-02__M20-PILOT-STORAGE",
      version: 0,
      updatedAt: now,
    };
    const units: HandlingUnitDoc[] = [{ ...base, _id: `HU__${lot._id}__M20-AGENT-PILOT`, quantity: 98 }];
    if (lot.availableQuantity > 98) units.push({ ...base, _id: `HU__${lot._id}__M20-AGENT-REMAINDER`, quantity: Math.round((lot.availableQuantity - 98) * 100) / 100 });
    await handlingUnits.insertMany(units);
    return units[0]._id;
  }
  throw new Error("M20 에이전트 대표 흐름용 98kg HU를 만들 수 없습니다.");
}

async function main() {
  const {
    suppliers, materialSuppliers, agentRuns, agentDecisions, purchaseOrderDrafts,
    integrationOutbox, equipmentAssignments,
  } = await collections();
  const now = new Date();
  await suppliers.updateOne(
    { _id: M20_PROCUREMENT_POLICY_V1.supplierId },
    { $set: {
      _id: M20_PROCUREMENT_POLICY_V1.supplierId,
      name: M20_PROCUREMENT_POLICY_V1.supplierName,
      country: "MODEL",
      notes: `${M20_AGENT_POLICY_VERSION} 하드코딩 발주 정책용 모델 공급사 · 외부 전송 금지`,
    } },
    { upsert: true },
  );
  await materialSuppliers.updateOne(
    { materialId: M20_PROCUREMENT_POLICY_V1.materialId, supplierId: M20_PROCUREMENT_POLICY_V1.supplierId },
    { $set: {
      materialId: M20_PROCUREMENT_POLICY_V1.materialId,
      supplierId: M20_PROCUREMENT_POLICY_V1.supplierId,
      leadTimeDays: M20_PROCUREMENT_POLICY_V1.leadTimeDays,
      isPrimary: true,
      qualificationStatus: "APPROVED",
      sourcingRole: "PRIMARY",
      minLeadTimeDays: M20_PROCUREMENT_POLICY_V1.leadTimeDays,
      standardLeadTimeDays: M20_PROCUREMENT_POLICY_V1.leadTimeDays,
      maxLeadTimeDays: M20_PROCUREMENT_POLICY_V1.leadTimeDays,
      emergencyOrderAllowed: false,
      plannedSharePct: 100,
      updatedAt: now,
    }, $setOnInsert: { _id: `${M20_PROCUREMENT_POLICY_V1.materialId}__${M20_PROCUREMENT_POLICY_V1.supplierId}` } },
    { upsert: true },
  );
  const huId = await ensurePilotHandlingUnit();
  await Promise.all([
    agentRuns.createIndex({ workOrderId: 1 }, { unique: true }),
    agentDecisions.createIndex({ idempotencyKey: 1 }, { unique: true }),
    agentDecisions.createIndex({ runId: 1, createdAt: 1 }),
    purchaseOrderDrafts.createIndex({ sourceWorkOrderId: 1, materialId: 1, policyVersion: 1 }, { unique: true }),
    integrationOutbox.createIndex({ aggregateType: 1, aggregateId: 1 }, { unique: true }),
    equipmentAssignments.createIndex({ workOrderId: 1 }, { unique: true }),
    equipmentAssignments.createIndex(
      { equipmentId: 1 },
      { unique: true, partialFilterExpression: { status: { $in: ["RESERVED", "ACTIVE"] } } },
    ),
  ]);
  console.log(`✅ M20 규칙형 에이전트 마스터 준비 완료: ${M20_AGENT_POLICY_VERSION}, HU=${huId}`);
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
