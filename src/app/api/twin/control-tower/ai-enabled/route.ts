import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { getControlTowerAIEnabled, setControlTowerAIEnabled } from "@/lib/control-tower-episode-server";

export const dynamic = "force-dynamic";

// 관제탑 AI 판단 수동 ON/OFF — 켜면 LLM 포함 판단, 끄면 규칙 엔진(하드코딩) 판정만 표시.
export async function POST(request: Request) {
  const access = await requireRole(WRITE_ROLES.simulation);
  if (access.error) return access.error;

  const body = await request.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled(boolean)이 필요합니다." }, { status: 400 });
  }

  await setControlTowerAIEnabled(body.enabled, access.user.id);
  return NextResponse.json({ enabled: body.enabled });
}

export async function GET() {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const enabled = await getControlTowerAIEnabled();
  return NextResponse.json({ enabled });
}
