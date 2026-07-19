import "dotenv/config";
import { randomUUID } from "crypto";
import assert from "node:assert/strict";
import { collections } from "../src/lib/db";
import { reserveM20PilotMaterial } from "../src/lib/m20-agent-service";

const ACTOR = "test-script:hu-split-reservation";

// reserveM20PilotMaterial이 정확히 plannedQty와 같은 quantity의 HU만 찾던 버그를 검증한다.
// 시나리오: lot엔 130kg짜리 HU 하나뿐인데 BOM은 98kg만 필요 — 재고는 충분하지만 팩 사이즈가 안 맞는 상황.
async function main() {
  const { workOrders, materialAllocations, transferOrders, inventoryLots, handlingUnits, materialFlowEvents } = await collections();

  const materialId = `TEST-SPLIT-${randomUUID().slice(0, 8)}`;
  const warehouseId = "WH-M20-TEST";
  const locationId = "WH-M20-TEST__A1";
  const lotId = randomUUID();
  const bigHuId = randomUUID();
  const woId = randomUUID();
  const allocationId = randomUUID();
  const transferId = randomUUID();
  const now = new Date();
  const plannedQty = 98;
  const huQuantity = 130;

  const cleanup = async () => {
    await Promise.all([
      workOrders.deleteOne({ _id: woId }),
      materialAllocations.deleteOne({ _id: allocationId }),
      transferOrders.deleteOne({ _id: transferId }),
      inventoryLots.deleteOne({ _id: lotId }),
      handlingUnits.deleteMany({ inventoryLotId: lotId }),
      materialFlowEvents.deleteMany({ workOrderId: woId }),
    ]);
  };

  await cleanup();
  try {
    await inventoryLots.insertOne({
      _id: lotId, materialId, lotNo: `LOT-${materialId}`, quantity: huQuantity, availableQuantity: huQuantity,
      qualityStatus: "AVAILABLE", warehouseId, receivedAt: now, expiryDate: new Date(now.getTime() + 30 * 86400000),
      updatedAt: now,
    });
    await handlingUnits.insertOne({
      _id: bigHuId, inventoryLotId: lotId, materialId, warehouseId, locationId,
      containerType: "PALLET", quantity: huQuantity, status: "AVAILABLE", logisticsStatus: "STORED", updatedAt: now,
    });
    await workOrders.insertOne({
      _id: woId, fabId: "M20", processCode: "P10", product: "HBM", plannedQty, scope: "M20_PILOT",
      status: "QUEUED", bomLines: [{ materialId, plannedQty, pickedQty: 0, consumedQty: 0, actualQty: 0, pickedLots: [] }],
      createdBy: ACTOR, createdAt: now, updatedAt: now,
    });
    await materialAllocations.insertOne({
      _id: allocationId, materialId, fabId: "M20", quantity: plannedQty, unit: "kg", status: "PLANNED",
      sourceFacilityId: warehouseId, destinationFacilityId: `FAB-M20__LINE-P10`, workOrderId: woId,
      source: "MES", createdAt: now, updatedAt: now,
    });
    await transferOrders.insertOne({
      _id: transferId, allocationId, materialId, fabId: "M20", quantity: plannedQty, unit: "kg",
      fromFacilityId: warehouseId, toFacilityId: `FAB-M20__LINE-P10`, workOrderId: woId, processCode: "P10",
      status: "CREATED", createdAt: now, updatedAt: now,
    });

    const exactMatch = await handlingUnits.findOne({ inventoryLotId: lotId, quantity: plannedQty });
    assert.equal(exactMatch, null, "테스트 셋업 오류: plannedQty와 정확히 같은 HU가 있으면 안 됩니다");

    const result = await reserveM20PilotMaterial({ workOrderId: woId, actorId: ACTOR });
    assert.equal(result.ok, true);
    assert.equal(result.handlingUnitId, bigHuId, "원래 130kg HU가 예약되어야 합니다");

    const reservedHu = await handlingUnits.findOne({ _id: bigHuId });
    assert.equal(reservedHu?.quantity, plannedQty, "예약된 HU는 plannedQty(98kg)로 잘려야 합니다");
    assert.equal(reservedHu?.logisticsStatus, "RESERVED");
    console.log(`✅ 1) 130kg HU에서 98kg만 예약, 예약된 HU quantity=${reservedHu?.quantity}kg`);

    const remainderHu = await handlingUnits.findOne({ inventoryLotId: lotId, _id: { $ne: bigHuId } });
    assert(remainderHu, "잔량(32kg) HU가 새로 생성되어야 합니다");
    assert.equal(remainderHu.quantity, huQuantity - plannedQty);
    assert.equal(remainderHu.status, "AVAILABLE");
    console.log(`✅ 2) 잔량 HU 신규 생성, quantity=${remainderHu.quantity}kg, status=AVAILABLE`);

    const lot = await inventoryLots.findOne({ _id: lotId });
    const allHus = await handlingUnits.find({ inventoryLotId: lotId }).toArray();
    const unitTotal = allHus.reduce((sum, u) => sum + u.quantity, 0);
    assert.equal(unitTotal, huQuantity, "분할 전후 HU 총량이 보존되어야 합니다");
    assert.equal(lot?.availableQuantity, remainderHu.quantity, "Lot 가용량은 잔량 HU와 일치해야 합니다");
    console.log(`✅ 3) 재고 보존: HU 총량=${unitTotal}kg (분할 전과 동일), lot.availableQuantity=${lot?.availableQuantity}kg`);

    console.log("🎉 HU 분할 예약 시나리오 전체 통과");
  } finally {
    await cleanup();
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
