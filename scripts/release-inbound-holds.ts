import "dotenv/config";
import { collections } from "../src/lib/db";
import { increaseInventoryProjection } from "../src/lib/inventory-projection";

// releaseTwinInboundHold(inbound-hold-decision-server.ts)와 동일한 로직 — 그 파일은 "server-only"를
// import해서 스크립트에서 직접 못 부르니 그대로 복제한다.
//
// 배경: 박물류 CAPACITY_OVER 판정으로 INBOUND_HOLD가 된 발주는 목적창고 용량이 회복되면 이제
// twin tick(settleArrivals)이 매 tick 자동으로 재정산한다. 이 스크립트는 그걸 기다리지 않고
// 사람이 즉시(용량 초과가 아직 안 풀렸어도) 강제로 입고 반영하고 싶을 때 쓰는 수동 오버라이드다.
//
// 상태 전이를 먼저 원자적으로 선점하고 성공했을 때만 재고를 더한다 — 같은 PO를 twin tick이
// 동시에 자동 정산할 수 있어서, 순서를 반대로 하면(재고부터 더하면) 이중 입고가 날 수 있다.
async function main() {
  const actorId = process.env.RELEASE_ACTOR_ID ?? "ops-script";
  const { twinPurchaseOrders, materials } = await collections();

  const held = await twinPurchaseOrders.find({ status: "INBOUND_HOLD" }).sort({ orderedAt: 1 }).toArray();
  if (held.length === 0) {
    console.log("INBOUND_HOLD 상태의 발주가 없습니다.");
    process.exit(0);
  }

  console.log(`INBOUND_HOLD 발주 ${held.length}건 해제 시작`);
  let released = 0;
  for (const po of held) {
    if (!po.destinationWarehouseId) {
      console.log(` ✗ ${po._id}: 목적 창고 정보 없음 — 건너뜀`);
      continue;
    }
    const now = new Date();
    const claim = await twinPurchaseOrders.updateOne(
      { _id: po._id, status: "INBOUND_HOLD" },
      { $set: { status: "RECEIVED", releasedAt: now, releasedBy: actorId } },
    );
    if (claim.modifiedCount === 0) {
      console.log(` ↷ ${po._id}: 이미 다른 경로(twin tick 자동 정산 등)로 처리됨 — 건너뜀`);
      continue;
    }
    const mat = await materials.findOne({ _id: po.materialId });
    await increaseInventoryProjection({
      materialId: po.materialId, warehouseId: po.destinationWarehouseId, quantity: po.qty,
    });
    released++;
    console.log(` ✓ ${mat?.code ?? po.materialId} qty=${Math.round(po.qty)} → ${po.destinationWarehouseId} 입고 반영`);
  }

  console.log(`\n해제 완료: ${released}/${held.length}건`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
