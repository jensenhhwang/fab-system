import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { getM20FoupFleetProjection } from "@/lib/foup-wip-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;
  try {
    return NextResponse.json(await getM20FoupFleetProjection(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "M20 FOUP Fleet 조회 실패" }, { status: 409 });
  }
}
