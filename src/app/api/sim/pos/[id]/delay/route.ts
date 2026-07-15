import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { getOrInitSimState } from "@/lib/sim-runner";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await requireRole(WRITE_ROLES.simulation);
  if (access.error) return access.error;
  const { id } = await params;
  const body = await req.json();
  const days = Math.max(1, parseInt(body.days ?? "3"));
  const { simPurchaseOrders, simEvents } = await collections();
  const po = await simPurchaseOrders.findOne({ _id: id });
  if (!po) return NextResponse.json({ error: "PO 없음" }, { status: 404 });

  await simPurchaseOrders.updateOne({ _id: id }, { $inc: { delayDays: days } });
  const state = await getOrInitSimState();
  await simEvents.insertOne({
    _id: `ev-delay-${Date.now()}`, simDate: state.simDate, type: "DELAY",
    materialId: po.materialId, poId: id,
    note: `수동 지연 +${days}일 (${id})`, simulated: true,
  });
  return NextResponse.json({ ok: true });
}
