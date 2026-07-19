import "dotenv/config";
import assert from "node:assert/strict";
import { collections } from "../src/lib/db";
import { m20ProductionScenarioMetrics } from "../src/lib/fab-scenario";
import { m20ProcessUsageForScenario } from "../src/lib/material-consumption";
import { expandRouteMaster, getRouteMaster } from "../src/lib/route-master";

async function main() {
  const normal = m20ProductionScenarioMetrics("NORMAL");
  assert.equal(normal.waferStartsPerMonth, 117_000);
  assert.equal(normal.targetWip, 16_380);
  assert.equal(normal.knownGoodDiesPerWafer, 650);
  assert.equal(normal.finishedHbmStacksPerWafer, 48.75);
  assert.equal(normal.finishedHbmStacks, 5_703_750);
  console.log("✅ M20 NORMAL: 117K WSPM → WIP 16,380 FOUP → HBM4 12-Hi 5,703,750개/월");

  const route = await getRouteMaster("M20", "HBM");
  assert(route, "M20:HBM Route Master가 없습니다");
  assert.equal(route.nodes.find((node) => node.id === "packaging")?.repeatCount, 12);
  assert.equal(expandRouteMaster(route).length, 134);
  console.log("✅ M20 Route Master: HBM4 12-Hi packaging 12회, 총 134스텝");

  const { processUsage } = await collections();
  const rows = await processUsage.find({ fabId: "M20", product: "HBM" }).toArray();
  assert.equal(rows.length, 48);
  assert(rows.every((row) => row.modelProduct === "M20-HBM4-12H-V1"));
  assert(rows.every((row) => row.equivalentPerWafer !== undefined));
  assert(rows.every((row) => row.sourceVersion === "MATERIAL_CONSUMPTION_M20_V1"));
  const expectedById = new Map(m20ProcessUsageForScenario("NORMAL").map((row) => [row._id, row.monthlyQty]));
  assert(rows.every((row) => row.monthlyQty === expectedById.get(row._id)), "자재·공정행별 월수량이 원단위 계산과 같아야 합니다");
  console.log("✅ M20 자재: 43종·48공정행, wafer당 원단위 연결, 서로 다른 자재 단위를 합산하지 않고 행별 월수량 보존");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
