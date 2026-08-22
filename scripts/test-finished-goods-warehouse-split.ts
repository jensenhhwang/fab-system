import assert from "node:assert/strict";
import "dotenv/config";
import { collections } from "../src/lib/db";
import { finishedGoodsWarehouseFor, finishedGoodsWarehouseIds, finishedGoodsUnit } from "../src/lib/finished-goods";
import { ACTIVE_PRODUCTION_PRODUCTS } from "../src/lib/fab-production-config";

// 완제품 창고는 팹별로 분리돼야 한다. 하나(WH-FG01)를 3제품이 공유하면 (1) 단위가 다른
// STACK/CHIP/DIE가 raw 합산돼 점유율이 무의미해지고 (2) 한 제품의 재고 과잉이 다른 두 제품의
// 생산까지 CAPACITY_OVER로 멈춘다(실관측: HBM 132일치 적체로 198% → DRAM/NAND 동반 정지).
async function main() {
  // 1) 제품별 창고가 서로 달라야 한다
  const ids = ACTIVE_PRODUCTION_PRODUCTS.map(({ product }) => finishedGoodsWarehouseFor(product));
  assert.equal(new Set(ids).size, ACTIVE_PRODUCTION_PRODUCTS.length, `제품별 완제품 창고가 서로 달라야 한다 (${ids.join(",")})`);
  assert.deepEqual([...finishedGoodsWarehouseIds()].sort(), [...ids].sort(), "finishedGoodsWarehouseIds()가 매핑 전체를 반환해야 한다");

  // 2) 각 창고가 마스터에 등록돼 있고 제품 단위와 일치해야 한다
  const { warehouses, finishedGoods } = await collections();
  for (const { fabId, product } of ACTIVE_PRODUCTION_PRODUCTS) {
    const whId = finishedGoodsWarehouseFor(product);
    const wh = await warehouses.findOne({ _id: whId });
    assert.ok(wh, `${product} 완제품 창고(${whId})가 warehouses 마스터에 있어야 한다`);
    assert.equal(wh.type, "FINISHED_GOODS", `${whId} 타입이 FINISHED_GOODS여야 한다`);
    assert.equal(wh.unit, finishedGoodsUnit(product), `${whId} 단위가 ${product} 완제품 단위와 같아야 한다`);
    assert.ok(wh.fabId === fabId, `${whId}의 fabId가 ${fabId}여야 한다`);

    // 3) 완제품 재고 문서가 제 창고에 들어 있어야 한다
    const doc = await finishedGoods.findOne({ fabId, product });
    if (doc) {
      assert.equal(doc.warehouseId, whId, `${product} 완제품 재고가 ${whId}에 있어야 한다 (현재 ${doc.warehouseId})`);
      assert.equal(doc._id, `${fabId}__${product}__${whId}`, `${product} 완제품 문서 _id가 창고와 정합해야 한다`);
    }
  }

  // 4) 한 창고에 두 제품이 섞이면 안 된다 (단위 혼합 합산 방지)
  const all = await finishedGoods.find({}).toArray();
  const productsByWh = new Map<string, Set<string>>();
  for (const d of all) {
    const set = productsByWh.get(d.warehouseId) ?? new Set<string>();
    set.add(d.product);
    productsByWh.set(d.warehouseId, set);
  }
  for (const [whId, set] of productsByWh) {
    assert.equal(set.size, 1, `${whId}에 제품이 섞여 있으면 안 된다 (${[...set].join(",")})`);
  }

  console.log("✅ 완제품 창고 팹별 분리 테스트 통과 — " + ACTIVE_PRODUCTION_PRODUCTS.map(({ product }) => `${product}→${finishedGoodsWarehouseFor(product)}`).join(", "));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
