import assert from "node:assert/strict";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { collections } from "../src/lib/db";
import { advanceAggregateWip } from "../src/lib/lot-route";
import { getRouteMaster, expandRouteMaster } from "../src/lib/route-master";
import { buildStepConsumption } from "../src/lib/twin/burn";
import { M20_MATERIAL_CONSUMPTION } from "../src/lib/material-consumption";

// G2: 완제품 창고(WH-FG01)가 CAPACITY_OVER면, 마지막 스텝을 완료해서 완제품이 될 로트는
// 자재차단과 같은 방식으로 진행을 멈춰야 한다 — 안 그러면 완제품이 갈 곳 없이 계속 쌓인다
// (실관측: WH-FG01 101% 도달, 게이팅 없이 계속 적립됨).
async function main() {
  const { waferLots } = await collections();
  const route = await getRouteMaster("M20", "HBM");
  if (!route) throw new Error("M20 HBM route master가 없습니다.");
  const visits = expandRouteMaster(route);
  const totalSteps = visits.length;
  const stepConsumption = buildStepConsumption(visits, [...M20_MATERIAL_CONSUMPTION]);

  const old = new Date(0);
  const ids = [randomUUID(), randomUUID()];
  await waferLots.insertMany([
    { _id: ids[0], fabId: "M20", product: "HBM", routeMasterId: "M20:HBM", foupCode: "FOUP-FGC-A",
      status: "IN_PROGRESS", cohort: "AGGREGATE", currentStepIndex: totalSteps - 1, waferQty: 25,
      createdBy: "test", createdAt: old, updatedAt: old, lastEventAt: old } as never,
    { _id: ids[1], fabId: "M20", product: "HBM", routeMasterId: "M20:HBM", foupCode: "FOUP-FGC-B",
      status: "IN_PROGRESS", cohort: "AGGREGATE", currentStepIndex: totalSteps - 1, waferQty: 25,
      createdBy: "test", createdAt: old, updatedAt: old, lastEventAt: old } as never,
  ]);

  try {
    // 1) 완제품 창고 초과 상태 — 완료 직전 로트가 막혀야 한다
    const held = await advanceAggregateWip("M20", "HBM", {
      stepConsumption, blockedMaterialIds: new Set(), finishedGoodsCapacityOver: true,
    });
    assert.ok(held.blocked >= 2, `완제품 창고 초과 시 완료 직전 로트가 막혀야 한다 (blocked=${held.blocked})`);
    assert.equal(held.completed, 0, "완제품 창고 초과 시 완료 카운트가 늘면 안 된다");

    const afterHold = await waferLots.find({ _id: { $in: ids } }).toArray();
    for (const lot of afterHold) {
      assert.equal(lot.status, "IN_PROGRESS", "막힌 로트는 여전히 IN_PROGRESS여야 한다");
      assert.ok(lot.finishedGoodsHoldAt, "finishedGoodsHoldAt이 기록돼야 한다");
    }

    // 2) 창고 여유 회복 — 다시 대기시간 지나면 정상 완료돼야 한다
    await waferLots.updateMany({ _id: { $in: ids } }, { $set: { lastEventAt: old } });
    const released = await advanceAggregateWip("M20", "HBM", {
      stepConsumption, blockedMaterialIds: new Set(), finishedGoodsCapacityOver: false,
    });
    assert.ok(released.completed >= 2, `여유 회복 후엔 정상 완료돼야 한다 (completed=${released.completed})`);

    const afterRelease = await waferLots.find({ _id: { $in: ids } }).toArray();
    for (const lot of afterRelease) {
      assert.equal(lot.status, "DONE", "회복 후엔 DONE이어야 한다");
      assert.equal(lot.finishedGoodsHoldAt, undefined, "회복되면 finishedGoodsHoldAt이 지워져야 한다");
    }
  } finally {
    await waferLots.deleteMany({ _id: { $in: ids } });
  }
  console.log("✅ 완제품 창고 게이팅(finishedGoodsCapacityOver) 테스트 통과");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
