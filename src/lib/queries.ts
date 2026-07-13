import {
  collections,
  type MaterialDoc, type WarehouseDoc, type InventoryDoc, type ProcessUsageDoc,
  type TransactionDoc, type RiskLevel, type UserDoc, type WikiDoc, type InfraDoc,
  type BenefitCaseDoc,
} from "@/lib/db";
import { materialFactor, WORKING_DAYS } from "@/lib/capacity";
import type { VirtualStorageLocation } from "@/lib/warehouse-layout";
import { getGeneralStorageRationale, getStorageRule, getSupplyProfile } from "@/lib/warehouse-storage-rules";

// Prisma의 include 결과와 동일한 형태(중첩 객체 + id)로 반환해서
// 기존 페이지 JSX를 그대로 유지한다.

export type InventoryWithRefs = InventoryDoc & {
  id: string; material: MaterialDoc; warehouse: WarehouseDoc;
};

// 재고 + 자재/창고 조인 (inventory 페이지·대시보드·AI 공용)
export async function getInventoriesWithRefs(sortByCode = false): Promise<InventoryWithRefs[]> {
  const { inventory } = await collections();
  const pipeline: object[] = [
    { $lookup: { from: "materials", localField: "materialId", foreignField: "_id", as: "material" } },
    { $unwind: "$material" },
    { $lookup: { from: "warehouses", localField: "warehouseId", foreignField: "_id", as: "warehouse" } },
    { $unwind: "$warehouse" },
    { $addFields: { id: "$_id" } },
  ];
  if (sortByCode) pipeline.push({ $sort: { "material.code": 1 } });
  return inventory.aggregate<InventoryWithRefs>(pipeline).toArray();
}

export type WarehouseWithInventory = WarehouseDoc & { id: string; inventory: InventoryDoc[] };

// 창고 + 소속 재고 배열 (대시보드·AI capacity 계산)
export async function getWarehousesWithInventory(): Promise<WarehouseWithInventory[]> {
  const { warehouses } = await collections();
  return warehouses.aggregate<WarehouseWithInventory>([
    { $lookup: { from: "inventory", localField: "_id", foreignField: "warehouseId", as: "inventory" } },
    { $addFields: { id: "$_id" } },
  ]).toArray();
}

// 활성 리스크 (level HIGH→MEDIUM→LOW 순)
export type RiskShaped = {
  id: string; title: string; level: RiskLevel; category: string; owner: string;
  status: string; description?: string | null; mitigation?: string | null;
};
export async function getActiveRisks(): Promise<RiskShaped[]> {
  const { risks } = await collections();
  const rank: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const docs = await risks.find({ status: "Active" }).toArray();
  return docs
    .map((r) => ({ ...r, id: String(r._id) }) as unknown as RiskShaped)
    .sort((a, b) => (rank[a.level] ?? 9) - (rank[b.level] ?? 9));
}

// 인프라 설비 (onlyActive=현재사용량>0)
export async function getInfra(onlyActive = false): Promise<(InfraDoc & { id: string })[]> {
  const { infraEquipment } = await collections();
  const filter = onlyActive ? { currentUsage: { $gt: 0 } } : {};
  const docs = await infraEquipment.find(filter).toArray();
  return docs.map((d) => ({ ...d, id: String(d._id) }));
}

// 최근 입출고 (자재/유저 조인)
export type TransactionWithRefs = TransactionDoc & {
  id: string; material: MaterialDoc; user: UserDoc;
};
export async function getRecentTransactions(limit: number, withUser = true): Promise<TransactionWithRefs[]> {
  const { transactions } = await collections();
  const pipeline: object[] = [
    { $sort: { createdAt: -1 } },
    { $limit: limit },
    { $lookup: { from: "materials", localField: "materialId", foreignField: "_id", as: "material" } },
    { $unwind: "$material" },
  ];
  if (withUser) {
    pipeline.push(
      { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "user" } },
      { $unwind: "$user" },
    );
  }
  pipeline.push({ $addFields: { id: "$_id" } });
  return transactions.aggregate<TransactionWithRefs>(pipeline).toArray();
}

