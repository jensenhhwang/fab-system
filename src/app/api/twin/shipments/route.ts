import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections } from "@/lib/db";
import { parseShipmentRequest } from "@/lib/shipment-request";
import { getOrInitTwinState } from "@/lib/twin/state";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const { shipments, customers } = await collections();
  const list = await shipments.find({}).sort({ shippedAt: -1 }).limit(20).toArray();
  const customerDocs = await customers.find({ _id: { $in: list.map((s) => s.customerId) } }).toArray();
  const customerMap = new Map(customerDocs.map((c) => [c._id, c]));

  return NextResponse.json({
    shipments: list.map((s) => ({
      _id: s._id, customerId: s.customerId, customerName: customerMap.get(s.customerId)?.name ?? s.customerId,
      // 3제품 출하가 열렸으므로 어느 제품이 나갔는지가 목록에서 구분돼야 한다.
      product: s.product, fabId: s.fabId,
      quantity: s.quantity, unit: s.unit, shippedAt: s.shippedAt.toISOString(),
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

// 가상 고객사에게 완제품을 출하 처리한다 — finishedGoods 재고를 차감하고 shipments에
// 기록한다. AI 자동 우선순위 판단(패브가 데이터 부재로 보류시킨 부분)은 없고, 사람이
// 직접 고객·수량을 선택하는 수동 액션이다.
export async function POST(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const parsed = parseShipmentRequest(await req.json().catch(() => ({})));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { customerId, quantity, product, fabId, warehouseId, unit, finishedGoodsId } = parsed;

  const { customers, finishedGoods, shipments } = await collections();
  const customer = await customers.findOne({ _id: customerId });
  if (!customer) return NextResponse.json({ error: "고객사를 찾을 수 없습니다." }, { status: 404 });

  // 재고 차감을 먼저 조건부로 선점한다 — quantity 조건이 매칭돼야만 차감되므로, 동시 출하나
  // tick의 적립과 겹쳐도 재고가 음수로 내려가지 않는다.
  const result = await finishedGoods.updateOne(
    { _id: finishedGoodsId, quantity: { $gte: quantity } },
    { $inc: { quantity: -quantity }, $set: { updatedAt: new Date() } },
  );
  if (!result.modifiedCount) {
    return NextResponse.json({ error: `가용 ${product} 재고가 부족합니다.` }, { status: 409 });
  }

  const now = new Date();
  // 사람이 낸 출하도 운영시각을 남긴다 — 빠뜨리면 이행률 집계(운영월 창)에서 통째로 빠진다.
  const twinState = await getOrInitTwinState();
  const shipment = {
    _id: randomUUID(), fabId, product,
    warehouseId, customerId, quantity, unit,
    shippedAt: now, shippedOperatingMs: twinState.operatingEpochMs ?? 0, shippedBy: access.user.id,
  };
  await shipments.insertOne(shipment);

  return NextResponse.json({ ok: true, shipment: { ...shipment, shippedAt: shipment.shippedAt.toISOString() } });
}
