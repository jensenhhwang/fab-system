import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import {
  ControlTowerAskActionError,
  previewControlTowerAskAction,
} from "@/lib/control-tower-ask-action-server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const access = await requireRole(WRITE_ROLES.inboundPlan);
  if (access.error) return access.error;

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "허용되지 않은 요청 출처입니다." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { messageId?: unknown } | null;
  if (typeof body?.messageId !== "string" || !UUID_PATTERN.test(body.messageId)) {
    return NextResponse.json({ error: "올바르지 않은 답변 ID입니다." }, { status: 400 });
  }
  try {
    const preview = await previewControlTowerAskAction({
      userId: access.user.id,
      messageId: body.messageId,
    });
    return NextResponse.json(preview, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ControlTowerAskActionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: "실행 미리보기를 만들지 못했습니다." }, { status: 500 });
  }
}
