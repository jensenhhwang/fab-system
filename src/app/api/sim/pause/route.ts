import { NextResponse } from "next/server";
import { collections } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  const { simState } = await collections();
  await simState.updateOne({ _id: "singleton" }, { $set: { status: "PAUSED" } });
  return NextResponse.json({ ok: true });
}
