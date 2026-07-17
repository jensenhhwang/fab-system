import { NextResponse } from "next/server";
import { getLiveTransfers } from "@/lib/live-transfer-query";

export const dynamic = "force-dynamic";

export async function GET() {
  const transfers = await getLiveTransfers();
  return NextResponse.json({ transfers, serverTime: new Date().toISOString() }, {
    headers: { "Cache-Control": "no-store" },
  });
}
