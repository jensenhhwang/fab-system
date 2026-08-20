import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "crypto";
import { collections, getMongoClient } from "../src/lib/db";
import { materialConsumptionFor } from "../src/lib/material-consumption";
import { ACTIVE_PRODUCTION_PRODUCTS, getProductionConfig } from "../src/lib/fab-production-config";
import { OPERATING_DAYS_PER_MONTH } from "../src/lib/twin/operating-clock";

// trim-inventory-to-design-target의 대칭형 — 부족한 재고를 정책 유지수위까지 **올리기만** 한다.
//
// 왜 필요했나: 엔진이 멈춰 있는 동안 운영시간이 흐르지 않아 발주가 도착하지 못했고, 그 사이
// 자재가 하나씩 0으로 빠졌다. 라인은 한 종만 STOCKOUT이어도 서므로(materials-agent
// blockingMaterialIds) 가장 늦은 자재를 기다리게 되고, 그동안 소모가 0이라 아무 일도 일어나지
// 않는다. 조달 루프 자체는 정상이다(실측 2026-08-20: 미착 PO 41건·최근 입고 26건·발주 누락 0종).
//
// 이건 정책 수정이 아니라 **콜드스타트 리셋**이다. 정책이 옳으면 이 상태가 유지될 것이고,
// 며칠 연속 가동에도 다시 빠지면 그때는 정책이 틀렸다는 진짜 근거가 된다.
//
// 수요는 3제품(HBM/DRAM/NAND) 합산이다 — trim 쪽은 m20MaterialDemandForScenario로 M20 단독을
// 쓰고 있는데, 3제품 루프로 확장(2026-08-09)된 뒤로는 그 값이 실수요의 1/3 수준이다.
const apply = process.argv.includes("--apply");

// planInbound가 ROP에 닿으면 채우는 상한(inbound.ts). 리필 목표를 ROP(=재주문 트리거)로 잡으면
// 팹을 "지금 당장 발주해야 하는 상태"에 놓는 셈이라, 밀린 로트가 풀리는 순간 바로 바닥을 친다
// (실측 2026-08-20: ROP로 채운 뒤 40분 만에 4종 재결품). 정책이 실제로 유지하는 수위로 맞춘다.
// 창고 정원도 이 배수를 기준으로 산정돼 있다(resize-warehouse-capacity-to-demand).
const REORDER_FILL_MULTIPLIER = 2;

function designDailyDemand(): Map<string, number> {
  const demand = new Map<string, number>();
  for (const { fabId, product } of ACTIVE_PRODUCTION_PRODUCTS) {
    const cfg = getProductionConfig(fabId, product);
    if (!cfg) continue;
    const dailyWaferStarts = cfg.waferStartsPerMonth / OPERATING_DAYS_PER_MONTH;
    for (const row of materialConsumptionFor(product)) {
      demand.set(row.materialId, (demand.get(row.materialId) ?? 0) + row.equivalentPerWafer * dailyWaferStarts);
    }
  }
  return demand;
}

async function main() {
  const { inventory, materials, inventoryMovements } = await collections();
  const demand = designDailyDemand();
  const matById = new Map((await materials.find({}).toArray()).map((m) => [m._id, m]));

  const batchId = `REFILL-DESIGN-${new Date().toISOString()}-${randomUUID().slice(0, 6)}`;
  const now = new Date();
  const planned: { rowId: string; materialId: string; code: string; before: number; after: number; delta: number; capped: boolean }[] = [];
  const overCapacity: string[] = [];

  for (const [materialId, dailyDemand] of demand) {
    const mat = matById.get(materialId);
    if (!mat || mat.ropDays <= 0 || mat.supplyMode === "ON_SITE" || dailyDemand <= 0) continue;
    const policyTarget = dailyDemand * mat.ropDays * REORDER_FILL_MULTIPLIER;

    const rows = await inventory.find({ materialId }).toArray();
    if (!rows.length) continue;
    // 자재 전체 보유량 기준으로 부족분을 판단하고, 대표 창고(재고 최다) 한 곳에 채운다 —
    // 위치 배분은 수요 배정의 몫이라 여기서 정하지 않는다.
    const total = rows.reduce((s, r) => s + r.quantity, 0);
    const dest = rows.reduce((a, b) => (b.quantity > a.quantity ? b : a));

    // 벌크 탱크는 물리 한도가 있다. 정책 목표가 그걸 넘으면 채울 수가 없다 —
    // 그건 리필의 문제가 아니라 **정책이 담을 수 없는 양을 유지하려 한다**는 뜻이라 따로 보고한다.
    const cap = rows.reduce((s, r) => s + (r.capacityLimit ?? 0), 0);
    const capped = cap > 0 && policyTarget > cap;
    if (capped) overCapacity.push(`${mat.code} 정책목표 ${Math.round(policyTarget).toLocaleString()} > 탱크 ${Math.round(cap).toLocaleString()} (${(policyTarget / cap).toFixed(1)}배)`);
    const target = capped ? cap : policyTarget;

    if (total >= target) continue;                       // 넘치는 건 안 건드림 — 그건 trim의 몫
    const delta = target - total;
    planned.push({ rowId: dest._id, materialId, code: mat.code, before: dest.quantity, after: dest.quantity + delta, delta, capped });
  }

  planned.sort((a, b) => b.delta - a.delta);
  console.log(`[refill-inventory] mode=${apply ? "APPLY" : "DRY-RUN"} 대상 ${planned.length}종\n`);
  for (const p of planned) {
    console.log(`  ${p.code.padEnd(12)} ${Math.round(p.before).toString().padStart(9)} → ${Math.round(p.after).toString().padStart(9)}  (+${Math.round(p.delta).toLocaleString()})${p.capped ? "  ⚠ 탱크 한도로 클램프" : ""}`);
  }

  if (overCapacity.length) {
    console.log(`\n⚠ 정책 유지수위가 물리 용량을 넘는 자재 ${overCapacity.length}종 — 리필로 해결되지 않는다:`);
    for (const line of overCapacity) console.log(`   ${line}`);
  }

  if (!apply) {
    console.log(`\n변경 없음. 실제 적용: npm run db:refill-inventory -- --apply`);
    await (await getMongoClient()).close();
    return;
  }

  // 되돌릴 수 있게 적용 직전 수량을 남긴다.
  const backupPath = `.backup/inventory-refill-${now.toISOString().replace(/[:.]/g, "-")}.json`;
  await mkdir(dirname(backupPath), { recursive: true });
  await writeFile(backupPath, JSON.stringify({ batchId, appliedAt: now.toISOString(), rows: planned }, null, 2));
  console.log(`\n롤백 스냅샷: ${backupPath}`);

  const client = await getMongoClient();
  for (const p of planned) {
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        const res = await inventory.updateOne(
          { _id: p.rowId, quantity: p.before },
          { $inc: { quantity: p.delta }, $set: { updatedAt: now } },
          { session },
        );
        if (!res.modifiedCount) throw new Error(`${p.rowId}: 재고가 동시에 변경되었습니다.`);
        await inventoryMovements.insertOne({
          _id: `${batchId}:${p.rowId}`, materialId: p.materialId, type: "ADJUSTMENT", quantity: p.delta,
          reason: `엔진 정지로 생긴 결품 콜드스타트 리셋 — 설계기준 ROP 목표 · ${batchId}`,
          requestId: `${batchId}:${p.rowId}`, userId: "SYSTEM_BASELINE", createdAt: now,
        }, { session });
      });
    } finally {
      await session.endSession();
    }
  }
  console.log(`✅ 적용 완료 — ${planned.length}종 보충 · batch=${batchId}`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
