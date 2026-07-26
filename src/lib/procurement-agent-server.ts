import "server-only";

import { loadLiveScenarioMaterials } from "@/lib/material-scenario-server";
import { recommendMaterialOrders, type ProductionPlanEvent } from "@/lib/scenario-engine";
import { buildProcurementShadow, type ProcurementShadowReport } from "@/lib/procurement-agent";

// 입고 에이전트 그림자 실행(MVP-0): 실제 발주·입고 없음. 결정론 엔진 결과를 판단 사슬로만 변환.
export async function runProcurementShadow(input: {
  events?: ProductionPlanEvent[];
  fabId?: "M20" | "M21" | "M22" | null;
  horizonDays?: number;
  coverageDays?: number;
  scenarioLabel?: string;
  now?: Date;
}): Promise<ProcurementShadowReport> {
  const now = input.now ?? new Date();
  const events = input.events ?? [];
  const { materials, snapshotAt } = await loadLiveScenarioMaterials(now);

  const plan = recommendMaterialOrders(
    materials,
    {
      events,
      horizonDays: input.horizonDays ?? 30,
      coverageDays: input.coverageDays ?? 14,
      replenishmentMode: "ROP",
    },
    input.fabId ?? null,
  );

  const label = input.scenarioLabel
    ?? (events.length > 0 ? "What-if 시나리오 반영" : "현재 재고 기준 위험 점검");

  return buildProcurementShadow(plan.recommendations, label, snapshotAt);
}
