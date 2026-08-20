import "dotenv/config";
import { collections, getMongoClient } from "../src/lib/db";
import { getInventoryRows } from "../src/lib/queries";
import { operatingMsToDays } from "../src/lib/twin/operating-clock";

// DOH가 0일에 가까운 자재의 원인을 성분별로 분해한다.
//
// DOH = (materialId 전체 현재고) ÷ (일평균사용량) 이므로 값이 0에 붙는 경우는 넷 중 하나다.
//   ① 재보충이 도착하지 못하고 있다 (운영시계 정지 / INBOUND_HOLD / 승인 대기)
//   ② 발주점(ROP)이 실제 리드타임보다 짧다 — 발주하는 순간 이미 늦었다
//   ③ 탱크 만재 한도가 리드타임을 못 버틴다 — ROP를 올려도 담을 곳이 없다
//   ④ 마스터데이터 결손으로 보충계획 자체가 생성되지 않는다
// 섹션 A~D가 각각에 대응한다.
async function main() {
  const rows = await getInventoryRows(true);
  const { inventoryPolicies, inboundPlans, twinPurchaseOrders, twinEngineState, suppliers, materialSuppliers, warehouses } =
    await collections();

  const [policyDocs, inbound, state, whs, sups, links] = await Promise.all([
    inventoryPolicies.find({}).toArray(),
    inboundPlans.aggregate<{ _id: string; quantity: number; count: number }>([
      { $match: { status: { $in: ["DRAFT", "CONFIRMED"] }, remainingQuantity: { $gt: 0 } } },
      { $group: { _id: "$materialId", quantity: { $sum: "$remainingQuantity" }, count: { $sum: 1 } } },
    ]).toArray(),
    twinEngineState.findOne({ _id: "singleton" }),
    warehouses.find({}).toArray(),
    suppliers.find({}).toArray(),
    materialSuppliers.find({}).toArray(),
  ]);
  const policyMap = new Map(policyDocs.map(p => [p.materialId, p]));
  const inboundMap = new Map(inbound.map(i => [i._id, i]));
  const whMap = new Map(whs.map(w => [w._id, w]));
  const supMap = new Map(sups.map(s => [s._id, s]));

  // 자재별 승인 주공급사 리드타임
  const ltMap = new Map<string, number>();
  for (const l of links) {
    const rec = l as unknown as Record<string, unknown>;
    const lt = (rec.leadTimeDays as number) ?? ((supMap.get(l.supplierId) as unknown as Record<string, unknown>)?.leadTimeDays as number);
    if (lt == null) continue;
    const isPrimary = rec.isPrimary === true || rec.primary === true;
    if (!ltMap.has(l.materialId) || isPrimary) ltMap.set(l.materialId, lt);
  }

  // materialId 단위로 접는다 — DOH는 위치별이 아니라 자재 전체 기준이다.
  const seen = new Set<string>();
  const mats = rows
    .filter(r => { if (seen.has(r.materialId)) return false; seen.add(r.materialId); return true; })
    .filter(r => r.material.ropDays !== 0 && r.doh !== null)
    .sort((a, b) => (a.doh ?? 0) - (b.doh ?? 0));

  // ── A. DOH 하위 자재의 원인 성분 ──────────────────────────────────────────
  const critical = mats.filter(m => (m.doh ?? 0) < 5);
  console.log(`=== [A] DOH 성분 분해 — 산출대상 ${mats.length}종 / DOH<5일 ${critical.length}종 ===\n`);
  for (const m of mats.slice(0, 20)) {
    const p = policyMap.get(m.materialId);
    const inb = inboundMap.get(m.materialId);
    console.log(
      `${(m.doh ?? 0).toFixed(2).padStart(8)}일  ${m.material.code.padEnd(12)} ${m.material.name.slice(0, 16).padEnd(18)} ` +
      `qty=${Math.round(m.totalQuantity).toString().padStart(9)}${m.material.unit.padEnd(6)} daily=${m.dailyUsage.toFixed(1).padStart(9)} (${m.usageSource}) ` +
      `rop=${m.material.ropDays}d | inbound=${inb ? Math.round(inb.quantity) : 0} | ` +
      `${p ? `${p.status}${p.blockReason ? ` (${p.blockReason})` : ""}` : "policy=NONE"}`,
    );
  }

  // ── B. 재보충이 왜 도착하지 않는가 ────────────────────────────────────────
  const now = Date.now();
  const opNow = state?.operatingEpochMs ?? 0;
  console.log(`\n=== [B] Twin 운영시계와 미착 PO ===`);
  console.log(`엔진 status=${state?.status}  lastTickAt=${state?.lastTickAt?.toISOString()} (${((now - +(state?.lastTickAt ?? 0)) / 3600000).toFixed(1)}시간 전)`);
  console.log(`운영시각=${operatingMsToDays(opNow).toFixed(2)}일차  (도착 판정 근거 — RULES.md § Twin 운영시간)`);

  const pos = await twinPurchaseOrders.find({ status: { $nin: ["RECEIVED", "REJECTED"] } }).toArray();
  const codeMap = new Map(rows.map(r => [r.materialId, r.material.code]));
  const byStatus = new Map<string, number>();
  for (const po of pos) byStatus.set(po.status, (byStatus.get(po.status) ?? 0) + 1);
  console.log(`미착 PO ${pos.length}건 — ${[...byStatus].map(([k, v]) => `${k}=${v}`).join("  ")}\n`);
  for (const po of pos.sort((a, b) => (a.etaOperatingMs ?? 0) - (b.etaOperatingMs ?? 0))) {
    const eta = po.etaOperatingMs;
    const arrived = eta != null ? opNow >= eta : now >= +po.etaAt;
    console.log(
      `  ${(codeMap.get(po.materialId) ?? po.materialId).padEnd(12)} ${po.status.padEnd(15)} LT=${String(po.leadTimeDays).padStart(2)}d ` +
      `etaOp=${eta != null ? operatingMsToDays(eta).toFixed(2).padStart(7) + "일차" : "     없음"}  ${arrived ? "도착판정 O" : "도착판정 X"}` +
      `${eta != null ? ` (${operatingMsToDays(opNow - eta) >= 0 ? "+" : ""}${operatingMsToDays(opNow - eta).toFixed(2)}일)` : ""}` +
      `${po.holdReason ? `  HOLD:${po.holdReason}` : ""}`,
    );
  }

  // ── C/D. 구조적 결품과 마스터데이터 결손 ──────────────────────────────────
  const structural: string[] = [];
  const thinTank: string[] = [];
  const noLt: string[] = [];
  for (const r of mats) {
    if (r.dailyUsage <= 0) continue;
    const lt = ltMap.get(r.materialId);
    const capDays = r.capacityLimit != null ? r.capacityLimit / r.dailyUsage : null;
    const wh = whMap.get(r.warehouseId);
    const line =
      `${r.material.code.padEnd(12)} ${r.material.name.slice(0, 16).padEnd(18)} rop=${String(r.material.ropDays).padStart(2)}d  ` +
      `LT=${lt != null ? String(lt).padStart(2) + "d" : "미등록"}  capDays=${capDays != null ? capDays.toFixed(1).padStart(5) + "d" : "  무제한"}  ` +
      `DOH=${(r.doh ?? 0).toFixed(1)}일  wh=${wh?.code ?? "?"}`;
    if (lt == null) { noLt.push(line); continue; }
    if (r.material.ropDays < lt) structural.push(line);
    if (capDays != null && capDays < lt) thinTank.push(line);
  }

  console.log(`\n=== [C] 구조적 결품: 발주점(ROP) < 리드타임 — ${structural.length}종 ===`);
  console.log("발주를 띄우는 순간 이미 늦었다. 도착 전까지 반드시 바닥을 찍는다.\n");
  structural.forEach(l => console.log("  " + l));

  console.log(`\n=== [C-2] 탱크 만재 한도 < 리드타임 — ${thinTank.length}종 ===`);
  console.log("만재로 출발해도 다음 입고 전에 바닥난다. ROP를 올려도 담을 곳이 없다.\n");
  thinTank.forEach(l => console.log("  " + l));

  console.log(`\n=== [D] 승인 주공급사 리드타임 미등록 — ${noLt.length}종 ===`);
  console.log("보충계획(inventory-policy)이 BLOCKED_MASTER_DATA로 막혀 목표재고가 서지 않는다.\n");
  noLt.forEach(l => console.log("  " + l));

  await (await getMongoClient()).close();
}

main().catch(e => { console.error(e); process.exit(1); });
