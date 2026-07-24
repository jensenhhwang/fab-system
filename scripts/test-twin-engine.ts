import assert from "node:assert/strict";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { collections } from "../src/lib/db";
import { executeTwinTick } from "../src/lib/twin/engine";
import { getOrInitTwinState } from "../src/lib/twin/state";
import { getRouteMaster, expandRouteMaster } from "../src/lib/route-master";
import { buildStepConsumption } from "../src/lib/twin/burn";
import { M20_MATERIAL_CONSUMPTION } from "../src/lib/material-consumption";

async function main() {
  const { waferLots, twinEngineState, inventory, twinPurchaseOrders, twinBurnEvents } = await collections();

  // 라우트에서 "실제로 자재를 소모하는 첫 스텝"과 그 자재를 결정적으로 찾는다
  const rm = await getRouteMaster("M20", "HBM");
  assert.ok(rm, "M20 라우트 마스터 존재");
  const visits = expandRouteMaster(rm!);
  const sc = buildStepConsumption(visits, [...M20_MATERIAL_CONSUMPTION]);
  const firstEntry = [...sc.entries()].sort((a, b) => a[0] - b[0])[0];
  assert.ok(firstEntry, "소모 스텝이 최소 1개 존재");
  const targetStep = firstEntry[0];
  const targetMaterial = firstEntry[1][0].materialId;

  // 엔진 RUNNING + lastTickAt을 하루 전으로(Δt=1일) 세팅
  await getOrInitTwinState();
  const dayAgo = new Date(Date.now() - 86_400_000);
  await twinEngineState.updateOne({ _id: "singleton" },
    { $set: { status: "RUNNING", lastTickAt: dayAgo, lockedBy: null, lockExpiresAt: null } });

  // targetStep에 놓인 AGGREGATE 테스트 로트 삽입(진행 시 targetMaterial 소모)
  const old = new Date(Date.now() - 60_000);
  const lotId = randomUUID();
  await waferLots.insertOne({ _id: lotId, fabId: "M20", product: "HBM", routeMasterId: "M20:HBM",
    foupCode: "FOUP-TWIN-TEST", status: "IN_PROGRESS", cohort: "AGGREGATE",
    currentStepIndex: targetStep, waferQty: 25, createdBy: "test", createdAt: old, updatedAt: old, lastEventAt: old } as never);

  // targetMaterial 재고를 천문학적으로 세팅 → resolveWarehouse가 이 창고를 반드시 선택
  const invId = `${targetMaterial}__WH-TWINTEST`;
  await inventory.updateOne({ _id: invId },
    { $set: { materialId: targetMaterial, warehouseId: "WH-TWINTEST", quantity: 1e12, avgDailyUsage: 0, avgDailyBurn: 0, status: "AVAILABLE" } },
    { upsert: true });
  const before = (await inventory.findOne({ _id: invId }))!.quantity;

  // targetStep에서 소모되지 않는 다른 M20 자재를 골라, "이번 tick에 소모가 없어도 도착 PO는 정산되어야 한다"를 검증
  const allMaterialIds = [...new Set(M20_MATERIAL_CONSUMPTION.map((r) => r.materialId))];
  const burnedAtTargetStep = new Set(firstEntry[1].map((r) => r.materialId));
  const otherMaterial = allMaterialIds.find((id) => !burnedAtTargetStep.has(id));
  assert.ok(otherMaterial, "targetStep에서 소모되지 않는 다른 M20 자재 존재");

  const otherInvId = `${otherMaterial}__WH-TWINTEST-PO`;
  await inventory.updateOne({ _id: otherInvId },
    { $set: { materialId: otherMaterial, warehouseId: "WH-TWINTEST-PO", quantity: 1e12, avgDailyUsage: 0, avgDailyBurn: 0, status: "AVAILABLE" } },
    { upsert: true });
  const otherBefore = (await inventory.findOne({ _id: otherInvId }))!.quantity;

  const poId = randomUUID();
  const poQty = 777;
  await twinPurchaseOrders.insertOne({
    _id: poId, materialId: otherMaterial, qty: poQty, orderedAt: old,
    etaAt: new Date(Date.now() - 3_600_000), leadTimeDays: 7, status: "ORDERED",
  } as never);

  const res = await executeTwinTick(new Date());
  assert.ok(res.advanced >= 1, "AGGREGATE 로트가 진행됨");
  assert.ok((res.burnedByMaterial[targetMaterial] ?? 0) > 0, "targetMaterial이 소모됨");
  const after = (await inventory.findOne({ _id: invId }))!.quantity;
  assert.ok(after < before, "소모로 창고 재고가 감소");

  // 소모가 없었던 otherMaterial도 도착 PO가 정산되어야 한다(회귀: 소모된 자재만 순회하던 버그)
  assert.ok(!(res.burnedByMaterial[otherMaterial!] > 0), "otherMaterial은 이번 tick에 소모되지 않음(전제 확인)");
  const poAfter = await twinPurchaseOrders.findOne({ _id: poId });
  assert.equal(poAfter?.status, "RECEIVED", "소모 없는 자재의 도착 PO도 RECEIVED로 정산됨");
  const otherAfter = (await inventory.findOne({ _id: otherInvId }))!.quantity;
  assert.ok(otherAfter >= otherBefore + poQty, "도착 PO 수량만큼 재고 증가");

  // 정리
  await waferLots.deleteMany({ _id: lotId });
  await inventory.deleteMany({ _id: invId });
  await inventory.deleteMany({ _id: otherInvId });
  await twinPurchaseOrders.deleteMany({ materialId: targetMaterial, orderedAt: { $gte: old } });
  await twinPurchaseOrders.deleteMany({ _id: poId });
  await twinBurnEvents.deleteMany({ materialId: targetMaterial, tickAt: { $gte: old } });
  console.log("✅ twin engine tick passed");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
