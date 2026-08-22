import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import {
  InventoryReceiptError,
  receiveInventory,
} from "@/lib/inventory-receipt-service";
import { parseDateOnly } from "@/lib/inbound-receipt-tasks";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const materialId = searchParams.get("materialId") ?? undefined;
  const warehouseId = searchParams.get("warehouseId") ?? undefined;
  const status = searchParams.get("status") ?? undefined;

  const { inventoryLots } = await collections();
  const filter: Record<string, unknown> = {};
  if (materialId) filter.materialId = materialId;
  if (warehouseId) filter.warehouseId = warehouseId;
  if (status) filter.qualityStatus = status;

  const lots = await inventoryLots.find(filter).sort({ expiryDate: 1, receivedAt: 1 }).toArray();
  return NextResponse.json(lots);
}

export async function POST(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.inventoryReceipt);
  if (access.error) return access.error;

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON 요청 본문이 필요합니다." }, { status: 400 });
  }
  if (body.inboundPlanId) {
    return NextResponse.json({
      error: "계획 입고는 박물류 실물 확인과 이자재 정합 검증을 거쳐야 합니다.",
      code: "INBOUND_RECEIPT_TASK_REQUIRED",
    }, { status: 409 });
  }

  try {
    const result = await receiveInventory({
      materialId: String(body.materialId ?? "").trim(),
      warehouseId: String(body.warehouseId ?? "").trim(),
      slotId: String(body.slotId ?? "").trim() || undefined,
      quantity: Number(body.qty),
      manufactureDate: parseDateOnly(body.mfgDate, "제조일"),
      expiryDate: parseDateOnly(body.expiresAt, "유효기간"),
      lotNo: String(body.lotNo ?? "").trim() || undefined,
      requestId: String(body.requestId ?? "").trim() || undefined,
      actorId: access.user.id,
    });
    return NextResponse.json(
      { id: result.lotId, lotNo: result.lotNo, duplicate: result.duplicate },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof InventoryReceiptError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof Error && error.message.includes("올바르지 않습니다")) {
      return NextResponse.json({ error: error.message, code: "INVALID_DATE" }, { status: 400 });
    }
    throw error;
  }
}
