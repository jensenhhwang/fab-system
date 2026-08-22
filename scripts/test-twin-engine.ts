import assert from "node:assert/strict";
import "dotenv/config";
import { collections } from "../src/lib/db";
import { executeTwinTick } from "../src/lib/twin/engine";

// 역할 게이트(isRoleAutomationReady)는 2026-08-05 해제됐다 — 이제 PAUSED 상태만이
// Tick을 읽기전용으로 유지시킨다.
async function main() {
  const { waferLots, inventory, twinPurchaseOrders, twinBurnEvents, twinEngineState } = await collections();

  const [stateBefore, lotsBefore, inventoryBefore, posBefore, burnsBefore] = await Promise.all([
    twinEngineState.findOne({ _id: "singleton" }),
    waferLots.countDocuments(),
    inventory.find({}).toArray(),
    twinPurchaseOrders.countDocuments(),
    twinBurnEvents.countDocuments(),
  ]);
  assert.ok(stateBefore, "Twin 상태가 존재한다");

  assert.equal(stateBefore?.status, "PAUSED", "이 테스트는 Twin이 PAUSED일 때만 유효하다");
  const result = await executeTwinTick(new Date());
  assert.equal(result.skipped, "PAUSED", "PAUSED 상태에서는 Tick이 차단된다");

  const [stateAfter, lotsAfter, inventoryAfter, posAfter, burnsAfter] = await Promise.all([
    twinEngineState.findOne({ _id: "singleton" }),
    waferLots.countDocuments(),
    inventory.find({}).toArray(),
    twinPurchaseOrders.countDocuments(),
    twinBurnEvents.countDocuments(),
  ]);
  assert.deepEqual(stateAfter?.lastTickAt, stateBefore?.lastTickAt, "차단된 Tick은 lastTickAt을 바꾸지 않는다");
  assert.equal(lotsAfter, lotsBefore, "차단된 Tick은 WIP을 생성·진행하지 않는다");
  assert.deepEqual(inventoryAfter, inventoryBefore, "차단된 Tick은 재고를 변경하지 않는다");
  assert.equal(posAfter, posBefore, "차단된 Tick은 PO를 만들거나 입고 처리하지 않는다");
  assert.equal(burnsAfter, burnsBefore, "차단된 Tick은 소모 이벤트를 만들지 않는다");
  console.log("✅ twin role gate keeps operational data read-only");
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
