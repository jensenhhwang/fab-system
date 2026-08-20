import { NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { evaluateServerReadiness } from "@/lib/server-health";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = new Date();
  try {
    const { twinEngineState } = await collections();
    const state = await twinEngineState.findOne({ _id: "singleton" });
    const view = evaluateServerReadiness({ now, dbConnected: true, state });
    return NextResponse.json(view, {
      status: view.status === "READY" ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    const view = evaluateServerReadiness({ now, dbConnected: false, state: null });
    return NextResponse.json(view, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
