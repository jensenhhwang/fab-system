import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { getOrInitSimState } from "@/lib/sim-runner";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const speedMultiplier = body.speedMultiplier ?? 10;
  const { simState } = await collections();
  await getOrInitSimState();
  const now = new Date();
  await simState.updateOne(
    { _id: "singleton" },
    { $set: { status: "RUNNING", speedMultiplier, realStartedAt: now } }
  );
  const updated = await simState.findOne({ _id: "singleton" });
  return NextResponse.json(updated);
}
