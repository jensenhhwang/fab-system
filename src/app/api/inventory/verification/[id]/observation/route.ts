import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  InventoryVerificationError,
  VERIFICATION_OBSERVE_ROLES,
} from "@/lib/inventory-verification";
import { submitInventoryObservation } from "@/lib/inventory-verification-server";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await requireRole(VERIFICATION_OBSERVE_ROLES);
  if (access.error) return access.error;
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON 요청 본문이 필요합니다.", code: "INVALID_OBSERVATION" }, { status: 400 });
  }
  try {
    const result = await submitInventoryObservation({
      caseId: id,
      actorId: access.user.id,
      body,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof InventoryVerificationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("[inventory-verification] observation failed", error);
    return NextResponse.json({ error: "현장 관측 제출에 실패했습니다." }, { status: 500 });
  }
}
