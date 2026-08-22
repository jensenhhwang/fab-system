import "server-only";

import { collections } from "@/lib/db";
import type { TwinPurchaseOrderDoc } from "@/lib/db";
import { increaseInventoryProjection } from "@/lib/inventory-projection";

export class TwinInboundHoldDecisionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "TwinInboundHoldDecisionError";
  }
}

// 박물류 CAPACITY_OVER로 INBOUND_HOLD에 묶인 화물을 사람이 확인 후 실제로 입고 반영한다.
// 김구매 승인(decideTwinPurchaseOrder)과 달리 상태만 바꾸면 안 된다 — 직접 재고를 반영해야
// 한다. 이미 물리적으로 도착한 화물이라 반려(REJECT) 개념은 없다.
//
// settleArrivals(twin/inbound.ts)도 이제 매 tick INBOUND_HOLD를 재정산해서, 사람이 여기서
// 수동으로 해제하는 것과 twin tick이 같은 PO를 동시에 처리할 수 있다(둘 다 twin 락을 공유하지
// 않음). 상태 전이(RECEIVED)를 먼저 원자적으로 선점하고, 실패하면(다른 경로가 이미 처리함)
// 재고를 더하지 않고 멈춘다 — 이중 입고 방지. 그래서 재고 반영보다 상태 전이가 먼저다.
export async function releaseTwinInboundHold(input: {
  purchaseOrderId: string;
  actorId: string;
}): Promise<TwinPurchaseOrderDoc> {
  const { twinPurchaseOrders } = await collections();
  const po = await twinPurchaseOrders.findOne({ _id: input.purchaseOrderId });
  if (!po) throw new TwinInboundHoldDecisionError("PO_NOT_FOUND", "발주를 찾을 수 없습니다.");
  if (po.status !== "INBOUND_HOLD") {
    throw new TwinInboundHoldDecisionError("PO_NOT_HELD", "입고 보류 상태의 발주만 처리할 수 있습니다.");
  }
  if (!po.destinationWarehouseId) {
    throw new TwinInboundHoldDecisionError("PO_NO_WAREHOUSE", "목적 창고 정보가 없습니다.");
  }

  const now = new Date();
  const claim = await twinPurchaseOrders.updateOne(
    { _id: input.purchaseOrderId, status: "INBOUND_HOLD" },
    { $set: { status: "RECEIVED", releasedAt: now, releasedBy: input.actorId } },
  );
  if (claim.modifiedCount === 0) {
    throw new TwinInboundHoldDecisionError("PO_ALREADY_SETTLED", "이미 다른 경로(자동 정산 또는 다른 요청)로 처리된 발주입니다.");
  }
  await increaseInventoryProjection({
    materialId: po.materialId, warehouseId: po.destinationWarehouseId, quantity: po.qty,
  });

  const updated = await twinPurchaseOrders.findOne({ _id: input.purchaseOrderId });
  if (!updated) throw new TwinInboundHoldDecisionError("PO_NOT_FOUND", "발주를 찾을 수 없습니다.");
  return updated;
}
