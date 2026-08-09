import "dotenv/config";
import { randomUUID } from "crypto";
import { collections, type WaferLotDoc, type Product } from "../src/lib/db";
import type { FabId } from "../src/lib/fab-domain";
import { getRouteMaster, expandRouteMaster } from "../src/lib/route-master";
import { getProductionConfig } from "../src/lib/fab-production-config";

// M21/M22 완제품 적립에 필요한 것은 M20식 무거운 physical FOUP fleet(carrier·assignment)이
// 아니라 진행 가능한 MODELED_FOUP waferLots 풀뿐이다. route 전체 스텝에 균등 분포로 시드해
// 매 tick 완제품이 조금씩 나오게 한다. carrier/assignment는 만들지 않는다.
const apply = process.argv.includes("--apply");
const fabId = (process.argv.find((a) => a.startsWith("--fab="))?.split("=")[1] ?? "") as FabId;
const product = (process.argv.find((a) => a.startsWith("--product="))?.split("=")[1] ?? "") as Product;
const BATCH = 1_000;

async function main() {
  const cfg = getProductionConfig(fabId, product);
  if (!cfg) throw new Error(`config 없음: ${fabId}/${product}`);
  const { waferLots } = await collections();
  const route = await getRouteMaster(fabId, product);
  if (!route) throw new Error(`route 없음: ${fabId}/${product}`);
  const visits = expandRouteMaster(route);
  const totalSteps = visits.length;
  if (totalSteps === 0) throw new Error("route 스텝 0");

  const existing = await waferLots.countDocuments({ fabId, product, cohort: "MODELED_FOUP", status: "IN_PROGRESS" });
  const toCreate = Math.max(0, cfg.targetOccupiedFoup - existing);
  console.log(`[fab-wip] ${fabId}/${product} mode=${apply ? "APPLY" : "DRY_RUN"} steps=${totalSteps} existing=${existing} target=${cfg.targetOccupiedFoup} create=${toCreate}`);
  if (!apply || toCreate === 0) return;

  const now = new Date();
  const docs: WaferLotDoc[] = Array.from({ length: toCreate }, (_, i) => {
    // route 전체에 균등 분포 — 매 tick 완제품이 조금씩 나오도록 스텝을 흩뿌린다.
    const stepIndex = Math.floor((i / toCreate) * totalSteps);
    const id = randomUUID();
    return {
      _id: `WLOT-${fabId}-SEED-${now.getTime()}-${id}`,
      fabId, product, routeMasterId: route._id,
      foupCode: `FOUP-${fabId}-${String(i + 1).padStart(5, "0")}`,
      status: "IN_PROGRESS", cohort: "MODELED_FOUP",
      currentStepIndex: stepIndex, currentNodeId: visits[stepIndex].nodeId,
      lastEventAt: new Date(now.getTime() - Math.random() * 5_000), // 즉시 due 분산
      waferQty: cfg.wafersPerFoup, watched: false, source: "MODELED_BASELINE",
      createdBy: "FAB_WIP_SEED", createdAt: now, updatedAt: now,
    } as WaferLotDoc;
  });
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    await waferLots.bulkWrite(batch.map((d) => ({ updateOne: { filter: { _id: d._id }, update: { $setOnInsert: d }, upsert: true } })), { ordered: false });
  }
  const after = await waferLots.countDocuments({ fabId, product, cohort: "MODELED_FOUP", status: "IN_PROGRESS" });
  console.log(`✅ ${fabId}/${product} MODELED_FOUP 시드 완료: ${after}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
