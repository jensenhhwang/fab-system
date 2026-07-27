import "server-only";

import { collections } from "@/lib/db";
import { loadLiveScenarioMaterials } from "@/lib/material-scenario-server";
import { recommendMaterialOrders, type ProductionPlanEvent } from "@/lib/scenario-engine";
import { buildProcurementShadow, type AutonomyLevel, type ProcurementShadowReport } from "@/lib/procurement-agent";

export type ActiveScenarioInfo = {
  label: string;
  submittedBy: string;
  submittedAt: string;
} | null;

export type ProcurementShadowResult = ProcurementShadowReport & { activeScenario: ActiveScenarioInfo };

// 입고 에이전트 그림자 실행(MVP-0/MVP-1): 실제 발주·입고 없음. 결정론 엔진 결과를 판단 사슬로만 변환.
// events를 명시적으로 안 넘기면(undefined), /simulation에서 사람이 반영해둔 활성 시나리오를 자동으로 읽는다.
export async function runProcurementShadow(input: {
  events?: ProductionPlanEvent[];
  fabId?: "M20" | "M21" | "M22" | null;
  horizonDays?: number;
  coverageDays?: number;
  scenarioLabel?: string;
  now?: Date;
}): Promise<ProcurementShadowResult> {
  const now = input.now ?? new Date();
  const { agentAutonomyOverrides, procurementActiveScenario } = await collections();

  let events = input.events;
  let horizonDays = input.horizonDays;
  let coverageDays = input.coverageDays;
  let fabId = input.fabId ?? null;
  let activeScenario: ActiveScenarioInfo = null;

  if (events === undefined) {
    const scenario = await procurementActiveScenario.findOne({ _id: "singleton" });
    if (scenario) {
      events = scenario.events;
      horizonDays = horizonDays ?? scenario.horizonDays;
      coverageDays = coverageDays ?? scenario.coverageDays;
      fabId = fabId ?? scenario.fabId;
      activeScenario = { label: scenario.label, submittedBy: scenario.submittedBy, submittedAt: scenario.submittedAt.toISOString() };
    } else {
      events = [];
    }
  }

  const { materials, snapshotAt } = await loadLiveScenarioMaterials(now);

  const plan = recommendMaterialOrders(
    materials,
    {
      events,
      horizonDays: horizonDays ?? 30,
      coverageDays: coverageDays ?? 14,
      replenishmentMode: "ROP",
    },
    fabId,
  );

  const label = input.scenarioLabel
    ?? activeScenario?.label
    ?? (events.length > 0 ? "What-if 시나리오 반영" : "현재 재고 기준 위험 점검");

  const overrideDocs = await agentAutonomyOverrides.find({}).toArray();
  const overrides: Record<string, AutonomyLevel> = {};
  for (const doc of overrideDocs) overrides[doc.materialId] = doc.level;

  return { ...buildProcurementShadow(plan.recommendations, label, snapshotAt, overrides), activeScenario };
}
