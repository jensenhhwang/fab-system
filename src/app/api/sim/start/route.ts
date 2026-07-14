import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { getOrInitSimState } from "@/lib/sim-runner";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const speedMultiplier = body.speedMultiplier ?? 1;
  const { simState, inventoryLots, simCheckpoints } = await collections();
  const current = await getOrInitSimState();
  const now = new Date();

  // 처음 시작(IDLE)인 경우에만 기준선 체크포인트 저장
  if (current.status === "IDLE") {
    const realLots = await inventoryLots.find({ simulated: { $ne: true }, qualityStatus: { $ne: "CONSUMED" } }).toArray();
    await simCheckpoints.replaceOne(
      { _id: current.simDate.toISOString() },
      {
        simDate: current.simDate,
        createdAt: now,
        realLotStates: realLots.map(l => ({ lotId: l._id, availableQuantity: l.availableQuantity, qualityStatus: l.qualityStatus })),
      } as Parameters<typeof simCheckpoints.replaceOne>[1],
      { upsert: true }
    );
  }

  await simState.updateOne(
    { _id: "singleton" },
    { $set: { status: "RUNNING", speedMultiplier, realStartedAt: now } }
  );
  const updated = await simState.findOne({ _id: "singleton" });
  return NextResponse.json(updated);
}
