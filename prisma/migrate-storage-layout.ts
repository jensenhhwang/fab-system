import "dotenv/config";
import { MongoClient } from "mongodb";
import { FACILITY_MASTER, getCanonicalFacility, getSupplyProfile } from "../src/lib/warehouse-storage-rules";

const apply = process.argv.includes("--apply");
const uri = process.env.DATABASE_URL;
if (!uri) throw new Error("DATABASE_URL 미설정");

const client = new MongoClient(uri);

async function main() {
  await client.connect();
  const db = client.db();
  const materials = await db.collection<{ _id: string; code: string }>("materials").find({}).toArray();
  const inventory = await db.collection<{ _id: string; materialId: string; warehouseId: string; quantity: number }>("inventory").find({}).toArray();
  const totalQuantityBefore = inventory.reduce((sum, item) => sum + item.quantity, 0);
  const materialCodes = new Set(materials.map((material) => material.code));
  const orphans = inventory.filter((item) => !materialCodes.has(item.materialId));
  if (orphans.length) throw new Error(`자재 마스터 없는 재고 ${orphans.length}건 발견 — 적용 중단`);

  const moves = inventory.map((item) => ({
    id: item._id,
    materialId: item.materialId,
    from: item.warehouseId,
    to: getCanonicalFacility(item.materialId),
    quantity: item.quantity,
  })).filter((move) => move.from !== move.to);

  console.log(`[storage-layout] mode=${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`[storage-layout] facilities=${FACILITY_MASTER.length}, materials=${materials.length}, inventory=${inventory.length}, moves=${moves.length}`);
  for (const move of moves) console.log(`  ${move.materialId}: ${move.from} -> ${move.to}`);
  if (!apply) {
    console.log("변경 없음. 실제 적용: npm run db:migrate-storage -- --apply");
    return;
  }

  const warehousesCollection = db.collection<{ _id: string } & Record<string, unknown>>("warehouses");
  const materialsCollection = db.collection<{ _id: string } & Record<string, unknown>>("materials");
  const inventoryCollection = db.collection<{ _id: string } & Record<string, unknown>>("inventory");
  for (const facility of FACILITY_MASTER) {
    await warehousesCollection.updateOne({ _id: facility._id }, { $set: { ...facility } }, { upsert: true });
  }
  for (const material of materials) {
    await materialsCollection.updateOne({ _id: material._id }, { $set: { supplyMode: getSupplyProfile(material.code).mode } });
  }
  for (const item of inventory) {
    const target = getCanonicalFacility(item.materialId);
    const isTank = target === "BGY-01" || target === "BCY-01";
    await inventoryCollection.updateOne(
      { _id: item._id },
      { $set: { warehouseId: target, ...(isTank && item.quantity > 0 ? { capacityLimit: Math.ceil(item.quantity / 0.68) } : {}) } },
    );
  }
  await db.collection("risks").updateOne(
    { title: { $regex: "C동 위험물창고 Capacity" } },
    { $set: { title: "C동 특수가스 허가 저장량 모니터링 (89%)", description: "특수가스 803 cylinder-slot / 사업장 설정 허가상한 900. 90% 도달 전 분할 입고·공급사 보관 전환 필요", mitigation: "입고 전 예상 점유 검증, 90% 초과 주문 분할, 비상 시 공급사 오프사이트 재고 활용" } },
  );
  const after = await db.collection<{ materialId: string; warehouseId: string; quantity: number }>("inventory").find({}).toArray();
  const totalQuantityAfter = after.reduce((sum, item) => sum + item.quantity, 0);
  const facilityIds = new Set(FACILITY_MASTER.map((facility) => facility._id));
  const invalidRefs = after.filter((item) => !facilityIds.has(item.warehouseId as (typeof FACILITY_MASTER)[number]["_id"]));
  if (after.length !== inventory.length || totalQuantityAfter !== totalQuantityBefore || invalidRefs.length) {
    throw new Error(`적용 후 검증 실패: rows ${inventory.length}->${after.length}, qty ${totalQuantityBefore}->${totalQuantityAfter}, invalidRefs=${invalidRefs.length}`);
  }
  const distribution = new Map<string, number>();
  for (const item of after) distribution.set(item.warehouseId, (distribution.get(item.warehouseId) ?? 0) + 1);
  console.log(`재배치 적용 완료: rows=${after.length}, totalQuantity=${totalQuantityAfter}, invalidRefs=0`);
  console.log("시설별 자재종수:", Object.fromEntries([...distribution.entries()].sort()));
}

main().finally(() => client.close());
