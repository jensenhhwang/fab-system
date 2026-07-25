import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { collections } from "@/lib/db";
import {
  buildInboundToday,
  type InboundCategory,
  type InboundPlanInput,
  type InboundReceiptInput,
  type MaterialMeta,
} from "@/lib/inbound-today";

export const dynamic = "force-dynamic";

const READ_ROLES = ["ADMIN", "MATERIALS", "LOGISTICS"] as const;

export async function GET() {
  const access = await requireRole(READ_ROLES);
  if (access.error) return access.error;

  try {
    const { inventoryMovements, inboundPlans, materials } = await collections();

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    const [receiptDocs, planDocs, materialDocs] = await Promise.all([
      inventoryMovements
        .find({ type: "RECEIPT", createdAt: { $gte: startOfToday, $lt: startOfTomorrow } })
        .sort({ createdAt: -1 })
        .toArray(),
      inboundPlans
        .find({
          $or: [
            { plannedDate: { $gte: startOfToday, $lt: startOfTomorrow }, status: { $in: ["CONFIRMED", "COMPLETED"] } },
            { plannedDate: { $lt: startOfToday }, status: "CONFIRMED", remainingQuantity: { $gt: 0 } },
          ],
        })
        .sort({ plannedDate: 1 })
        .toArray(),
      materials.find({}).toArray(),
    ]);

    const materialMap: Record<string, MaterialMeta> = {};
    for (const m of materialDocs) {
      materialMap[m._id] = {
        code: m.code,
        name: m.name,
        category: m.category as InboundCategory,
        unit: m.unit,
      };
    }

    const receipts: InboundReceiptInput[] = receiptDocs.map((r) => ({
      materialId: r.materialId,
      quantity: r.quantity,
      createdAt: new Date(r.createdAt).toISOString(),
      inboundPlanId: r.inboundPlanId ?? null,
    }));

    const plans: InboundPlanInput[] = planDocs.map((p) => ({
      id: p._id,
      planNo: p.planNo,
      materialId: p.materialId,
      unit: p.unit,
      plannedDate: new Date(p.plannedDate).toISOString(),
      plannedQuantity: p.plannedQuantity,
      receivedQuantity: p.receivedQuantity,
      remainingQuantity: p.remainingQuantity,
    }));

    const summary = buildInboundToday({
      now: now.toISOString(),
      receipts,
      plans,
      materials: materialMap,
    });

    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "오늘 입고 실적 집계에 실패했습니다." },
      { status: 500 },
    );
  }
}