// 공정별 사용량 + 자재 조인
export type ProcessUsageWithMaterial = ProcessUsageDoc & { id: string; material: MaterialDoc };
export async function getProcessUsagesWithMaterial(): Promise<ProcessUsageWithMaterial[]> {
  const { processUsage } = await collections();
  return processUsage.aggregate<ProcessUsageWithMaterial>([
    { $lookup: { from: "materials", localField: "materialId", foreignField: "_id", as: "material" } },
    { $unwind: "$material" },
    { $sort: { processCode: 1, product: 1 } },
    { $addFields: { id: "$_id" } },
  ]).toArray();
}

// 창고 원본 목록
export async function getWarehouses(): Promise<(WarehouseDoc & { id: string })[]> {
  const { warehouses } = await collections();
  const docs = await warehouses.find({}).toArray();
  return docs.map((d) => ({ ...d, id: String(d._id) }));
}

// 위키(업무일지) + 작성자 이름
export type WikiShaped = {
  id: string; date: Date; title: string; category: string; content: string;
  result?: string | null; nextAction?: string | null; user: { name: string };
};
export async function getWikiEntries(): Promise<WikiShaped[]> {
  const { wikiEntries } = await collections();
  return wikiEntries.aggregate<WikiShaped>([
    { $sort: { date: -1 } },
    { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "u" } },
    { $addFields: { id: "$_id", user: { name: { $ifNull: [{ $first: "$u.name" }, "알 수 없음"] } } } },
    { $project: { u: 0 } },
  ]).toArray();
}

export async function createWikiEntry(data: Omit<WikiDoc, "_id">): Promise<void> {
  const { wikiEntries } = await collections();
  await wikiEntries.insertOne({ _id: crypto.randomUUID(), ...data });
}

export async function getBenefitCases(): Promise<(BenefitCaseDoc & { id: string })[]> {
  const { benefitCases } = await collections();
  const docs = await benefitCases.find({}).sort({ detectedAt: -1 }).toArray();
  return docs.map((doc) => ({ ...doc, id: doc._id }));
}

export async function createBenefitCase(data: Omit<BenefitCaseDoc, "_id">): Promise<void> {
  const { benefitCases } = await collections();
  await benefitCases.insertOne({ _id: crypto.randomUUID(), ...data });
}

// ─────────────────────────────────────────────
// 단일 진실원: 소비량·DOH·Capacity 유도 (모든 탭 공용)
// ─────────────────────────────────────────────

// 자재별 일평균사용량 = ProcessUsage 합÷가동일 (마스터). 없으면 avgDailyUsage fallback.
export type DailyUsage = { daily: number; monthlyQty: number; source: "process" | "fallback" };
export async function getMaterialDailyUsage(): Promise<Map<string, DailyUsage>> {
  const { processUsage, inventory } = await collections();
  const proc = await processUsage.aggregate<{ _id: string; sum: number }>([
    { $group: { _id: "$materialId", sum: { $sum: "$monthlyQty" } } },
  ]).toArray();
  const map = new Map<string, DailyUsage>();
  for (const p of proc) map.set(p._id, { daily: p.sum / WORKING_DAYS, monthlyQty: p.sum, source: "process" });
  // 비공정 자재(UPW·유틸·MRO) → 재고 avgDailyUsage 로 보조
  const invs = await inventory.find({}).toArray();
  const fb = new Map<string, number>();
  // 위치별 재고 행에 동일한 fallback 사용량이 반복될 수 있으므로 합산하지 않고 최댓값 사용.
  for (const inv of invs) fb.set(inv.materialId, Math.max(fb.get(inv.materialId) ?? 0, inv.avgDailyUsage ?? 0));
  for (const [mid, d] of fb) if (!map.has(mid)) map.set(mid, { daily: d, monthlyQty: d * WORKING_DAYS, source: "fallback" });
  return map;
}

