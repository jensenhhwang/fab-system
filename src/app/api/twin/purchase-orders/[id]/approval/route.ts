import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { decideTwinPurchaseOrder, TwinPurchaseOrderDecisionError } from "@/lib/twin/purchase-order-decision-server";

export const dynamic = "force-dynamic";

// 김구매 자율등급 L2(위험물·단일소싱)로 PENDING_APPROVAL에 묶인 Twin 발주의 승인/반려.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireRole(WRITE_ROLES.procurementApproval);
  if (access.error) return access.error;
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { action?: "APPROVE" | "REJECT" };
  if (body.action !== "APPROVE" && body.action !== "REJECT") {
    return NextResponse.json({ error: "action은 APPROVE 또는 REJECT여야 합니다." }, { status: 400 });
  }
  try {
    const purchaseOrder = await decideTwinPurchaseOrder({
      purchaseOrderId: id,
      action: body.action,
      actorId: access.user.id,
    });
    return NextResponse.json({ purchaseOrder });
  } catch (error) {
    if (error instanceof TwinPurchaseOrderDecisionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "발주 승인 처리 실패" }, { status: 409 });
  }
}
