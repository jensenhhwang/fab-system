import "dotenv/config";
import assert from "node:assert/strict";
import { collections } from "../src/lib/db";

async function main() {
  const {
    workOrders, transferOrders, materialFlowEvents, handlingUnits, inventoryLots,
    fabMaterialStocks, equipmentMaster, agentRuns, agentDecisions, purchaseOrderDrafts,
    integrationOutbox, equipmentAssignments,
  } = await collections();
  const workOrder = await workOrders.find({ fabId: "M20", scope: "M20_PILOT" }).sort({ createdAt: -1 }).limit(1).next();
  assert(workOrder, "M20 대표 작업지시가 없습니다");
  assert.equal(workOrder.status, "DONE", "M20 대표 작업지시가 완료되지 않았습니다");
  const line = workOrder.bomLines[0];
  assert.equal(line.materialId, "PKG-001");
  assert.equal(line.plannedQty, 98);
  assert.equal(line.pickedQty, 98);
  assert.equal(line.consumedQty, 98);
  const transfer = await transferOrders.findOne({ workOrderId: workOrder._id, materialId: line.materialId });
  assert(transfer?.handlingUnitId && transfer.lotId, "대표 TransferOrder의 Lot/HU 연결이 없습니다");
  assert.equal(transfer.status, "DELIVERED");
  const events = await materialFlowEvents.find({ workOrderId: workOrder._id }).sort({ sequence: 1 }).toArray();
  assert.deepEqual(events.map((event) => event.type), ["ALLOCATED", "PICKING_STARTED", "PICKED", "STAGED", "DISPATCHED", "RECEIVED", "DELIVERED", "CONSUMED"]);
  assert.equal(new Set(events.map((event) => event.requestId)).size, 8, "이벤트 requestId가 중복됐습니다");
  const handlingUnit = await handlingUnits.findOne({ _id: transfer.handlingUnitId });
  assert.equal(handlingUnit?.logisticsStatus, "CONSUMED");
  assert.equal(handlingUnit?.status, "CONSUMED");
  const lot = await inventoryLots.findOne({ _id: transfer.lotId });
  assert(lot, "대표 Lot가 없습니다");
  const lotUnits = await handlingUnits.find({ inventoryLotId: lot._id }).toArray();
  const unitTotal = lotUnits.reduce((sum, unit) => sum + unit.quantity, 0);
  const consumedFromLot = await materialFlowEvents.aggregate<{ quantity: number }>([
    { $match: { lotId: lot._id, type: "CONSUMED" } },
    { $group: { _id: null, quantity: { $sum: "$quantity" } } },
  ]).next();
  assert.equal(lot.availableQuantity + (consumedFromLot?.quantity ?? 0), unitTotal, "Lot 가용량+누적소비량과 HU 총량이 보존되지 않았습니다");
  const stocks = await fabMaterialStocks.find({ fabId: "M20", processCode: "P10", materialId: "PKG-001" }).toArray();
  assert.equal(stocks.reduce((sum, stock) => sum + stock.quantity, 0), 0, "완료 후 PRS/Line-side 잔량이 0이 아닙니다");
  assert.equal(await equipmentMaster.countDocuments({ fabId: "M20" }), 452, "M20 Equipment Master 대수가 일치하지 않습니다");
  const run = await agentRuns.findOne({ workOrderId: workOrder._id });
  assert.equal(run?.status, "COMPLETED", "M20 AgentRun이 완료되지 않았습니다");
  const roles = await agentDecisions.distinct("agentRole", { workOrderId: workOrder._id });
  assert.deepEqual([...roles].sort(), ["MES", "PROCESS", "PROCUREMENT", "WMS"]);
  const po = await purchaseOrderDrafts.findOne({ sourceWorkOrderId: workOrder._id });
  assert.equal(po?.status, "OUTBOXED", "발주 초안이 승인·Outbox 적재되지 않았습니다");
  assert(await integrationOutbox.findOne({ aggregateId: po?._id }), "승인된 PO의 Outbox가 없습니다");
  assert.equal((await equipmentAssignments.findOne({ workOrderId: workOrder._id }))?.status, "COMPLETED", "장비 배정이 완료되지 않았습니다");
  console.log(`✅ M20 agent ledger verified: ${workOrder._id}, 98kg, 8 events, 4 agents, 452 tools`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
