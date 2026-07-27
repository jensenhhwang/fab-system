import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { runProcurementShadow } from "@/lib/procurement-agent-server";

export const dynamic = "force-dynamic";

const READ_ROLES = ["ADMIN", "MATERIALS"] as const;

// MVP-0/MVP-1: 그림자모드 read-only. 실제 발주·입고를 실행하지 않는다.
// events를 명시하지 않으면 /simulation에서 반영해둔 활성 시나리오를 자동으로 읽는다.
export async function GET() {
  const access = await requireRole(READ_ROLES);
  if (access.error) return access.error;

  try {
    const report = await runProcurementShadow({});
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "입고 에이전트 미리보기에 실패했습니다." },
      { status: 500 },
    );
  }
}