// 재고 행 + 유도 일사용량·DOH·월소요량 (재고 페이지·대시보드·공정 페이지 공용)
export type InventoryRow = InventoryWithRefs & {
  dailyUsage: number; usageSource: "process" | "fallback"; doh: number | null; monthlyQty: number;
  totalQuantity: number;
};
export async function getInventoryRows(sortByCode = false): Promise<InventoryRow[]> {
  const [rows, usage] = await Promise.all([getInventoriesWithRefs(sortByCode), getMaterialDailyUsage()]);
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.materialId, (totals.get(row.materialId) ?? 0) + row.quantity);
  return rows.map((r) => {
    const u = usage.get(r.materialId);
    const daily = u?.daily ?? 0;
    const totalQuantity = totals.get(r.materialId) ?? r.quantity;
    return { ...r, totalQuantity, dailyUsage: daily, usageSource: u?.source ?? "fallback", doh: daily > 0 ? totalQuantity / daily : null, monthlyQty: u?.monthlyQty ?? 0 };
  });
}

// 창고 Capacity — 점유율·카테고리분해·법적한도·유형
export type WarehouseCapacity = {
  id: string; code: string; name: string; type: string; totalCapacity: number; unit: string;
  legalLimit: number | null;
  occupancy: number; utilization: number; legalUtilization: number | null;
  byCategory: { category: string; occupancy: number }[];
  materialCount: number; temperature?: string | null;
  capacityMode: "SPACE" | "TANK_LEVEL" | "CONTINUOUS";
};
export async function getWarehouseCapacity(): Promise<WarehouseCapacity[]> {
  const [whs, rows] = await Promise.all([getWarehouses(), getInventoriesWithRefs()]);
  return whs.map((wh) => {
    const items = rows.filter((r) => r.warehouseId === wh._id);
    const catMap = new Map<string, number>();
    let occ = 0;
    const mode = wh.capacityMode ?? "SPACE";
    if (mode === "TANK_LEVEL") {
      const levels = items.map((it) => Math.min(100, (it.quantity / Math.max(it.capacityLimit ?? it.quantity, 1)) * 100));
      occ = levels.length ? levels.reduce((sum, level) => sum + level, 0) / levels.length : 0;
      for (const it of items) {
        const level = Math.min(100, (it.quantity / Math.max(it.capacityLimit ?? it.quantity, 1)) * 100);
        catMap.set(it.material.category, (catMap.get(it.material.category) ?? 0) + level / Math.max(items.length, 1));
      }
    } else if (mode === "CONTINUOUS") {
      occ = 100;
      for (const it of items) catMap.set(it.material.category, 100);
    } else if (["HAZMAT", "MRO", "PRECURSOR"].includes(wh.type)) {
      for (const it of items) {
        occ += it.quantity;
        catMap.set(it.material.category, (catMap.get(it.material.category) ?? 0) + it.quantity);
      }
    } else {
      for (const it of items) {
        const o = it.quantity * materialFactor(it.material);
        occ += o;
        catMap.set(it.material.category, (catMap.get(it.material.category) ?? 0) + o);
      }
    }
    const legal = wh.legalLimit ?? null;
    return {
      id: wh.id, code: wh.code, name: wh.name, type: wh.type,
      totalCapacity: wh.totalCapacity, unit: wh.unit, temperature: wh.temperature, capacityMode: mode,
      legalLimit: legal, occupancy: Math.round(occ),
      utilization: wh.totalCapacity > 0 ? Math.round((occ / wh.totalCapacity) * 100) : 0,
      legalUtilization: legal ? Math.round((occ / legal) * 100) : null,
      byCategory: [...catMap.entries()].map(([category, o]) => ({ category, occupancy: Math.round(o) }))
        .sort((a, b) => b.occupancy - a.occupancy),
      materialCount: items.length,
    };
  }).sort((a, b) => {
    const order = ["MWH-01", "MWH-02", "HZW-01", "MRO-01", "BGY-01", "BCY-01", "PRS-01", "UPW-01"];
    return order.indexOf(a.code) - order.indexOf(b.code);
  });
}

