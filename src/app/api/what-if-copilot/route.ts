import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import type { WhatIfCopilotActionStatus } from "@/lib/db";
import {
  normalizeWhatIfRequest,
} from "@/lib/what-if-copilot";
import {
  getWhatIfCopilot,
  setWhatIfCopilotAction,
} from "@/lib/what-if-copilot-server";

export const dynamic = "force-dynamic";

const COPILOT_ROLES = ["ADMIN", "MATERIALS"] as const;
const ACTION_STATUSES = new Set<WhatIfCopilotActionStatus>([
  "NEW",
  "ACKNOWLEDGED",
  "SNOOZED",
  "DISMISSED",
]);

export async function POST(request: Request) {
  const access = await requireRole(COPILOT_ROLES);
  if (access.error) return access.error;
  const body = await request.json().catch(() => null);
  const normalized = normalizeWhatIfRequest(body);
  if (!normalized) {
    return NextResponse.json({ error: "What-if 조건이 올바르지 않습니다." }, { status: 400 });
  }
  try {
    const result = await getWhatIfCopilot({
      request: normalized,
      userId: access.user.id,
      role: access.user.role,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "운영 코파일럿 분석에 실패했습니다.",
    }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const access = await requireRole(COPILOT_ROLES);
  if (access.error) return access.error;
  const body = await request.json().catch(() => null) as {
    scopeHash?: unknown;
    candidateId?: unknown;
    status?: unknown;
    reason?: unknown;
  } | null;
  if (
    typeof body?.scopeHash !== "string"
    || !/^[a-f0-9]{64}$/.test(body.scopeHash)
    || typeof body.candidateId !== "string"
    || body.candidateId.length < 1
    || body.candidateId.length > 300
    || typeof body.status !== "string"
    || !ACTION_STATUSES.has(body.status as WhatIfCopilotActionStatus)
    || (body.reason !== undefined && body.reason !== null && typeof body.reason !== "string")
  ) {
    return NextResponse.json({ error: "행동 상태 요청이 올바르지 않습니다." }, { status: 400 });
  }
  try {
    const result = await setWhatIfCopilotAction({
      userId: access.user.id,
      scopeHash: body.scopeHash,
      candidateId: body.candidateId,
      status: body.status as WhatIfCopilotActionStatus,
      reason: typeof body.reason === "string" ? body.reason : null,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "행동 상태 저장에 실패했습니다.",
    }, { status: 500 });
  }
}
