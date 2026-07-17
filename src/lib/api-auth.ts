import "server-only";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import type { Role } from "@/lib/db";

export const WRITE_ROLES = {
  inventoryReceipt: ["ADMIN", "LOGISTICS"],
  inventoryIssue: ["ADMIN", "MATERIALS"],
  workOrderCreate: ["ADMIN", "PRODUCTION"],
  workOrderStatus: ["ADMIN", "PRODUCTION"],
  workOrderPick: ["ADMIN", "MATERIALS"],
  warehouseStatus: ["ADMIN", "MATERIALS", "LOGISTICS"],
  simulation: ["ADMIN"],
  collaboration: ["ADMIN", "MATERIALS", "PRODUCTION", "LOGISTICS"],
  procurementMaster: ["ADMIN", "MATERIALS"],
  procurementApproval: ["ADMIN", "MATERIALS"],
  inboundPlan: ["ADMIN", "MATERIALS"],
  transferTransition: ["ADMIN", "MATERIALS", "LOGISTICS"],
  materialConsume: ["ADMIN", "PRODUCTION"],
  agentRoleMode: ["ADMIN", "MATERIALS"],
} as const satisfies Record<string, readonly Role[]>;

type AuthorizedUser = { id: string; email?: string | null; role: Role };

export async function requireRole(
  allowed: readonly Role[],
): Promise<{ user: AuthorizedUser; error?: never } | { user?: never; error: NextResponse }> {
  const session = await auth();
  const raw = session?.user as { id?: string; email?: string | null; role?: string } | undefined;
  if (!raw?.id || !raw.role) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!allowed.includes(raw.role as Role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user: { id: raw.id, email: raw.email, role: raw.role as Role } };
}
