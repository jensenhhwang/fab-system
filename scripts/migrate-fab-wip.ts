import "dotenv/config";
import { collections, type Product } from "../src/lib/db";
import type { FabId } from "../src/lib/fab-domain";
import { getRouteMaster, expandRouteMaster } from "../src/lib/route-master";
import { getProductionConfig } from "../src/lib/fab-production-config";
import { buildSeedCounts } from "../src/lib/twin/step-bucket";

// STEP_BUCKET 제품(DRAM/NAND)의 WIP를 docs/foup-wip-master.md §22 설계대로 step별 count 집계로 시드한다.
// per-lot waferLots를 만들지 않는다(틱당 4만건 write 회피). 이전에 잘못 시드된 per-lot MODELED_FOUP
// 로트가 있으면 정리한다(--apply 시).
const apply = process.argv.includes("--apply");
const fabId = (process.argv.find((a) => a.startsWith("--fab="))?.split("=")[1] ?? "") as FabId;
const product = (process.argv.find((a) => a.startsWith("--product="))?.split("=")[1] ?? "") as Product;

async function main() {
  const cfg = getProductionConfig(fabId, product);
  if (!cfg) throw new Error(`config 없음: ${fabId}/${product}`);
  if (cfg.wipMode !== "STEP_BUCKET") throw new Error(`${fabId}/${product}은 STEP_BUCKET이 아님(wipMode=${cfg.wipMode})`);
  const { wipStepBuckets, waferLots } = await collections();
  const route = await getRouteMaster(fabId, product);
  if (!route) throw new Error(`route 없음: ${fabId}/${product}`);
  const totalSteps = expandRouteMaster(route).length;
  if (totalSteps === 0) throw new Error("route 스텝 0");

  const staleLots = await waferLots.countDocuments({ fabId, product, cohort: "MODELED_FOUP" });
  const existing = await wipStepBuckets.findOne({ _id: `${fabId}__${product}` });
  const existingWip = existing ? existing.counts.reduce((s, c) => s + c, 0) : 0;
  console.log(`[fab-wip] ${fabId}/${product} mode=${apply ? "APPLY" : "DRY_RUN"} steps=${totalSteps} target=${cfg.targetOccupiedFoup} existingBucketWip=${existingWip} stalePerLotLots=${staleLots}`);
  if (!apply) return;

  // 이전 per-lot 시드 정리(있다면).
  if (staleLots > 0) {
    const del = await waferLots.deleteMany({ fabId, product, cohort: "MODELED_FOUP" });
    console.log(`  기존 per-lot MODELED_FOUP 로트 삭제: ${del.deletedCount}`);
  }

  const counts = buildSeedCounts(totalSteps, cfg.targetOccupiedFoup);
  await wipStepBuckets.updateOne(
    { _id: `${fabId}__${product}` },
    { $set: { fabId, product, totalSteps, counts, updatedAt: new Date() } },
    { upsert: true },
  );
  const after = counts.reduce((s, c) => s + c, 0);
  console.log(`✅ ${fabId}/${product} step-bucket 시드 완료: totalWip=${after} (steps=${totalSteps})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
