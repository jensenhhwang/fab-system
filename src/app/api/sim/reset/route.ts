import { NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const access = await requireRole(WRITE_ROLES.simulation);
  if (access.error) return access.error;
  const { simState, inventoryLots, inventoryMovements, simPurchaseOrders, simEvents, simCheckpoints } =
    await collections();

  // 가장 오래된 체크포인트(기준선)로 실제 lot 수량 복원
  const baseline = await simCheckpoints.findOne({}, { sort: { simDate: 1 } });
  if (baseline) {
    await Promise.all(
      baseline.realLotStates.map(s =>
        inventoryLots.updateOne(
          { _id: s.lotId },
          { $set: { availableQuantity: s.availableQuantity, qualityStatus: s.qualityStatus, updatedAt: new Date() } }
        )
      )
    );
  }

  const [lots, movements, pos, events, checkpoints] = await Promise.all([
    inventoryLots.deleteMany({ simulated: true }),
    inventoryMovements.deleteMany({ simulated: true }),
    simPurchaseOrders.deleteMany({ simulated: true }),
    simEvents.deleteMany({ simulated: true }),
    simCheckpoints.deleteMany({}),
  ]);

  const today = new Date();
  await simState.updateOne(
    { _id: "singleton" },
    {
      $set: {
        status: "IDLE",
        simDate: today,
        simStartDate: today,
        realStartedAt: today,
        speedMultiplier: 1,
      },
    },
    { upsert: true }
  );

  return NextResponse.json({
    restored: baseline ? baseline.realLotStates.length : 0,
    deleted: {
      lots: lots.deletedCount,
      movements: movements.deletedCount,
      pos: pos.deletedCount,
      events: events.deletedCount,
      checkpoints: checkpoints.deletedCount,
    },
  });
}
