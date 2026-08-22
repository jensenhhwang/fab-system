import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { releaseTwinInboundHold, TwinInboundHoldDecisionError } from "@/lib/twin/inbound-hold-decision-server";

export const dynamic = "force-dynamic";

// 박물류 CAPACITY_OVER로 INBOUND_HOLD에 묶인 화물을 실제로 입고 반영(RELEASE 단일 액션).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireRole(WRITE_ROLES.inventoryReceipt);
  if (access.error) return access.error;
  const { id } = await params;
  try {
    const purchaseOrder = await releaseTwinInboundHold({ purchaseOrderId: id, actorId: access.user.id });
    return NextResponse.json({ purchaseOrder });
  } catch (error) {
    if (error instanceof TwinInboundHoldDecisionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "입고 반영 처리 실패" }, { status: 409 });
  }
}
