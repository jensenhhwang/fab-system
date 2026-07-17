import { NextRequest, NextResponse } from "next/server";
import { collections, getMongoClient, type InventoryStatus } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";

const ALLOWED = new Set<InventoryStatus>(["AVAILABLE", "HOLD", "QUARANTINE"]);

export async function POST(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.warehouseStatus);
  if (access.error) return access.error;
  const body = await req.json() as { handlingUnitId?: string; status?: InventoryStatus; reason?: string };
  if (!body.handlingUnitId || !body.status || !ALLOWED.has(body.status)) return NextResponse.json({ error: "잘못된 상태 요청" }, { status: 400 });
  if (body.status !== "AVAILABLE" && !body.reason?.trim()) return NextResponse.json({ error: "Hold/격리 사유가 필요합니다" }, { status: 400 });
  const { handlingUnits, inventoryLots, inventoryMovements } = await collections();
  const unit = await handlingUnits.findOne({ _id: body.handlingUnitId });
  if (!unit) return NextResponse.json({ error: "용기를 찾을 수 없습니다" }, { status: 404 });
  const now = new Date();
  const client = await getMongoClient();
  const dbSession = client.startSession();
  try {
    await dbSession.withTransaction(async () => {
      const lotStatusUpdate = body.status === "AVAILABLE"
        ? inventoryLots.updateOne({ _id: unit.inventoryLotId }, { $set: { qualityStatus: body.status, updatedAt: now }, $unset: { holdReason: "" } }, { session: dbSession })
        : inventoryLots.updateOne({ _id: unit.inventoryLotId }, { $set: { qualityStatus: body.status, holdReason: body.reason, updatedAt: now } }, { session: dbSession });
      await Promise.all([
        handlingUnits.updateOne({ _id: unit._id }, { $set: { status: body.status, updatedAt: now } }, { session: dbSession }),
        lotStatusUpdate,
        inventoryMovements.insertOne({ _id: crypto.randomUUID(), handlingUnitId: unit._id, materialId: unit.materialId,
      type: body.status === "AVAILABLE" ? "RELEASE" : body.status as "HOLD" | "QUARANTINE", fromLocationId: unit.locationId, toLocationId: unit.locationId,
          quantity: unit.quantity, reason: body.reason?.trim(), userId: access.user.id, createdAt: now }, { session: dbSession }),
      ]);
    });
  } finally {
    await dbSession.endSession();
  }
  return NextResponse.json({ ok: true, status: body.status });
}
