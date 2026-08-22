import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import {
  askControlTowerRole,
  ControlTowerAskError,
  getControlTowerAskHistory,
} from "@/lib/control-tower-ask-server";
import { CONTROL_TOWER_ASK_MAX_QUESTION_CHARS } from "@/lib/control-tower-ask";
import type { ControlTowerRole } from "@/lib/control-tower-live";

export const dynamic = "force-dynamic";

const ROLES = new Set<ControlTowerRole>([
  "PROCUREMENT",
  "MATERIALS",
  "PRODUCTION",
  "LOGISTICS",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function capabilities(role: string) {
  return {
    createInboundPlan: (WRITE_ROLES.inboundPlan as readonly string[]).includes(role),
  };
}

function errorResponse(error: unknown) {
  if (error instanceof ControlTowerAskError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return NextResponse.json(
    { error: "담당자 대화를 처리하지 못했습니다.", code: "CONTROL_TOWER_ASK_FAILED" },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  try {
    const threadId = new URL(request.url).searchParams.get("threadId");
    if (threadId && !UUID_PATTERN.test(threadId)) {
      return NextResponse.json({ error: "올바르지 않은 대화 ID입니다." }, { status: 400 });
    }
    const history = await getControlTowerAskHistory(access.user.id, threadId);
    return NextResponse.json(
      { ...history, capabilities: capabilities(access.user.role) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "허용되지 않은 요청 출처입니다." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 4_096) {
    return NextResponse.json({ error: "질문 요청이 너무 큽니다." }, { status: 413 });
  }

  const body = await request.json().catch(() => null) as {
    role?: unknown;
    question?: unknown;
    threadId?: unknown;
    clientRequestId?: unknown;
  } | null;
  const role = body?.role;
  const question = typeof body?.question === "string"
    ? body.question.replace(/\s+/g, " ").trim()
    : "";
  const threadId = body?.threadId;
  const clientRequestId = body?.clientRequestId;

  if (typeof role !== "string" || !ROLES.has(role as ControlTowerRole)) {
    return NextResponse.json({ error: "질문할 담당자를 선택해 주세요." }, { status: 400 });
  }
  if (!question || [...question].length > CONTROL_TOWER_ASK_MAX_QUESTION_CHARS) {
    return NextResponse.json(
      { error: `질문은 ${CONTROL_TOWER_ASK_MAX_QUESTION_CHARS}자 이내로 입력해 주세요.` },
      { status: 400 },
    );
  }
  if (threadId !== null && threadId !== undefined && (
    typeof threadId !== "string" || !UUID_PATTERN.test(threadId)
  )) {
    return NextResponse.json({ error: "올바르지 않은 대화 ID입니다." }, { status: 400 });
  }
  if (typeof clientRequestId !== "string" || !UUID_PATTERN.test(clientRequestId)) {
    return NextResponse.json({ error: "올바르지 않은 요청 ID입니다." }, { status: 400 });
  }

  try {
    const history = await askControlTowerRole({
      userId: access.user.id,
      role: role as ControlTowerRole,
      question,
      threadId: typeof threadId === "string" ? threadId : null,
      clientRequestId,
    });
    return NextResponse.json(
      { ...history, capabilities: capabilities(access.user.role) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
