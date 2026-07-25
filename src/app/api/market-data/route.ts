import { after } from "next/server";
import { getMarketDashboardData, shouldRefreshMarketSources } from "@/lib/market-dashboard";
import { collectMarketSources } from "@/lib/market-ingestion";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const data = await getMarketDashboardData();
  if (shouldRefreshMarketSources(data)) {
    after(async () => {
      await collectMarketSources("ALL");
    });
  }
  return Response.json(data, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
