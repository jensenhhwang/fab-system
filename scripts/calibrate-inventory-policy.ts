import "dotenv/config";
import { randomUUID } from "crypto";
import { collections, getMongoClient, type InventoryPolicyDoc } from "../src/lib/db";
import { getInventoryRows, getMaterialDailyUsage, getWarehouseCapacity } from "../src/lib/queries";
import { buildProcurementSummary } from "../src/lib/procurement";
import { warehouseOccupancyFactor } from "../src/lib/capacity";
import { calculateBaselineTarget, capacityDecision, INVENTORY_POLICY_VERSION } from "../src/lib/inventory-policy";

const apply = process.argv.includes("--apply");
const rollbackIndex = process.argv.findIndex(arg => arg === "--rollback");
const rollbackBatchId = rollbackIndex >= 0 ? process.argv[rollbackIndex + 1] : null;

async function rollback(batchId: string) {
  const { inventoryPolicies, inventoryPolicyAudits } = await collections();
  const audits = await inventoryPolicyAudits.find({ batchId, action: "APPLY" }).toArray();
  if (!audits.length) throw new Error(`적용 감사 배치를 찾을 수 없습니다: ${batchId}`);
  const client = await getMongoClient();
  const session = client.startSession();
  const rollbackBatch = `ROLLBACK-${new Date().toISOString()}-${randomUUID().slice(0, 6)}`;
  let restored = 0; let skipped = 0;
  try {
    await session.withTransaction(async () => {
      for (const audit of audits) {
        const current = await inventoryPolicies.findOne({ _id: audit.materialId }, { session });
        if (!current || current.batchId !== batchId) { skipped++; continue; }
        if (audit.before) await inventoryPolicies.replaceOne({ _id: audit.materialId, batchId }, audit.before, { session });
        else await inventoryPolicies.deleteOne({ _id: audit.materialId, batchId }, { session });
        await inventoryPolicyAudits.insertOne({
          _id: `${rollbackBatch}:${audit.materialId}`, batchId: rollbackBatch, materialId: audit.materialId,
          action: "ROLLBACK", before: current, after: audit.before, createdAt: new Date(),
        }, { session });
        restored++;
      }
    });
  } finally { await session.endSession(); }
  console.log(`[inventory-policy] rollback=${batchId} restored=${restored} skipped=${skipped} auditBatch=${rollbackBatch}`);
}

