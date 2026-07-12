import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { collections, type InventoryStatus } from "@/lib/db";

const ALLOWED = new Set<InventoryStatus>(["AVAILABLE", "HOLD", "QUARANTINE"]);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json() as { handlingUnitId?: string; status?: InventoryStatus; reason?: string };
  if (!body.handlingUnitId || !body.status || !ALLOWED.has(body.status)) return NextResponse.json({ error: "잘못된 상태 요청" }, { status: 400 });
  if (body.status !== "AVAILABLE" && !body.reason?.trim()) return NextResponse.json({ error: "Hold/격리 사유가 필요합니다" }, { status: 400 });
  const { handlingUnits, inventoryLots, inventory, inventoryMovements } = await collections();
  const unit = await handlingUnits.findOne({ _id: body.handlingUnitId });
  if (!unit) return NextResponse.json({ error: "용기를 찾을 수 없습니다" }, { status: 404 });
  const now = new Date();
  const lotStatusUpdate = body.status === "AVAILABLE"
    ? inventoryLots.updateOne({ _id: unit.inventoryLotId }, { $set: { qualityStatus: body.status, updatedAt: now }, $unset: { holdReason: "" } })
    : inventoryLots.updateOne({ _id: unit.inventoryLotId }, { $set: { qualityStatus: body.status, holdReason: body.reason, updatedAt: now } });
  await Promise.all([
    handlingUnits.updateOne({ _id: unit._id }, { $set: { status: body.status, updatedAt: now } }),
    lotStatusUpdate,
    inventory.updateOne({ materialId: unit.materialId, warehouseId: unit.warehouseId }, { $set: { status: body.status } }),
    inventoryMovements.insertOne({ _id: crypto.randomUUID(), handlingUnitId: unit._id, materialId: unit.materialId,
      type: body.status === "AVAILABLE" ? "RELEASE" : body.status, fromLocationId: unit.locationId, toLocationId: unit.locationId,
      quantity: unit.quantity, reason: body.reason?.trim(), userId: session.user.id ?? session.user.email ?? "unknown", createdAt: now }),
  ]);
  return NextResponse.json({ ok: true, status: body.status });
}
