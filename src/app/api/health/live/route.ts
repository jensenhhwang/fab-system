import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const startedAt = new Date();

export async function GET() {
  return NextResponse.json(
    {
      status: "LIVE",
      startedAt: startedAt.toISOString(),
      checkedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
