import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { getAgentRoleModes, setAgentRoleMode } from "@/lib/m20-agent-service";
import type { AgentRole, AgentRoleMode } from "@/lib/db";

export const dynamic = "force-dynamic";

const ROLES: AgentRole[] = ["PROCUREMENT", "WMS", "MES", "PROCESS"];
const MODES: AgentRoleMode[] = ["AGENT", "HUMAN"];

export async function GET() {
  return NextResponse.json(await getAgentRoleModes(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.agentRoleMode);
  if (access.error) return access.error;
  const body = await req.json() as { role?: AgentRole; mode?: AgentRoleMode };
  if (!body.role || !ROLES.includes(body.role)) {
    return NextResponse.json({ error: "role은 PROCUREMENT/WMS/MES/PROCESS 중 하나여야 합니다." }, { status: 400 });
  }
  if (!body.mode || !MODES.includes(body.mode)) {
    return NextResponse.json({ error: "mode는 AGENT 또는 HUMAN이어야 합니다." }, { status: 400 });
  }
  const updated = await setAgentRoleMode(body.role, body.mode, access.user.id);
  return NextResponse.json(updated);
}
