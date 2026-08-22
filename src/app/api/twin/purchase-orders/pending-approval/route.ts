import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections } from "@/lib/db";
import { approvalEscalationTier } from "@/lib/procurement-agent";

export const dynamic = "force-dynamic";

// 김구매 자율등급 L2(위험물·단일소싱)로 승인이 필요한 Twin 발주 목록.
export async function GET() {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const { twinPurchaseOrders, materials } = await collections();
  const pending = await twinPurchaseOrders.find({ status: "PENDING_APPROVAL" }).sort({ orderedAt: 1 }).toArray();
  const materialIds = [...new Set(pending.map((po) => po.materialId))];
  const matDocs = await materials.find({ _id: { $in: materialIds } }).toArray();
  const matById = new Map(matDocs.map((m) => [m._id, m]));

  const items = pending.map((po) => {
    const mat = matById.get(po.materialId);
    const waitingMinutes = Math.round((Date.now() - po.orderedAt.getTime()) / 60_000);
    return {
      id: po._id,
      materialId: po.materialId,
      materialCode: mat?.code ?? po.materialId,
      materialName: mat?.name ?? po.materialId,
      unit: mat?.unit ?? "",
      qty: po.qty,
      orderedAt: po.orderedAt.toISOString(),
      autonomyCeiling: po.autonomyCeiling ?? null,
      autonomyReason: po.autonomyReason ?? null,
      waitingMinutes,
      escalationTier: approvalEscalationTier(waitingMinutes),
    };
  });

  return NextResponse.json({
    items,
    urgentCount: items.filter((i) => i.escalationTier === "URGENT").length,
  }, { headers: { "Cache-Control": "no-store" } });
}
