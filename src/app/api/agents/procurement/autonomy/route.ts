import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections } from "@/lib/db";
import type { AgentAutonomyLevel } from "@/lib/db";

export const dynamic = "force-dynamic";

const VALID_LEVELS = new Set<AgentAutonomyLevel>([2, 4]);
const VALID_FABS = new Set(["M20", "M21", "M22"]);

// 사람이 에이전트 추천을 승인/조정한 값만 저장한다. 하드 상한(위험물·단일소싱)은
// procurement-agent.ts가 읽을 때 다시 clamp하므로, 여기서 잘못된 값을 넣어도
// 실제 판정에는 절대 상한을 못 넘는다 — 안전 백스탑은 서버 계산 쪽에 있다.
export async function PATCH(request: Request) {
  const access = await requireRole(WRITE_ROLES.agentAutonomyOverride);
  if (access.error) return access.error;

  const body = await request.json().catch(() => null) as {
    materialId?: unknown; fabId?: unknown; level?: unknown;
  } | null;

  const materialId = typeof body?.materialId === "string" ? body.materialId : null;
  const fabId = body?.fabId === null || body?.fabId === undefined ? null
    : typeof body.fabId === "string" && VALID_FABS.has(body.fabId) ? body.fabId as "M20" | "M21" | "M22"
    : undefined;
  const level = typeof body?.level === "number" && VALID_LEVELS.has(body.level as AgentAutonomyLevel)
    ? body.level as AgentAutonomyLevel
    : null;

  if (!materialId || fabId === undefined || level === null) {
    return NextResponse.json({ error: "materialId·fabId(선택)·level(2 또는 4)이 필요합니다." }, { status: 400 });
  }

  const { agentAutonomyOverrides } = await collections();
  const id = `${fabId ?? "ALL"}:${materialId}`;
  const now = new Date();
  await agentAutonomyOverrides.updateOne(
    { _id: id },
    { $set: { materialId, fabId, level, updatedBy: access.user.id, updatedAt: now }, $setOnInsert: { _id: id } },
    { upsert: true },
  );
  return NextResponse.json({ ok: true, materialId, fabId, level });
}

export async function DELETE(request: Request) {
  const access = await requireRole(WRITE_ROLES.agentAutonomyOverride);
  if (access.error) return access.error;

  const { searchParams } = new URL(request.url);
  const materialId = searchParams.get("materialId");
  const fabId = searchParams.get("fabId");
  if (!materialId) return NextResponse.json({ error: "materialId가 필요합니다." }, { status: 400 });

  const { agentAutonomyOverrides } = await collections();
  await agentAutonomyOverrides.deleteOne({ _id: `${fabId ?? "ALL"}:${materialId}` });
  return NextResponse.json({ ok: true });
}
