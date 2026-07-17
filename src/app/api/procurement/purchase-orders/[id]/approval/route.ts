import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { decidePurchaseOrder, orchestrateM20Agents } from "@/lib/m20-agent-service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireRole(WRITE_ROLES.procurementApproval);
  if (access.error) return access.error;
  const { id } = await params;
  const body = await req.json() as { action?: "APPROVE" | "REJECT"; reason?: string };
  if (body.action !== "APPROVE" && body.action !== "REJECT") {
    return NextResponse.json({ error: "action은 APPROVE 또는 REJECT여야 합니다." }, { status: 400 });
  }
  try {
    const result = await decidePurchaseOrder({
      purchaseOrderId: id,
      action: body.action,
      actorId: access.user.id,
      reason: body.reason,
    });
    if (result.purchaseOrder?.sourceWorkOrderId) {
      await orchestrateM20Agents(result.purchaseOrder.sourceWorkOrderId, access.user.id);
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "발주 승인 처리 실패" }, { status: 409 });
  }
}
