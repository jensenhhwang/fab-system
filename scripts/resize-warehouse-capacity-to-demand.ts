import "dotenv/config";
import { collections, type MaterialSupplierDoc } from "../src/lib/db";
import { materialConsumptionFor } from "../src/lib/material-consumption";
import { ACTIVE_PRODUCTION_PRODUCTS, getProductionConfig } from "../src/lib/fab-production-config";
import { resolveLeadTimeDays } from "../src/lib/twin/lead-time";
import { BURN_EMA_CEILING_MULTIPLIER, warehouseOccupancyFactor } from "../src/lib/capacity";

// 지난 며칠 반복된 문제: 창고 capacity가 임시 계획값이라 실제 ROP 수요보다 작았고,
// 재고를 강제로 깎아도 시간이 지나면 다시 CRITICAL로 돌아왔다(수요는 안 바뀌었으니까).
// capacity를 "실제로 필요한 만큼"으로 다시 잡는다. 근거는 살아있는 avgDailyBurn(생산이
// 멈춰있으면 왜곡됨)이 아니라 설계 기준 수요다.
// legalLimit(HZW-01 위험물 허가량)은 규제 기준이라 건드리지 않는다 — totalCapacity만 조정한다.
//
// 2026-08-11 재작성 — 기존 산식이 twin의 실제 재주문 정책과 두 군데 어긋나 있었다:
//  ① 설계 수요를 M20(HBM) 단독으로 잡고 있었다. 2026-08-09에 DRAM(M21)·NAND(M22)가 같은 자재
//     재고를 공유하는 3제품 루프로 확장됐는데(engine.ts) sizing 기준은 M20에 머물러서, 창고는
//     실제로 담아야 할 양의 일부만 기준으로 산정됐다. engine.ts의 getDesignDailyDemand와 같은
//     방식으로 ACTIVE_PRODUCTION_PRODUCTS 전 제품의 합을 쓴다.
//  ② 기준을 ROP(= dailyDemand × ropDays)로 잡았는데, planInbound는 ROP에 닿으면 rop×2까지
//     채운다 — 창고를 ROP 기준으로 지으면 정책이 정상 작동하는 것만으로 정원의 2배가 들어온다.
//     실제 보관 상한인 rop×2를 기준으로 잡는다.
//  또한 ROP 자체도 planInbound와 같이 max(ropDays, leadTimeDays)를 쓴다 — ropDays가 리드타임보다
//  짧은 자재는 재주문이 리드타임 기준으로 걸리므로 보관량도 그 기준을 따라간다.
const apply = process.argv.includes("--apply");
// 정원은 설계기준 적재가 아니라 "EMA가 상한까지 올랐을 때의 적재"를 담아야 한다 —
// 발주는 설계 수요가 아니라 실측 EMA로 나가기 때문이다(docs/fab-operating-baseline.md R2).
// engine의 EMA 클리핑과 같은 상수를 쓴다.
const SAFETY_MARGIN = BURN_EMA_CEILING_MULTIPLIER;
const REORDER_FILL_MULTIPLIER = 2; // planInbound가 ROP 도달 시 채우는 상한(rop*2)

// 3팹이 공유하는 자재의 설계기준 일일 수요(engine.ts getDesignDailyDemand와 동일 산식).
function designDailyDemand(): Map<string, number> {
  const demand = new Map<string, number>();
  for (const { fabId, product } of ACTIVE_PRODUCTION_PRODUCTS) {
    const cfg = getProductionConfig(fabId, product);
    if (!cfg) continue;
    const dailyWaferStarts = cfg.waferStartsPerMonth / 30;
    for (const row of materialConsumptionFor(product)) {
      demand.set(row.materialId, (demand.get(row.materialId) ?? 0) + row.equivalentPerWafer * dailyWaferStarts);
    }
  }
  return demand;
}

