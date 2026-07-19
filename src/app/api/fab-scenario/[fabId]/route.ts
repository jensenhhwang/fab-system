import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { FAB_IDS, type FabId } from "@/lib/fab-domain";
import { fabScenarioMetrics, getLiveFabScenario, M20_PRODUCTION_SCENARIOS, setFabUtilization, targetWipCount } from "@/lib/fab-scenario";

export const dynamic = "force-dynamic";

function targetWipFor(fabId: FabId, scenario: Awaited<ReturnType<typeof getLiveFabScenario>>) {
  return fabId === "M20"
    ? targetWipCount(fabScenarioMetrics(scenario).utilizedWspm, M20_PRODUCTION_SCENARIOS.NORMAL.cycleTimeDays)
    : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ fabId: string }> }) {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;
  const { fabId } = await params;
  if (!FAB_IDS.includes(fabId as FabId)) return NextResponse.json({ error: "알 수 없는 fabId" }, { status: 400 });
  const scenario = await getLiveFabScenario(fabId as FabId);
  return NextResponse.json({
    scenario, metrics: fabScenarioMetrics(scenario), targetWip: targetWipFor(fabId as FabId, scenario),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ fabId: string }> }) {
  const access = await requireRole(WRITE_ROLES.fabScenario);
  if (access.error) return access.error;
  const { fabId } = await params;
  if (fabId !== "M20") return NextResponse.json({ error: "이번 단계에선 M20 가동률만 조절할 수 있습니다." }, { status: 400 });
  const body = await req.json() as { utilization?: number };
  if (typeof body.utilization !== "number") return NextResponse.json({ error: "utilization 필수" }, { status: 400 });
  try {
    const scenario = await setFabUtilization(fabId, body.utilization, access.user.id);
    return NextResponse.json({
      scenario, metrics: fabScenarioMetrics(scenario), targetWip: targetWipFor(fabId, scenario),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "업데이트 실패" }, { status: 400 });
  }
}
