import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { getM20AgentSnapshot, orchestrateM20Agents } from "@/lib/m20-agent-service";

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: Promise<{ workOrderId: string }> }) {
  const { workOrderId } = await params;
  return NextResponse.json(await getM20AgentSnapshot(workOrderId), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(_: NextRequest, { params }: { params: Promise<{ workOrderId: string }> }) {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;
  const { workOrderId } = await params;
  try {
    return NextResponse.json(await orchestrateM20Agents(workOrderId, access.user.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "M20 에이전트 실행 실패" }, { status: 409 });
  }
}
