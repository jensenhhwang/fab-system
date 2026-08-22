import assert from "node:assert/strict";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { collections } from "../src/lib/db";
import { advanceAggregateWip } from "../src/lib/lot-route";
import type { StepConsumption } from "../src/lib/twin/burn";

// M1 통합 검증: isLotMaterialBlocked 순수 함수가 advanceAggregateWip DB 경로에 실제로
// 배선됐는지 확인한다. 스텝0에서 GAS-001을 쓰는 로트가, GAS-001이 CRITICAL일 때 실제로
// DB에서 진행이 막히고, 회복되면 다음 호출에서 실제로 다시 진행되는지까지 본다.
async function main() {
  const { waferLots } = await collections();
  // 공유 개발 DB에는 due 로트가 수만 개 있어(배치상한 정체 이슈, 세션 중 기존에 발견된
  // 테스트 격리 취약점) lastEventAt을 살짝만 과거로 두면 정렬 순위에서 밀려 이 tick에
  // 안 걸릴 수 있다. 확실히 큐 맨 앞에 서도록 아주 오래된 시각을 쓴다.
  const old = new Date(0);
  const timing = {
    operatingEpochMs: 10 * 86_400_000,
    elapsedOperatingMs: 5 * 60_000,
    recordedAt: new Date("2026-08-22T00:00:00Z"),
  };
  const ids = [randomUUID(), randomUUID()];
  await waferLots.insertMany([
    { _id: ids[0], fabId: "M20", product: "HBM", routeMasterId: "M20:HBM", foupCode: "FOUP-CB-A",
      status: "IN_PROGRESS", cohort: "AGGREGATE", currentStepIndex: 0, waferQty: 25,
      createdBy: "test", createdAt: old, updatedAt: old, lastEventAt: old,
      nextStepOperatingMs: timing.operatingEpochMs - 1 } as never,
    { _id: ids[1], fabId: "M20", product: "HBM", routeMasterId: "M20:HBM", foupCode: "FOUP-CB-B",
      status: "IN_PROGRESS", cohort: "AGGREGATE", currentStepIndex: 0, waferQty: 25,
      createdBy: "test", createdAt: old, updatedAt: old, lastEventAt: old,
      nextStepOperatingMs: timing.operatingEpochMs - 1 } as never,
  ]);
  const stepConsumption: StepConsumption = new Map([
    [0, [{ materialId: "GAS-001", equivalentPerWafer: 1 }]],
  ]);

  try {
    // 1) GAS-001이 CRITICAL이면 두 로트 모두 막혀야 하고, materialBlockedAt이 찍혀야 한다
    const blockedResult = await advanceAggregateWip("M20", "HBM", timing, {
      stepConsumption, blockedMaterialIds: new Set(["GAS-001"]),
    });
    assert.ok(blockedResult.blocked >= 2, `테스트 로트 2개가 차단돼야 한다 (blocked=${blockedResult.blocked})`);
    assert.equal(blockedResult.advancedFromStepIndex[0] ?? 0, 0, "차단된 로트는 advancedFromStepIndex에 안 잡혀야 한다");

    const afterBlock = await waferLots.find({ _id: { $in: ids } }).toArray();
    for (const lot of afterBlock) {
      assert.equal(lot.currentStepIndex, 0, "차단된 로트는 스텝이 그대로여야 한다");
      assert.ok(lot.materialBlockedAt, "materialBlockedAt이 기록돼야 한다");
      assert.equal(lot.lastEventAt?.getTime(), old.getTime(), "차단은 감사용 마지막 진행시각을 바꾸지 않는다");
      assert.ok((lot.nextStepOperatingMs ?? 0) > timing.operatingEpochMs, "차단 시간은 cycle time 지연으로 반영한다");
    }

    // 2) 재고 회복(더 이상 CRITICAL 아님) 후, 다음 운영 예정시각이 지나면 실제로 진행되고
    //    materialBlockedAt이 지워져야 한다
    await waferLots.updateMany(
      { _id: { $in: ids } },
      { $set: { nextStepOperatingMs: timing.operatingEpochMs - 1 } },
    );
    const recoveredResult = await advanceAggregateWip("M20", "HBM", timing, {
      stepConsumption, blockedMaterialIds: new Set(),
    });
    assert.ok(recoveredResult.advanced >= 2, `회복 후에는 실제로 진행돼야 한다 (advanced=${recoveredResult.advanced})`);

    const afterRecover = await waferLots.find({ _id: { $in: ids } }).toArray();
    for (const lot of afterRecover) {
      assert.equal(lot.currentStepIndex, 1, "회복 후에는 다음 스텝으로 진행돼야 한다");
      assert.equal(lot.materialBlockedAt, undefined, "회복되면 materialBlockedAt이 지워져야 한다");
    }
  } finally {
    await waferLots.deleteMany({ _id: { $in: ids } });
  }
  console.log("✅ 자재 서킷브레이커 DB 통합 테스트 통과 (차단 → 회복 → 재진행)");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
