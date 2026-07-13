import { NextResponse } from "next/server";
import { collections } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  const { simState, inventoryLots, inventoryMovements, simPurchaseOrders, simEvents } =
    await collections();

  const [lots, movements, pos, events] = await Promise.all([
    inventoryLots.deleteMany({ simulated: true }),
    inventoryMovements.deleteMany({ simulated: true }),
    simPurchaseOrders.deleteMany({ simulated: true }),
    simEvents.deleteMany({ simulated: true }),
  ]);

  await simState.updateOne(
    { _id: "singleton" },
    {
      $set: {
        status: "IDLE",
        simDate: new Date(),
        simStartDate: new Date(),
        realStartedAt: new Date(),
      },
    },
    { upsert: true }
  );

  return NextResponse.json({
    deleted: {
      lots: lots.deletedCount,
      movements: movements.deletedCount,
      pos: pos.deletedCount,
      events: events.deletedCount,
    },
  });
}
