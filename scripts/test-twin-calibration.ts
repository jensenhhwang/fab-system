import assert from "node:assert/strict";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { collections } from "../src/lib/db";
import { executeTwinTick, mergeObservedDailyBurn } from "../src/lib/twin/engine";
import { getOrInitTwinState } from "../src/lib/twin/state";
import { getRouteMaster, expandRouteMaster } from "../src/lib/route-master";
import { buildStepConsumption } from "../src/lib/twin/burn";
import { M20_MATERIAL_CONSUMPTION } from "../src/lib/material-consumption";
import { operatingDaysToMs, operatingMsToDays } from "../src/lib/twin/operating-clock";

async function main() {
  const observed = new Map<string, number>();
  mergeObservedDailyBurn(observed, new Map([["MAT-A", 50]]), 0.5);
  mergeObservedDailyBurn(observed, new Map([["MAT-A", 30]]), 0.25);
  assert.equal(observed.get("MAT-A"), 220, "제품별 100/day + 120/day를 더한다");

  // ── 통합: avgDailyBurn이 wall-clock이 아니라 SIM_DAYS_PER_TICK으로 정규화되는지 ──
  const { waferLots, twinEngineState, inventory, twinPurchaseOrders, twinBurnEvents } = await collections();
  const rm = await getRouteMaster("M20", "HBM");
  assert.ok(rm, "route master 존재");
  const visits = expandRouteMaster(rm!);
  const sc = buildStepConsumption(visits, [...M20_MATERIAL_CONSUMPTION]);
  const [targetStep, consumers] = [...sc.entries()].sort((a, b) => a[0] - b[0])[0];
  const targetMaterial = consumers[0].materialId;

  const now = new Date();
  const wallElapsedMs = 5_000;
  const operatingEpochMs = operatingDaysToMs(10);
  await getOrInitTwinState();
  await twinEngineState.updateOne({ _id: "singleton" },
    { $set: {
      status: "RUNNING",
      lastTickAt: new Date(now.getTime() - wallElapsedMs),
      operatingEpochMs,
      operatingClockWallAt: new Date(now.getTime() - wallElapsedMs),
      wipFlowCarryMs: 0,
      lockedBy: null,
      lockExpiresAt: null,
    } });

  const old = new Date(Date.now() - 60_000);
  const lotId = randomUUID();
  await waferLots.insertOne({ _id: lotId, fabId: "M20", product: "HBM", routeMasterId: "M20:HBM",
    foupCode: "FOUP-CALIB-TEST", status: "IN_PROGRESS", cohort: "AGGREGATE",
    currentStepIndex: targetStep, waferQty: 25, createdBy: "test", createdAt: old, updatedAt: old,
    lastEventAt: new Date(), nextStepOperatingMs: operatingEpochMs + 1 } as never);

  const invId = `${targetMaterial}__WH-CALIBTEST`;
  await inventory.updateOne({ _id: invId },
    { $set: { materialId: targetMaterial, warehouseId: "WH-CALIBTEST", quantity: 1e12, avgDailyUsage: 0, avgDailyBurn: 0, status: "AVAILABLE" } },
    { upsert: true });

  const res = await executeTwinTick(now);
  const burned = res.burnedByMaterial[targetMaterial] ?? 0;
  assert.ok(burned > 0, "targetMaterial 소모 발생");

  const inv = await inventory.findOne({ _id: invId });
  const elapsedOperatingDays = operatingMsToDays(wallElapsedMs * 24);
  const uncappedObservedDaily = burned / elapsedOperatingDays;
  assert.ok((inv?.avgDailyBurn ?? 0) > 0, "avgDailyBurn이 공통 운영시간 관측값으로 갱신된다");
  assert.ok(
    (inv?.avgDailyBurn ?? 0) <= uncappedObservedDaily,
    "설계 상한이 있어도 공통 운영시간으로 정규화한 원관측치를 넘지 않는다",
  );

  await waferLots.deleteMany({ _id: lotId });
  await inventory.deleteMany({ _id: invId });
  await twinPurchaseOrders.deleteMany({ materialId: targetMaterial, orderedAt: { $gte: old } });
  await twinBurnEvents.deleteMany({ materialId: targetMaterial, tickAt: { $gte: old } });
  console.log("✅ twin calibration passed");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
