import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { createReroute, listReroutes } from "@/lib/material-reroute";
import { todayKST } from "@/lib/production-actuals";
import { FAB_IDS, type FabId } from "@/lib/fab-domain";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? todayKST();
  return NextResponse.json(await listReroutes(date), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.materialReroute);
  if (access.error) return access.error;
  const body = await req.json() as {
    materialId?: string; fromFabId?: FabId; toFabId?: FabId; quantity?: number; unit?: string; reason?: string;
  };
  if (!body.materialId) return NextResponse.json({ error: "materialId 필수" }, { status: 400 });
  if (!body.fromFabId || !FAB_IDS.includes(body.fromFabId) || !body.toFabId || !FAB_IDS.includes(body.toFabId)) {
    return NextResponse.json({ error: "fromFabId/toFabId는 M20/M21/M22 중 하나여야 합니다." }, { status: 400 });
  }
  if (typeof body.quantity !== "number" || !(body.quantity > 0)) {
    return NextResponse.json({ error: "quantity는 0보다 큰 숫자여야 합니다." }, { status: 400 });
  }
  if (!body.unit) return NextResponse.json({ error: "unit 필수" }, { status: 400 });
  try {
    const doc = await createReroute({
      materialId: body.materialId, fromFabId: body.fromFabId, toFabId: body.toFabId,
      quantity: body.quantity, unit: body.unit, reason: body.reason, decidedBy: access.user.id,
    });
    return NextResponse.json(doc, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "재배정 기록 실패" }, { status: 409 });
  }
}