async function main() {
  const { warehouses, materials, inventory, materialSuppliers, suppliers } = await collections();
  const demand = designDailyDemand();
  const whList = await warehouses.find({ type: { $ne: "FINISHED_GOODS" } }).toArray();
  const invRows = await inventory.find({}).toArray();
  const matDocs = await materials.find({}).toArray();
  const matById = new Map(matDocs.map((m) => [m._id, m]));
  const supplierDocs = await suppliers.find({}).toArray();
  const linksByMaterial = new Map<string, MaterialSupplierDoc[]>();
  for (const link of await materialSuppliers.find({}).toArray()) {
    linksByMaterial.set(link.materialId, [...(linksByMaterial.get(link.materialId) ?? []), link]);
  }

  console.log(`[resize-warehouse-capacity] mode=${apply ? "APPLY" : "DRY-RUN"} basis=rop×${REORDER_FILL_MULTIPLIER} margin=${SAFETY_MARGIN} 제품=${ACTIVE_PRODUCTION_PRODUCTS.map((p) => p.product).join("+")}`);

  for (const wh of whList) {
    if (wh.capacityMode && wh.capacityMode !== "SPACE") {
      console.log(`${wh.code}: capacityMode=${wh.capacityMode} — SPACE 모드가 아니라 스킵`);
      continue;
    }
    const rows = invRows.filter((r) => r.warehouseId === wh._id);
    let targetOcc = 0;
    const lines: string[] = [];
    for (const row of rows) {
      const mat = matById.get(row.materialId);
      if (!mat) continue;
      const dailyDemand = demand.get(row.materialId) ?? row.avgDailyBurn ?? 0;
      // 리드타임의 진실원은 승인 주공급사 마스터다 — twin의 발주(engine.ts)와 같은 함수를 써야
      // "정원은 카테고리 평균으로 지었는데 발주는 마스터 기준으로 나간다"가 안 생긴다.
      const leadTimeDays = resolveLeadTimeDays(linksByMaterial.get(mat._id) ?? [], supplierDocs, mat.category);
      const protectedDays = Math.max(mat.ropDays, leadTimeDays);
      const targetQty = dailyDemand * protectedDays * REORDER_FILL_MULTIPLIER;
      const factor = warehouseOccupancyFactor(wh.type, mat);
      const occ = targetQty * factor;
      targetOcc += occ;
      const ropNote = protectedDays > mat.ropDays ? `(리드타임 ${leadTimeDays}일 적용)` : "";
      lines.push(`  ${mat.code}\tdailyDemand=${dailyDemand.toFixed(1)}\tprotectedDays=${protectedDays}${ropNote}\ttargetQty=${targetQty.toFixed(0)}\tocc=${occ.toFixed(0)}`);
    }
    const sizedCapacity = Math.ceil(targetOcc * SAFETY_MARGIN);
    // 축소는 하지 않는다(grow-only). 설계 수요보다 재고가 많이 쌓인 창고는 산정치가 현재
    // 정원보다 작게 나오는데(실측: MRO-01 2,200 → 244, 현재 점유 1,532), 그대로 줄이면 그
    // 즉시 utilization이 100%를 넘어 박물류가 전 입고를 INBOUND_HOLD로 묶는다 — 정원을 깎아
    // 결품을 만드는 건 이 스크립트가 막으려는 바로 그 실패다("창고가 작다→재고를 깎음→재발"
    // 3회 반복, devlog day 20). 과적재는 정원이 아니라 재고 쪽 문제이므로 별도로 정리한다.
    const newCapacity = Math.max(wh.totalCapacity, sizedCapacity);
    const delta = wh.totalCapacity > 0 ? Math.round((newCapacity / wh.totalCapacity - 1) * 100) : 0;
    console.log(`${wh.code} (${wh.name}): current=${wh.totalCapacity.toLocaleString()} → target=${newCapacity.toLocaleString()} ${wh.unit} (${delta >= 0 ? "+" : ""}${delta}%)`);
    if (sizedCapacity < wh.totalCapacity) {
      const currentOcc = Math.round(rows.reduce((s, r) => {
        const m = matById.get(r.materialId);
        return m ? s + r.quantity * warehouseOccupancyFactor(wh.type, m) : s;
      }, 0));
      console.log(`  ⚠ 산정치 ${sizedCapacity.toLocaleString()}는 현재 정원보다 작다 — 정원은 유지한다(grow-only). 현재 점유=${currentOcc.toLocaleString()}로 설계 수요 대비 과적재 상태이니 재고 쪽에서 정리해야 한다.`);
    }
    for (const l of lines) console.log(l);

    if (apply && newCapacity !== wh.totalCapacity) {
      await warehouses.updateOne(
        { _id: wh._id },
        { $set: {
          totalCapacity: newCapacity,
          notes: `MODELED_BASELINE · 2026-08-11 3제품(HBM/DRAM/NAND) 설계기준 수요 × max(ropDays, 리드타임) × 재주문 상한 ${REORDER_FILL_MULTIPLIER}배 × ${SAFETY_MARGIN} 여유로 재산정. 실측 시설 마스터로 교체 필요.`,
        } },
      );
    }
  }
  console.log(apply ? "[resize-warehouse-capacity] 적용 완료" : "[resize-warehouse-capacity] --apply로 재실행하면 반영됩니다");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
