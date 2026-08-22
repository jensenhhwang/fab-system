import "dotenv/config";
import { collections } from "../src/lib/db";
import { ACTIVE_PRODUCTION_PRODUCTS, getProductionConfig } from "../src/lib/fab-production-config";
import { finishedGoodsPerWafer, finishedGoodsUnit, finishedGoodsWarehouseFor } from "../src/lib/finished-goods";

// 완제품 창고를 팹별로 분리한다(WH-FG01=M20 HBM, WH-FG02=M21 DRAM, WH-FG03=M22 NAND).
//
// 배경: DRAM/NAND 확장 때 완제품 창고 마스터를 같이 안 올려서 3제품이 M20 HBM 전용 창고
// 하나(WH-FG01)를 공유하고 있었다. getWarehouseCapacity(queries.ts:198-202)가 완제품 창고
// 점유를 단위 구분 없이 raw 합산하기 때문에 STACK+CHIP+DIE가 섞여 utilization이 무의미해지고,
// 한 제품의 적체가 나머지 두 제품의 생산까지 CAPACITY_OVER로 멈춘다(실관측: HBM 132일치
// 적체로 198% → DRAM/NAND 동반 정지).
//
// 신규 창고 용량은 기존 WH-FG01과 같은 관례(MODELED_BASELINE, 일산출 × 5일 버퍼)로 잡는다.
// WH-FG01의 totalCapacity는 이미 운영 중 상향된 값이라 건드리지 않는다.
async function main() {
  const { warehouses, finishedGoods } = await collections();

  for (const { fabId, product } of ACTIVE_PRODUCTION_PRODUCTS) {
    const warehouseId = finishedGoodsWarehouseFor(product);
    const cfg = getProductionConfig(fabId, product);
    if (!cfg) throw new Error(`${fabId}/${product} 생산 config를 찾을 수 없습니다.`);

    const unit = finishedGoodsUnit(product);
    const dailyOutput = (cfg.waferStartsPerMonth / 30) * finishedGoodsPerWafer(product);
    const totalCapacity = Math.round(dailyOutput * 5);

    const existing = await warehouses.findOne({ _id: warehouseId });
    if (existing) {
      // 이미 있는 창고는 용량을 덮어쓰지 않는다 — fabId만 채워 팹 귀속을 명확히 한다.
      await warehouses.updateOne({ _id: warehouseId }, { $set: { fabId } });
      console.log(`[warehouse] ${warehouseId} 유지 (용량 ${existing.totalCapacity.toLocaleString()} ${existing.unit}) — fabId=${fabId} 설정`);
    } else {
      await warehouses.insertOne({
        _id: warehouseId, code: warehouseId, name: `완제품 창고 (${fabId} ${product})`,
        type: "FINISHED_GOODS", totalCapacity, unit, capacityMode: "SPACE",
        fabId, temperature: "실온",
        notes: `MODELED_BASELINE 계획값 · 실측 시설 마스터로 교체 필요. 일산출(${Math.round(dailyOutput).toLocaleString()} ${unit}/일) × 5일 버퍼로 산정.`,
      });
      console.log(`[warehouse] ${warehouseId} 생성 — ${fabId} ${product}, 용량 ${totalCapacity.toLocaleString()} ${unit}`);
    }

    // 완제품 재고 문서를 제 창고로 이관한다. _id에 창고가 박혀 있어 수정이 아니라 재삽입이다.
    const targetId = `${fabId}__${product}__${warehouseId}`;
    const stale = await finishedGoods.find({ fabId, product, warehouseId: { $ne: warehouseId } }).toArray();
    for (const doc of stale) {
      await finishedGoods.updateOne(
        { _id: targetId },
        {
          $inc: { quantity: doc.quantity, pendingTestQuantity: doc.pendingTestQuantity ?? 0 },
          $set: { updatedAt: doc.updatedAt ?? new Date(), pendingTestReadyOperatingMs: doc.pendingTestReadyOperatingMs ?? null },
          $setOnInsert: { fabId, product, warehouseId, unit },
        },
        { upsert: true },
      );
      await finishedGoods.deleteOne({ _id: doc._id });
      console.log(`[finishedGoods] ${doc._id} → ${targetId} 이관 (수량 ${Math.round(doc.quantity).toLocaleString()} ${unit})`);
    }
    if (stale.length === 0) console.log(`[finishedGoods] ${product} 이관 불필요 (이미 ${warehouseId})`);
  }

  console.log("\n분리 완료. 창고별 완제품 재고:");
  for (const doc of await finishedGoods.find({}).toArray()) {
    console.log(` ${doc.warehouseId}: ${doc.product} ${Math.round(doc.quantity).toLocaleString()} ${doc.unit}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
