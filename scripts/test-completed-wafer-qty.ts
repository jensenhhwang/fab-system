import assert from "node:assert/strict";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { collections } from "../src/lib/db";
import { advanceAggregateWip } from "../src/lib/lot-route";
import { getRouteMaster, expandRouteMaster } from "../src/lib/route-master";

// 완제품 재고 적립(F0)은 advanceAggregateWip이 이번 tick에 DONE된 로트의 웨이퍼 수량을
// 리턴해야 계산할 수 있다. 마지막 스텝 직전(totalSteps-1)에 있는 로트가 이번 tick에
// 완료되면 completedWaferQty에 그 waferQty가 더해져야 한다.
async function main() {
  const { waferLots } = await collections();
  const route = await getRouteMaster("M20", "HBM");
  if (!route) throw new Error("M20 HBM route master가 없습니다.");
  const totalSteps = expandRouteMaster(route).length;

  const old = new Date(0);
  const ids = [randomUUID(), randomUUID()];
  await waferLots.insertMany([
    { _id: ids[0], fabId: "M20", product: "HBM", routeMasterId: "M20:HBM", foupCode: "FOUP-CWQ-A",
      status: "IN_PROGRESS", cohort: "AGGREGATE", currentStepIndex: totalSteps - 1, waferQty: 25,
      createdBy: "test", createdAt: old, updatedAt: old, lastEventAt: old } as never,
    { _id: ids[1], fabId: "M20", product: "HBM", routeMasterId: "M20:HBM", foupCode: "FOUP-CWQ-B",
      status: "IN_PROGRESS", cohort: "AGGREGATE", currentStepIndex: totalSteps - 1, waferQty: 18,
      createdBy: "test", createdAt: old, updatedAt: old, lastEventAt: old } as never,
  ]);

  try {
    const result = await advanceAggregateWip("M20", "HBM");
    assert.ok(result.completed >= 2, `테스트 로트 2개가 완료돼야 한다 (completed=${result.completed})`);
    assert.ok(result.completedWaferQty >= 43, `완료된 로트의 웨이퍼 합(25+18=43)이 반영돼야 한다 (completedWaferQty=${result.completedWaferQty})`);

    const after = await waferLots.find({ _id: { $in: ids } }).toArray();
    for (const lot of after) assert.equal(lot.status, "DONE", "완료된 로트는 DONE 상태여야 한다");
  } finally {
    await waferLots.deleteMany({ _id: { $in: ids } });
  }
  console.log("✅ completedWaferQty 테스트 통과");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
