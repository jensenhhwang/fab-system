import "dotenv/config";
import { collections } from "../src/lib/db";
import { materialConsumptionFor } from "../src/lib/material-consumption";
import { ACTIVE_PRODUCTION_PRODUCTS, getProductionConfig } from "../src/lib/fab-production-config";
import { getBaseLeadTime } from "../src/lib/twin/lead-time";
import { BURN_EMA_CEILING_MULTIPLIER, warehouseOccupancyFactor } from "../src/lib/capacity";
import { getWarehouseCapacity } from "../src/lib/queries";

// 4개 에이전트(김구매·박물류·이자재·최생산)의 임계값이 서로 모순되지 않는지 수치로 검증한다.
//
// 배경: 각 규칙은 따로 보면 다 타당한데, 셋을 같이 돌리면 "자재는 결품인데 창고는 초과"처럼
// 서로를 먹여 살리는 교착이 났다. 규칙끼리 지켜야 하는 부등식을 명시적으로 검사한다.
// 근거 기준은 docs/fab-operating-baseline.md.

// 이자재가 라인을 세우는 임계(§materials-agent.coverageState CRITICAL)
const CRITICAL_COVERAGE_RATIO = 0.5;
// 재주문이 채우는 상한(§twin/inbound.planInbound)
const REORDER_FILL_MULTIPLIER = 2;
// EMA가 설계수요 대비 허용하는 상한. engine의 클리핑과 창고 정원 산정이 공유하는 단일 상수를
// 그대로 읽는다 — 감사가 별도 숫자를 들고 있으면 그것부터 어긋난다.
const EMA_CEILING_MULTIPLIER = BURN_EMA_CEILING_MULTIPLIER;
// 박물류가 입고를 멈추는 임계(§logistics-agent.verdictOf)
const CAPACITY_OVER_PCT = 100;
// 운영 기준선 = 케파 90% 가동. 단, fab-scenario.ts의 waferStartsPerMonth가 이미
// nominalWspm × utilization(0.90~0.92)이라 getProductionConfig에서 나오는 설계 수요·산출
// 자체가 곧 기준선 값이다 — 여기에 0.9를 또 곱하면 이중 할인이 된다(2026-08-11 최초
// 작성 시 그렇게 곱해서 R4 위반 3건이 잘못 잡혔다). 기준선 배수는 1.0으로 두고, 시나리오
// 변경은 fab-scenario 쪽 utilization을 바꿔 반영한다.
const BASELINE_MULTIPLIER = 1.0;

type Violation = { rule: string; subject: string; detail: string };

function designDailyDemand(): Map<string, number> {
  const demand = new Map<string, number>();
  for (const { fabId, product } of ACTIVE_PRODUCTION_PRODUCTS) {
    const cfg = getProductionConfig(fabId, product);
    if (!cfg) continue;
    const daily = cfg.waferStartsPerMonth / 30;
    for (const row of materialConsumptionFor(product)) {
      demand.set(row.materialId, (demand.get(row.materialId) ?? 0) + row.equivalentPerWafer * daily);
    }
  }
  return demand;
}

