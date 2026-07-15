import { NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const access = await requireRole(WRITE_ROLES.simulation);
  if (access.error) return access.error;
  const { simState } = await collections();
  await simState.updateOne({ _id: "singleton" }, { $set: { status: "PAUSED" } });
  return NextResponse.json({ ok: true });
}
