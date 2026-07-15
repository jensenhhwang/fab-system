import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import type { WorkOrderDoc, WorkOrderStatus } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const ALLOWED_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  QUEUED:        ["MATERIAL_WAIT", "RUNNING", "HOLD"],
  MATERIAL_WAIT: ["QUEUED", "HOLD"],
  RUNNING:       ["DONE", "HOLD"],
  HOLD:          ["QUEUED"],
  DONE:          [],
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await requireRole(WRITE_ROLES.workOrderStatus);
  if (access.error) return access.error;
  const { id } = await params;
  const body = await req.json();
  const { status: nextStatus } = body as { status: WorkOrderStatus };

  const { workOrders } = await collections();
  const wo = await workOrders.findOne({ _id: id });
  if (!wo) return NextResponse.json({ error: "WO 없음" }, { status: 404 });

  const allowed = ALLOWED_TRANSITIONS[wo.status] ?? [];
  if (!allowed.includes(nextStatus)) {
    return NextResponse.json(
      { error: `${wo.status} → ${nextStatus} 전이 불가` },
      { status: 409 }
    );
  }

  const now = new Date();
  const setFields: Partial<WorkOrderDoc> & { updatedAt: Date } = { status: nextStatus, updatedAt: now };
  if (nextStatus === "RUNNING" && !wo.actualStart) setFields.actualStart = now;
  if (nextStatus === "DONE") setFields.actualEnd = now;

  const result = await workOrders.updateOne({ _id: id, status: wo.status }, { $set: setFields });
  if (!result.modifiedCount) return NextResponse.json({ error: "작업지시 상태가 이미 변경되었습니다" }, { status: 409 });
  const updated = await workOrders.findOne({ _id: id });
  return NextResponse.json(updated);
}