async function main() {
  if (rollbackBatchId) { await rollback(rollbackBatchId); return; }
  const { materials, suppliers, materialSuppliers, inventoryPolicies, inventoryPolicyAudits } = await collections();
  const [rows, usage, capacities, materialDocs, supplierDocs, links, existingPolicies] = await Promise.all([
    getInventoryRows(true), getMaterialDailyUsage(), getWarehouseCapacity(), materials.find({}).toArray(), suppliers.find({}).toArray(),
    materialSuppliers.find({}).toArray(), inventoryPolicies.find({}).toArray(),
  ]);
  const materialMap = new Map(materialDocs.map(material => [material._id, material]));
  const existingMap = new Map(existingPolicies.map(policy => [policy.materialId, policy]));
  const linksByMaterial = new Map<string, typeof links>();
  for (const link of links) linksByMaterial.set(link.materialId, [...(linksByMaterial.get(link.materialId) ?? []), link]);
  const uniqueRows = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!uniqueRows.has(row.materialId)) uniqueRows.set(row.materialId, row);
  const batchId = `BASELINE-${new Date().toISOString()}-${randomUUID().slice(0, 6)}`;
  const calculatedAt = new Date();
  const proposals: InventoryPolicyDoc[] = [];

  for (const row of uniqueRows.values()) {
    if (row.material.ropDays <= 0 || row.doh == null || row.doh >= 5) continue;
    const material = materialMap.get(row.materialId)!;
    const dailyUsage = usage.get(row.materialId)?.daily ?? 0;
    const procurement = buildProcurementSummary(linksByMaterial.get(row.materialId) ?? [], supplierDocs, calculatedAt);
    const facilityRows = rows.filter(item => item.materialId === row.materialId);
    const capacity = capacities.find(item => item.id === row.warehouseId);
    let status: InventoryPolicyDoc["status"] = "READY";
    let blockReason: string | null = null;
    let leadTimeDays = procurement?.normalDays ?? 0;
    if (!material.unit || dailyUsage <= 0 || !procurement || leadTimeDays <= 0 || facilityRows.length !== 1 || !capacity || material.supplyMode === "ON_SITE") {
      status = "BLOCKED_MASTER_DATA";
      blockReason = material.supplyMode === "ON_SITE" ? "현장 연속공급 품목" : !procurement || leadTimeDays <= 0 ? "승인 주공급사 리드타임 미등록" : facilityRows.length !== 1 ? "복수 시설 수요 배정 미등록" : "기준 데이터 부족";
      leadTimeDays = Math.max(leadTimeDays, 0);
    }
    const target = calculateBaselineTarget({ currentQuantity: row.totalQuantity, safetyStock: material.safetyStock, dailyUsage, ropDays: material.ropDays, leadTimeDays });
    if (status === "READY" && capacity) {
      const decision = capacityDecision({
        capacityMode: capacity.capacityMode, currentOccupancy: capacity.occupancy, totalCapacity: capacity.totalCapacity,
        legalLimit: capacity.legalLimit, currentQuantity: row.totalQuantity, targetQuantity: target.targetQuantity,
        // 점유 환산은 warehouseOccupancyFactor 하나만 쓴다 — capacity.occupancy는 이 함수로
        // 계산돼 오는데(getWarehouseCapacity) 증분만 다른 규칙으로 재면, 위험물·전구체처럼
        // 재고단위≠보관단위인 창고에서 증분이 실린더 슬롯 환산 없이 원단위로 더해져 점유가
        // 과대평가되고 멀쩡한 자재가 BLOCKED_CAPACITY로 막힌다(§devlog day 23 환산 통합).
        occupancyFactor: warehouseOccupancyFactor(capacity.type, material),
        materialCapacityLimit: row.capacityLimit ?? null,
      });
      if (!decision.allowed) { status = "BLOCKED_CAPACITY"; blockReason = decision.reason; }
    }
    proposals.push({
      _id: row.materialId, materialId: row.materialId, facilityId: row.warehouseId,
      referenceQuantity: row.totalQuantity, targetQuantity: target.targetQuantity, shortageQuantity: target.shortageQuantity,
      dailyUsage, ropDays: material.ropDays, leadTimeDays, protectedDays: target.protectedDays,
      supplierId: procurement?.supplierId ?? "", status, blockReason, formulaVersion: INVENTORY_POLICY_VERSION,
      batchId, calculatedAt, updatedAt: calculatedAt,
    });
  }

  console.log(`[inventory-policy] mode=${apply ? "APPLY" : "DRY-RUN"} batch=${batchId} candidates=${proposals.length}`);
  for (const proposal of proposals) console.log(`${proposal.materialId}\t${proposal.status}\tcurrent=${proposal.referenceQuantity}\ttarget=${proposal.targetQuantity}\tshortage=${proposal.shortageQuantity}\tprotect=${proposal.protectedDays}d\t${proposal.blockReason ?? "OK"}`);
  const changes = proposals.filter(proposal => {
    const existing = existingMap.get(proposal.materialId);
    return !existing || existing.targetQuantity !== proposal.targetQuantity || existing.status !== proposal.status || existing.blockReason !== proposal.blockReason || existing.referenceQuantity !== proposal.referenceQuantity;
  });
  console.log(`[inventory-policy] ready=${proposals.filter(item => item.status === "READY").length} blockedCapacity=${proposals.filter(item => item.status === "BLOCKED_CAPACITY").length} blockedMaster=${proposals.filter(item => item.status === "BLOCKED_MASTER_DATA").length} changes=${changes.length}`);
  if (!apply) { console.log("변경 없음. 실제 적용: npm run db:calibrate-inventory -- --apply"); return; }
  if (!changes.length) { console.log("변경할 정책이 없습니다."); return; }

  const client = await getMongoClient(); const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      for (const proposal of changes) {
        const before = existingMap.get(proposal.materialId) ?? null;
        await inventoryPolicies.replaceOne({ _id: proposal.materialId }, proposal, { upsert: true, session });
        await inventoryPolicyAudits.insertOne({ _id: `${batchId}:${proposal.materialId}`, batchId, materialId: proposal.materialId, action: "APPLY", before, after: proposal, createdAt: calculatedAt }, { session });
      }
    });
  } finally { await session.endSession(); }
  console.log(`[inventory-policy] applied=${changes.length} batch=${batchId}`);
  console.log(`rollback: npm run db:calibrate-inventory -- --rollback ${batchId}`);
}

main().catch(error => { console.error(error); process.exit(1); });
