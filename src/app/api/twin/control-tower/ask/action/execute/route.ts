import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import {
  ControlTowerAskActionError,
  executeControlTowerAskAction,
} from "@/lib/control-tower-ask-action-server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export async function POST(request: Request) {
  const access = await requireRole(WRITE_ROLES.inboundPlan);
  if (access.error) return access.error;

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "허용되지 않은 요청 출처입니다." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as {
    proposalId?: unknown;
    previewToken?: unknown;
    requestId?: unknown;
  } | null;
  if (typeof body?.proposalId !== "string" || !HASH_PATTERN.test(body.proposalId)) {
    return NextResponse.json({ error: "올바르지 않은 실행 제안 ID입니다." }, { status: 400 });
  }
  if (typeof body.previewToken !== "string" || !UUID_PATTERN.test(body.previewToken)) {
    return NextResponse.json({ error: "올바르지 않은 미리보기 토큰입니다." }, { status: 400 });
  }
  if (typeof body.requestId !== "string" || !UUID_PATTERN.test(body.requestId)) {
    return NextResponse.json({ error: "올바르지 않은 요청 ID입니다." }, { status: 400 });
  }
  try {
    const result = await executeControlTowerAskAction({
      userId: access.user.id,
      proposalId: body.proposalId,
      previewToken: body.previewToken,
      requestId: body.requestId,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ControlTowerAskActionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: "입고계획 초안을 만들지 못했습니다." }, { status: 500 });
  }
}
