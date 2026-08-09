import "dotenv/config";
import { collections } from "../src/lib/db";

// 완제품 창고 WH-FG01은 HBM 단일 제품 기준(855,563 STACK)으로 사이징돼 있었다. 이제 HBM·DRAM·NAND
// 세 제품이 같은 창고를 공유하므로(finishedGoods 문서는 product 키로 구분) 3제품 규모로 용량을 키운다.
// ⚠️ 알려진 단순화: 현재 utilization은 STACK+CHIP+DIE 수량을 그대로 합산한다(단위 혼합). 정확히는
// Gb 공통 환산(capacityGbPerUnit)으로 정규화해야 하나, 이번 이터레이션은 용량 상향으로 3제품 적립을
// 흐르게 하는 데 집중한다. Gb 정규화 용량은 후속 과제.
const TARGET_CAPACITY = 20_000_000; // MODELED — 3제품 완제품 버퍼(혼합 단위)

async function main() {
  const { warehouses } = await collections();
  const before = await warehouses.findOne({ _id: "WH-FG01" });
  console.log("before:", { totalCapacity: before?.totalCapacity, unit: before?.unit });
  await warehouses.updateOne({ _id: "WH-FG01" }, { $set: { totalCapacity: TARGET_CAPACITY } });
  const after = await warehouses.findOne({ _id: "WH-FG01" });
  console.log(`✅ WH-FG01 용량 상향: ${before?.totalCapacity} → ${after?.totalCapacity} ${after?.unit}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
