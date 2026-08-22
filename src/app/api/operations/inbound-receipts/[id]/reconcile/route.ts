import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import {
  InboundReceiptTaskError,
  reconcileInboundReceipt,
} from "@/lib/inbound-receipt-task-server";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await requireRole(WRITE_ROLES.inventoryReconcile);
  if (access.error) return access.error;
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON 요청 본문이 필요합니다.", code: "INVALID_BODY" }, { status: 400 });
  }
  try {
    const result = await reconcileInboundReceipt({ taskId: id, actorId: access.user.id, body });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof InboundReceiptTaskError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("[inbound-receipt] reconciliation failed", error);
    return NextResponse.json({ error: "재고 정합 반영에 실패했습니다." }, { status: 500 });
  }
}
