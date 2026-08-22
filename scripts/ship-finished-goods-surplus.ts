import "dotenv/config";
import { randomUUID } from "crypto";
import { collections } from "../src/lib/db";
import { ACTIVE_PRODUCTION_PRODUCTS } from "../src/lib/fab-production-config";
import { finishedGoodsUnit, finishedGoodsWarehouseFor } from "../src/lib/finished-goods";
import { TIER_SHARE } from "../src/lib/customer-contracts";

// 완제품 창고가 포화되면 마지막 공정 스텝이 막혀 생산이 선다. 가상 고객사에 비례 출하해
// 여유를 만든다. POST /api/twin/shipments와 동일한 로직(재고 차감 + shipments 기록)을
// 등급별 비율로 반복하되, 3제품(HBM/DRAM/NAND)을 각자의 창고 기준으로 처리한다.
//
// 목표: 70% 수준까지 (여유 확보, 딱 100%에 걸치지 않게)
// 등급별 배분 비율은 customer-contracts.ts를 그대로 쓴다 — 여기서 따로 하드코딩하면
// 계약 비율과 출하 비율이 갈라져 이행률이 구조적으로 안 맞는다.
const TARGET_UTILIZATION = 0.70;

async function main() {
  const { finishedGoods, shipments, warehouses, customers } = await collections();

  const existingCustomers = await customers.countDocuments();
  if (existingCustomers === 0) {
    throw new Error("고객사가 없습니다 — /api/customers를 먼저 한 번 호출해 시드를 만드세요.");
  }

  let shippedProducts = 0;
  for (const { fabId, product } of ACTIVE_PRODUCTION_PRODUCTS) {
    const warehouseId = finishedGoodsWarehouseFor(product);
    const unit = finishedGoodsUnit(product);
    const fgId = `${fabId}__${product}__${warehouseId}`;
    const [fg, wh] = await Promise.all([
      finishedGoods.findOne({ _id: fgId }),
      warehouses.findOne({ _id: warehouseId }),
    ]);
    if (!fg || !wh) {
      console.log(`[${product}] 완제품 재고 또는 창고를 찾을 수 없습니다 (${fgId}) — 건너뜀`);
      continue;
    }

    const targetQty = wh.totalCapacity * TARGET_UTILIZATION;
    const toShip = fg.quantity - targetQty;
    if (toShip <= 0) {
      console.log(`[${product}] ${Math.round(fg.quantity).toLocaleString()} / ${wh.totalCapacity.toLocaleString()} ${unit} — 이미 목표 이하, 출하 불필요`);
      continue;
    }

    console.log(`[${product}] ${Math.round(fg.quantity).toLocaleString()} → 목표 ${Math.round(targetQty).toLocaleString()} → 출하 ${Math.round(toShip).toLocaleString()} ${unit}`);
    const now = new Date();
    let remaining = fg.quantity;
    for (const [customerId, share] of Object.entries(TIER_SHARE)) {
      const qty = Math.round(toShip * share);
      if (qty <= 0) continue;
      // 조건부 차감 — tick의 적립과 겹쳐도 재고가 음수로 내려가지 않는다.
      const res = await finishedGoods.updateOne(
        { _id: fgId, quantity: { $gte: qty } },
        { $inc: { quantity: -qty }, $set: { updatedAt: now } },
      );
      if (!res.modifiedCount) {
        console.log(`  ✗ ${customerId} qty=${qty.toLocaleString()} — 가용 재고 부족으로 건너뜀`);
        continue;
      }
      await shipments.insertOne({
        _id: randomUUID(), fabId, product,
        warehouseId, customerId, quantity: qty, unit,
        shippedAt: now, shippedBy: "admin@fab.skh",
      });
      remaining -= qty;
      console.log(`  ✓ ${customerId} qty=${qty.toLocaleString()} ${unit} (share=${share})`);
    }
    console.log(`  잔여 ≈ ${Math.round(remaining).toLocaleString()} ${unit} (${Math.round((remaining / wh.totalCapacity) * 100)}%)`);
    shippedProducts++;
  }

  console.log(`\n[ship-surplus] 완료 — ${shippedProducts}개 제품 출하 처리`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
