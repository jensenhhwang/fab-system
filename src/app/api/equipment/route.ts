import { NextRequest, NextResponse } from "next/server";
import { FAB_IDS, type FabId } from "@/lib/fab-domain";
import { getEquipmentCapacity } from "@/lib/equipment-capacity";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("fab") ?? "M20";
  if (!FAB_IDS.includes(raw as FabId)) return NextResponse.json({ error: "지원하지 않는 Fab" }, { status: 400 });
  return NextResponse.json({ fabId: raw, processes: await getEquipmentCapacity(raw as FabId) }, {
    headers: { "Cache-Control": "no-store" },
  });
}
