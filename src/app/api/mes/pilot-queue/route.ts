import { NextRequest, NextResponse } from "next/server";
import { listPilotQueue } from "@/lib/pilot-queue";
import type { FabId } from "@/lib/fab-domain";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const fabId = req.nextUrl.searchParams.get("fabId") as FabId | null;
  const items = await listPilotQueue(fabId ?? undefined);
  return NextResponse.json(items, { headers: { "Cache-Control": "no-store" } });
}
