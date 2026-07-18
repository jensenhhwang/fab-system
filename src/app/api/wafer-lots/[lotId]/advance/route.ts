import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { advanceLotStep } from "@/lib/lot-route";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ lotId: string }> }) {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;
  const { lotId } = await params;
  const body = await req.json() as { idempotencyKey?: string };
  if (!body.idempotencyKey?.trim()) {
    return NextResponse.json({ error: "idempotencyKey 필수" }, { status: 400 });
  }
  try {
    const state = await advanceLotStep(lotId, access.user.id, body.idempotencyKey);
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "스텝 확인 처리 실패" }, { status: 409 });
  }
}
