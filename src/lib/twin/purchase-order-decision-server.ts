import "server-only";

import { collections } from "@/lib/db";
import type { TwinPurchaseOrderDoc } from "@/lib/db";
import { getOrInitTwinState } from "@/lib/twin/state";
import { operatingDaysToMs, OPERATING_SPEED_MULTIPLIER } from "@/lib/twin/operating-clock";

export class TwinPurchaseOrderDecisionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "TwinPurchaseOrderDecisionError";
  }
}

// 김구매 자율등급 L2(위험물·단일소싱)로 PENDING_APPROVAL에 묶인 발주를 사람이 승인/반려한다.
// 승인 시에는 그 순간부터 리드타임이 시작된다 — Twin이 자동으로 낸 원래 orderedAt 기준이 아니라,
// 실제로 승인이 난 시점 기준으로 etaAt을 다시 계산한다(승인 전까지는 진짜로 발주가 안 나간 것).
export async function decideTwinPurchaseOrder(input: {
  purchaseOrderId: string;
  action: "APPROVE" | "REJECT";
  actorId: string;
}): Promise<TwinPurchaseOrderDoc> {
  const { twinPurchaseOrders } = await collections();
  const po = await twinPurchaseOrders.findOne({ _id: input.purchaseOrderId });
  if (!po) throw new TwinPurchaseOrderDecisionError("PO_NOT_FOUND", "발주를 찾을 수 없습니다.");
  if (po.status !== "PENDING_APPROVAL") {
    throw new TwinPurchaseOrderDecisionError("PO_NOT_PENDING", "승인 대기 상태의 발주만 처리할 수 있습니다.");
  }

  const now = new Date();
  if (input.action === "REJECT") {
    await twinPurchaseOrders.updateOne(
      { _id: input.purchaseOrderId, status: "PENDING_APPROVAL" },
      { $set: { status: "REJECTED", decidedAt: now, decidedBy: input.actorId } },
    );
  } else {
    // 리드타임은 운영시간이다 — 도착 판정 근거는 etaOperatingMs이고, etaAt은 화면 표시용
    // 벽시계 환산이다(RULES.md § Twin 운영시간).
    const state = await getOrInitTwinState();
    const etaOperatingMs = (state.operatingEpochMs ?? 0) + operatingDaysToMs(po.leadTimeDays);
    const etaAt = new Date(now.getTime() + operatingDaysToMs(po.leadTimeDays) / OPERATING_SPEED_MULTIPLIER);
    await twinPurchaseOrders.updateOne(
      { _id: input.purchaseOrderId, status: "PENDING_APPROVAL" },
      { $set: { status: "ORDERED", orderedAt: now, etaAt, etaOperatingMs, decidedAt: now, decidedBy: input.actorId } },
    );
  }

  const updated = await twinPurchaseOrders.findOne({ _id: input.purchaseOrderId });
  if (!updated) throw new TwinPurchaseOrderDecisionError("PO_NOT_FOUND", "발주를 찾을 수 없습니다.");
  return updated;
}
