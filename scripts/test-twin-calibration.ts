import assert from "node:assert/strict";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { collections } from "../src/lib/db";
import { executeTwinTick, simDaysPerTick } from "../src/lib/twin/engine";
import { getOrInitTwinState } from "../src/lib/twin/state";
import { getRouteMaster, expandRouteMaster } from "../src/lib/route-master";
import { buildStepConsumption } from "../src/lib/twin/burn";
import { M20_MATERIAL_CONSUMPTION } from "../src/lib/material-consumption";

async function main() {
  // ── 순수 함수: 한 tick = 공정 스텝 1개 진행분 = cycleDays/totalSteps sim-days ──
  const s = simDaysPerTick(105, 130);
  assert.ok(Math.abs(s - 105 / 130) < 1e-9, "simDaysPerTick = cycleDays/totalSteps");
  assert.ok(s > 0.5 && s < 1.0, "한 스텝 sim-time은 0.5~1일 범위 (105/130≈0.808)");
  // 예전 실벽시계(5초=5.79e-5일) 대비 수천 배 커야 왜곡 제거됨
  assert.ok(s / (5000 / 86_400_000) > 10_000, "실벽시계 5초 대비 1만배 이상 → 왜곡 제거");

  // ── 통합: avgDailyBurn이 wall-clock이 아니라 SIM_DAYS_PER_TICK으로 정규화되는지 ──
  const { waferLots, twinEngineState, inventory, twinPurchaseOrders, twinBurnEvents } = await collections();
  const rm = await getRouteMaster("M20", "HBM");
  assert.ok(rm, "route master 존재");
  const visits = expandRouteMaster(rm!);
  const totalSteps = visits.length;
  const sc = buildStepConsumption(visits, [...M20_MATERIAL_CONSUMPTION]);
  const [targetStep, consumers] = [...sc.entries()].sort((a, b) => a[0] - b[0])[0];
  const targetMaterial = consumers[0].materialId;

  await getOrInitTwinState();
  await twinEngineState.updateOne({ _id: "singleton" },
    { $set: { status: "RUNNING", lastTickAt: new Date(Date.now() - 5_000), lockedBy: null, lockExpiresAt: null } });

  const old = new Date(Date.now() - 60_000);
  const lotId = randomUUID();
  await waferLots.insertOne({ _id: lotId, fabId: "M20", product: "HBM", routeMasterId: "M20:HBM",
    foupCode: "FOUP-CALIB-TEST", status: "IN_PROGRESS", cohort: "AGGREGATE",
    currentStepIndex: targetStep, waferQty: 25, createdBy: "test", createdAt: old, updatedAt: old, lastEventAt: old } as never);

  const invId = `${targetMaterial}__WH-CALIBTEST`;
  await inventory.updateOne({ _id: invId },
    { $set: { materialId: targetMaterial, warehouseId: "WH-CALIBTEST", quantity: 1e12, avgDailyUsage: 0, avgDailyBurn: 0, status: "AVAILABLE" } },
    { upsert: true });

  const res = await executeTwinTick(new Date());
  const burned = res.burnedByMaterial[targetMaterial] ?? 0;
  assert.ok(burned > 0, "targetMaterial 소모 발생");

  const inv = await inventory.findOne({ _id: invId });
  const expected = burned / simDaysPerTick(105, totalSteps); // EMA bootstrap(prev=0)이라 첫 tick은 정확히 이 값
  assert.ok(Math.abs((inv?.avgDailyBurn ?? 0) - expected) < 1e-6,
    `avgDailyBurn은 SIM_DAYS_PER_TICK 정규화값이어야 함 (기대 ${expected}, 실제 ${inv?.avgDailyBurn})`);
  // 왜곡 회귀 가드: wall-clock(5초)였다면 avgDailyBurn ≈ burned*17280. 절대 그 근처면 안 됨.
  assert.ok((inv?.avgDailyBurn ?? 0) < burned * 100, "avgDailyBurn이 실벽시계 폭발값이 아님");

  await waferLots.deleteMany({ _id: lotId });
  await inventory.deleteMany({ _id: invId });
  await twinPurchaseOrders.deleteMany({ materialId: targetMaterial, orderedAt: { $gte: old } });
  await twinBurnEvents.deleteMany({ materialId: targetMaterial, tickAt: { $gte: old } });
  console.log("✅ twin calibration passed");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
