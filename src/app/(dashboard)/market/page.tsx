export const dynamic = "force-dynamic";

import { after } from "next/server";
import { campusScenarioMetrics, FAB_SCENARIO, FAB_SCENARIO_VERSION, fabScenarioMetrics, GLOBAL_300MM_MEMORY_WSPM_2026 } from "@/lib/fab-scenario";
import { getMarketDashboardData, shouldRefreshMarketSources } from "@/lib/market-dashboard";
import { collectMarketSources } from "@/lib/market-ingestion";
import MarketClient from "./MarketClient";

function getFabCapacity() {
  return {
    version: FAB_SCENARIO_VERSION,
    globalMemoryWspm: GLOBAL_300MM_MEMORY_WSPM_2026,
    campus: campusScenarioMetrics(),
    fabs: FAB_SCENARIO.map((fab) => ({ ...fab, metrics: fabScenarioMetrics(fab) })),
  };
}

export default async function MarketPage() {
  const market = await getMarketDashboardData();
  if (shouldRefreshMarketSources(market)) {
    after(async () => {
      await collectMarketSources("ALL");
    });
  }
  return <MarketClient market={market} fab={getFabCapacity()} />;
}
