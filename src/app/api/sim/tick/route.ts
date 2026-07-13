import { NextResponse } from "next/server";
import { executeTickAndPersist } from "@/lib/sim-runner";

export const dynamic = "force-dynamic";

export async function POST() {
  const result = await executeTickAndPersist();
  return NextResponse.json(result);
}