// 저장 위치·로트·용기 기반 상세 레이아웃. 운영 컬렉션이 없으면 호출자가 가상 레이아웃으로 fallback.
export async function getWarehouseOperationalLayout(warehouseCode: string): Promise<VirtualStorageLocation[] | null> {
  const { warehouses, warehouseZones, storageLocations, handlingUnits, inventoryLots, materials, inventory } = await collections();
  const warehouse = await warehouses.findOne({ code: warehouseCode });
  if (!warehouse) return null;
  const locations = await storageLocations.find({ warehouseId: warehouse._id }).sort({ code: 1 }).toArray();
  if (!locations.length) return null;
  const [zones, units, inventoryDocs] = await Promise.all([
    warehouseZones.find({ warehouseId: warehouse._id }).toArray(),
    handlingUnits.find({ warehouseId: warehouse._id }).toArray(),
    inventory.find({ warehouseId: warehouse._id }).toArray(),
  ]);
  const materialIds = [...new Set(units.map((unit) => unit.materialId))];
  const lotIds = [...new Set(units.map((unit) => unit.inventoryLotId))];
  const [materialDocs, lotDocs] = await Promise.all([
    materials.find({ _id: { $in: materialIds } }).toArray(),
    inventoryLots.find({ _id: { $in: lotIds } }).toArray(),
  ]);
  const unitByLocation = new Map(units.map((unit) => [unit.locationId, unit]));
  const materialMap = new Map(materialDocs.map((material) => [material._id, material]));
  const lotMap = new Map(lotDocs.map((lot) => [lot._id, lot]));
  const inventoryMap = new Map(inventoryDocs.map((item) => [item.materialId, item]));
  const zoneMap = new Map(zones.map((zone) => [zone._id, zone.name]));
  const usage = await getMaterialDailyUsage();
  return locations.map((location) => {
    const unit = unitByLocation.get(location._id);
    const material = unit ? materialMap.get(unit.materialId) : undefined;
    const lot = unit ? lotMap.get(unit.inventoryLotId) : undefined;
    const inv = unit ? inventoryMap.get(unit.materialId) : undefined;
    const daily = unit ? usage.get(unit.materialId)?.daily ?? 0 : 0;
    const rule = material ? getStorageRule(material.code) : null;
    const supply = material ? getSupplyProfile(material.code) : null;
    const status = unit?.status === "HOLD" || unit?.status === "QUARANTINE" ? unit.status : unit ? "OCCUPIED" : "AVAILABLE";
    return {
      id: location._id, code: location.code, zone: zoneMap.get(location.zoneId) ?? location.zoneId, aisle: location.aisle ?? 0, bay: location.bay ?? 0, level: location.level ?? 0,
      position: [location.position.x, location.position.y, location.position.z], status,
      materialId: unit?.materialId, materialCode: material?.code, materialName: material?.name, category: material?.category,
      quantity: unit?.quantity, unit: material?.unit, doh: unit && daily > 0 ? unit.quantity / daily : null,
      hazard: rule?.hazard, rationale: rule?.rationale ?? (material ? getGeneralStorageRationale(warehouse.type) : undefined), controls: rule?.controls,
      supplyMode: supply?.mode, supplyLabel: supply?.label, supplyFlow: supply?.flow, targetFacility: supply?.targetFacility,
      relocationRequired: warehouse.type === "HAZMAT" && (supply?.mode === "BULK_GAS" || supply?.mode === "BULK_CHEMICAL"),
      lotNo: lot?.lotNo, containerId: unit?._id, expiryDate: lot?.expiryDate?.toISOString(),
      ...(inv?.status === "HOLD" || inv?.status === "QUARANTINE" ? { status: inv.status } : {}),
    } satisfies VirtualStorageLocation;
  });
}

export async function getFacilityTelemetry(warehouseCode: string) {
  const { warehouses, facilityTelemetry } = await collections();
  const warehouse = await warehouses.findOne({ code: warehouseCode });
  if (!warehouse) return [];
  const docs = await facilityTelemetry.find({ warehouseId: warehouse._id }).sort({ metric: 1 }).toArray();
  return docs.map((doc) => ({ metric: doc.metric, value: doc.value, unit: doc.unit, status: doc.status, measuredAt: doc.measuredAt.toISOString() }));
}

// 인증
export async function findUserByEmail(email: string): Promise<UserDoc | null> {
  const { users } = await collections();
  return users.findOne({ email });
}
export async function countUsers(): Promise<number> {
  const { users } = await collections();
  return users.countDocuments();
}