async function main() {
  const { materials, inventory } = await collections();
  const demand = designDailyDemand();
  const ids = [...demand.keys()];
  const matDocs = await materials.find({ _id: { $in: ids } }).toArray();
  const matById = new Map(matDocs.map((m) => [m._id, m]));
  const invDocs = await inventory.find({ materialId: { $in: ids } }).toArray();
  const bestInv = new Map<string, typeof invDocs[number]>();
  for (const d of invDocs) {
    const prev = bestInv.get(d.materialId);
    if (!prev || d.quantity > prev.quantity) bestInv.set(d.materialId, d);
  }
  const warehouses = await getWarehouseCapacity();
  const whById = new Map(warehouses.map((w) => [w.id, w]));

  const violations: Violation[] = [];

  // ── 규칙 1: 발주가 도착하기 전에 라인이 서지 않는가 ─────────────────────────────
  // 재주문은 커버리지가 protectedDays로 떨어질 때 걸리고, 화물은 leadTimeDays 뒤에 도착한다.
  // 라인은 재고가 실제로 0일 때 선다(materials-agent.blockingMaterialIds — STOCKOUT만).
  // 따라서 protectedDays − leadTimeDays > 0 이어야 도착 전에 재고가 0을 지나지 않는다.
  //
  // 2026-08-11까지는 라인이 ropDays×0.5(CRITICAL)에서 섰고, 그 기준으로는 44종 중 17종이
  // 구조적으로 위반이었다. 차단을 STOCKOUT으로 한정하면서 그 좌변이 사라졌다 — CRITICAL은
  // 이제 라인을 세우는 대신 긴급 조달(용량 초과여도 입고)을 발동시킨다.
  console.log("── 규칙 1: 발주가 도착하기 전에 재고가 0이 되지 않는가 ──");
  console.log("자재       ropDays 리드타임 보호일수  도착여유  긴급조달발동  판정");
  for (const id of ids) {
    const mat = matById.get(id);
    if (!mat) continue;
    const leadTime = getBaseLeadTime(mat.category);
    const protectedDays = Math.max(mat.ropDays, leadTime);
    const margin = protectedDays - leadTime;
    // 긴급 조달이 발동되는 커버리지(= CRITICAL 임계). 리드타임보다 이른 시점에 발동해야
    // "결품 전에 손을 쓴다"는 의미가 있다.
    const urgentAt = Math.max(1, mat.ropDays * CRITICAL_COVERAGE_RATIO);
    const ok = margin > 0;
    if (!ok) {
      violations.push({
        rule: "R1 발주-결품 경합",
        subject: id,
        detail: `보호일수 ${protectedDays}일 = 리드타임 ${leadTime}일 — 발주 후 도착까지 여유가 0이라 수요가 조금만 흔들려도 재고가 0을 지난다`,
      });
      console.log(`${id} ${String(mat.ropDays).padStart(6)}일 ${String(leadTime).padStart(6)}일 ${String(protectedDays).padStart(6)}일 ${margin.toFixed(1).padStart(7)}일 ${urgentAt.toFixed(1).padStart(11)}일  ✗`);
    }
  }
  if (!violations.some((v) => v.rule.startsWith("R1"))) console.log("  위반 없음");

  // ── 규칙 2: 창고 정원 ≥ 재주문 정책이 실제로 채우는 최대치 ─────────────────────
  // EMA는 설계수요의 최대 3배까지 오를 수 있고, 재주문은 rop×2까지 채운다. 따라서 창고가
  // 최악의 경우 담아야 하는 양 = 설계수요 × EMA상한 × 보호일수 × 2.
  console.log("\n── 규칙 2: 창고 정원이 재주문 정책의 최대 적재량을 담는가 ──");
  const worstByWarehouse = new Map<string, number>();
  const designByWarehouse = new Map<string, number>();
  for (const id of ids) {
    const mat = matById.get(id);
    const inv = bestInv.get(id);
    if (!mat || !inv) continue;
    const wh = whById.get(inv.warehouseId);
    if (!wh || wh.capacityMode !== "SPACE") continue;
    const protectedDays = Math.max(mat.ropDays, getBaseLeadTime(mat.category));
    const daily = demand.get(id) ?? 0;
    const factor = warehouseOccupancyFactor(wh.type, mat);
    worstByWarehouse.set(inv.warehouseId, (worstByWarehouse.get(inv.warehouseId) ?? 0) + daily * EMA_CEILING_MULTIPLIER * protectedDays * REORDER_FILL_MULTIPLIER * factor);
    designByWarehouse.set(inv.warehouseId, (designByWarehouse.get(inv.warehouseId) ?? 0) + daily * protectedDays * REORDER_FILL_MULTIPLIER * factor);
  }
  console.log("창고      정원      설계기준적재  EMA상한적재  설계대비  EMA대비  판정");
  for (const [whId, worst] of worstByWarehouse) {
    const wh = whById.get(whId)!;
    const design = designByWarehouse.get(whId) ?? 0;
    const designPct = Math.round((design / wh.totalCapacity) * 100);
    const worstPct = Math.round((worst / wh.totalCapacity) * 100);
    const ok = worstPct <= CAPACITY_OVER_PCT;
    if (!ok) {
      violations.push({
        rule: "R2 정원-발주 경합",
        subject: wh.code,
        detail: `EMA가 상한(설계×${EMA_CEILING_MULTIPLIER})까지 오르면 적재량이 정원의 ${worstPct}%가 된다 — 박물류가 ${CAPACITY_OVER_PCT}%에서 입고를 멈추므로 그 자재는 보충 불가`,
      });
    }
    console.log(`${wh.code.padEnd(8)} ${String(wh.totalCapacity).padStart(8)} ${Math.round(design).toString().padStart(12)} ${Math.round(worst).toString().padStart(12)} ${String(designPct).padStart(7)}% ${String(worstPct).padStart(6)}%  ${ok ? "✓" : "✗"}`);
  }

  // ── 규칙 3: 케파 90% 운영 기준선에서 각 창고가 여유를 갖는가 ────────────────────
  console.log("\n── 규칙 3: 기준선(케파 90% 가동) 운영 시 창고 여유 ──");
  console.log("창고      현재점유   현재%   기준선 예상%   판정");
  for (const wh of warehouses) {
    if (wh.capacityMode !== "SPACE" || wh.type === "FINISHED_GOODS") continue;
    const design = designByWarehouse.get(wh.id) ?? 0;
    const at90 = Math.round((design * BASELINE_MULTIPLIER / wh.totalCapacity) * 100);
    const ok = at90 <= CAPACITY_OVER_PCT;
    if (!ok) {
      violations.push({ rule: "R3 기준선 초과", subject: wh.code, detail: `기준선 운영만으로도 정원의 ${at90}%가 찬다` });
    }
    console.log(`${wh.code.padEnd(8)} ${String(wh.occupancy).padStart(9)} ${String(wh.utilization).padStart(6)}% ${String(at90).padStart(14)}%  ${ok ? "✓" : "✗"}`);
  }

  // ── 규칙 4: 계약 자동출하 ≤ 케파 90% 운영 시 산출 ──────────────────────────────
  console.log("\n── 규칙 4: 계약 자동출하가 기준선 산출보다 작은가 ──");
  const { customers } = await collections();
  const { buildContractLines, designMonthlyOutput } = await import("../src/lib/customer-contracts");
  const custDocs = await customers.find({}).toArray();
  const lines = buildContractLines(custDocs as never);
  console.log("제품    기준선 월산출   계약월량(자동)  기준선대비  여유    판정");
  for (const { product } of ACTIVE_PRODUCTION_PRODUCTS) {
    const design = designMonthlyOutput(product);
    const contracted = lines
      .filter((l) => l.product === product && l.contractType !== "SPOT")
      .reduce((s, l) => s + l.contractedMonthlyQty, 0);
    const vsDesign = (contracted / design) * 100;
    // 계약이 케파 90% 산출과 "같기만 해도" 여유가 0이라 완제품이 0으로 수렴한다 — 넘지 않는
    // 것으로는 부족하고 반드시 작아야 한다. 부동소수점 때문에 같은 비율이 제품별로 다르게
    // 판정되지 않도록 소수 1자리로 반올림해 비교한다.
    const vs90 = Math.round((contracted / (design * BASELINE_MULTIPLIER)) * 1000) / 10;
    const ok = vs90 < 100;
    if (!ok) {
      violations.push({
        rule: "R4 출하-생산 경합",
        subject: product,
        detail: `계약 자동출하가 기준선 산출의 ${vs90.toFixed(1)}% — 정상 운영 중에도 완제품 재고가 0으로 빨린다`,
      });
    }
    console.log(`${product.padEnd(6)} ${Math.round(design).toLocaleString().padStart(13)} ${Math.round(contracted).toLocaleString().padStart(15)} ${vs90.toFixed(1).padStart(9)}% ${(100 - vs90).toFixed(1).padStart(6)}%  ${ok ? "✓" : "✗"}`);
  }

  console.log(`\n${"=".repeat(70)}`);
  if (violations.length === 0) {
    console.log("✅ 정책 간 모순 없음");
  } else {
    console.log(`⚠ 정책 모순 ${violations.length}건`);
    for (const v of violations) console.log(`  [${v.rule}] ${v.subject}: ${v.detail}`);
  }
  process.exit(violations.length > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
