import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  decideOperationImprovement,
  OperationImprovementError,
} from "@/lib/operation-improvement-server";

export const dynamic = "force-dynamic";

const ADMIN_ONLY = ["ADMIN"] as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ proposalId: string }> },
) {
  const access = await requireRole(ADMIN_ONLY);
  if (access.error) return access.error;

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "허용되지 않은 요청 출처입니다." }, { status: 403 });
  }

  const { proposalId } = await params;
  const body = await request.json().catch(() => null) as {
    decision?: unknown;
    reason?: unknown;
    requestId?: unknown;
  } | null;
  if (
    !SHA256_PATTERN.test(proposalId)
    || (body?.decision !== "APPROVE" && body?.decision !== "REJECT")
    || typeof body.reason !== "string"
    || body.reason.trim().length < 1
    || body.reason.trim().length > 500
    || typeof body.requestId !== "string"
    || !UUID_PATTERN.test(body.requestId)
  ) {
    return NextResponse.json({ error: "proposalId, 결정, 사유 또는 requestId 형식이 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const result = await decideOperationImprovement({
      proposalId,
      decision: body.decision,
      reason: body.reason.trim(),
      requestId: body.requestId,
      userId: access.user.id,
    });
    return NextResponse.json(result, {
      status: result.proposal.status === "FAILED" ? 500 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof OperationImprovementError) {
      const status = error.code === "PROPOSAL_NOT_FOUND" ? 404 : 409;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("[operations-monitor] 개선안 결정 실패", error);
    return NextResponse.json({ error: "개선안 결정을 처리하지 못했습니다." }, { status: 500 });
  }
}
