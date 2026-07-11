import {
  collections,
  type MaterialDoc, type WarehouseDoc, type InventoryDoc, type ProcessUsageDoc,
  type TransactionDoc, type RiskLevel, type UserDoc, type WikiDoc, type InfraDoc,
} from "@/lib/db";

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

// 인증
export async function findUserByEmail(email: string): Promise<UserDoc | null> {
  const { users } = await collections();
  return users.findOne({ email });
}
export async function countUsers(): Promise<number> {
  const { users } = await collections();
  return users.countDocuments();
}
