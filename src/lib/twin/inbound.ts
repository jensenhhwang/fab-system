// 지수이동평균. prevEma가 0이면 첫 관측값을 그대로 채택한다.
export function updateBurnEma(prevEma: number, observedDailyBurn: number, alpha: number): number {
  if (prevEma <= 0) return observedDailyBurn;
  return alpha * observedDailyBurn + (1 - alpha) * prevEma;
}

// 현재고+입고중이 ROP 미만이면 rop*2까지 채우는 재주문량을 반환. 소모가 없으면 발주하지 않는다.
export function planInbound(input: {
  onHand: number; inTransit: number; avgDailyBurn: number; ropDays: number;
}): { qty: number } | null {
  if (input.avgDailyBurn <= 0) return null;
  const rop = input.avgDailyBurn * input.ropDays;
  const position = input.onHand + input.inTransit;
  if (position >= rop) return null;
  const qty = Math.ceil(rop * 2 - position);
  return qty > 0 ? { qty } : null;
}

export function settleArrivals(
  pos: { _id: string; etaAt: Date; qty: number; materialId: string; status: string }[],
  now: Date,
): { receipts: { poId: string; materialId: string; qty: number }[]; arrivedPoIds: string[] } {
  const receipts: { poId: string; materialId: string; qty: number }[] = [];
  const arrivedPoIds: string[] = [];
  for (const po of pos) {
    if (po.status === "RECEIVED") continue;
    if (po.etaAt.getTime() <= now.getTime()) {
      receipts.push({ poId: po._id, materialId: po.materialId, qty: po.qty });
      arrivedPoIds.push(po._id);
    }
  }
  return { receipts, arrivedPoIds };
}
