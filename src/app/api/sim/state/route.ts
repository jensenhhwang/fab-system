import { NextResponse } from "next/server";
import { getOrInitSimState } from "@/lib/sim-runner";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getOrInitSimState();
  return NextResponse.json(state);
}
