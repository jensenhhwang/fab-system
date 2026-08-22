import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { listInboundReceiptTasks } from "@/lib/inbound-receipt-task-server";

export const dynamic = "force-dynamic";

const READ_ROLES = ["ADMIN", "MATERIALS", "LOGISTICS"] as const;

export async function GET() {
  const access = await requireRole(READ_ROLES);
  if (access.error) return access.error;
  const tasks = await listInboundReceiptTasks();
  return NextResponse.json({
    tasks,
    capabilities: {
      physicalConfirm: (WRITE_ROLES.physicalReceiptConfirm as readonly string[]).includes(access.user.role),
      reconcile: (WRITE_ROLES.inventoryReconcile as readonly string[]).includes(access.user.role),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
