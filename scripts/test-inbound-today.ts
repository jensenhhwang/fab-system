import assert from "node:assert/strict";
import { buildInboundToday, type InboundTodayInput, type MaterialMeta } from "../src/lib/inbound-today";

const materials: Record<string, MaterialMeta> = {
  "GAS-004": { code: "GAS-004", name: "실란 (SiH₄)", category: "GAS", unit: "봄베" },
  "GAS-005": { code: "GAS-005", name: "암모니아 (NH₃)", category: "GAS", unit: "봄베" },
  "CHM-001": { code: "CHM-001", name: "TEOS", category: "CHM", unit: "L" },
  "PKG-001": { code: "PKG-001", name: "EMC", category: "PKG", unit: "kg" },
};

// now = 2026-07-26 14:00 로컬
const now = new Date(2026, 6, 26, 14, 0, 0).toISOString();
const todayAt = (h: number, m = 0) => new Date(2026, 6, 26, h, m, 0).toISOString();
const dayIso = (y: number, mo: number, d: number) => new Date(y, mo - 1, d).toISOString();

const input: InboundTodayInput = {
  now,
  receipts: [
    // 계획 연결 입고
    { materialId: "GAS-004", quantity: 3, createdAt: todayAt(9, 14), inboundPlanId: "IP-2451" },
    { materialId: "GAS-005", quantity: 5, createdAt: todayAt(11, 2), inboundPlanId: "IP-2455" },
    { materialId: "CHM-001", quantity: 300, createdAt: todayAt(9, 40), inboundPlanId: "IP-2448" },
    // 애드혹 (계획 없음)
    { materialId: "PKG-001", quantity: 200, createdAt: todayAt(14, 0), inboundPlanId: null },
    { materialId: "GAS-004", quantity: 2, createdAt: todayAt(9, 50) },
  ],
  plans: [
    // 오늘 예정, 완료
    { id: "IP-2455", planNo: "IP-2455", materialId: "GAS-005", unit: "봄베", plannedDate: dayIso(2026, 7, 26), plannedQuantity: 5, receivedQuantity: 5, remainingQuantity: 0 },
    // 오늘 예정, 진행중
    { id: "IP-2451", planNo: "IP-2451", materialId: "GAS-004", unit: "봄베", plannedDate: dayIso(2026, 7, 26), plannedQuantity: 10, receivedQuantity: 5, remainingQuantity: 5 },
    // 오늘 예정, 미도착(고스트)
    { id: "IP-2460", planNo: "IP-2460", materialId: "CHM-001", unit: "L", plannedDate: dayIso(2026, 7, 26), plannedQuantity: 1000, receivedQuantity: 0, remainingQuantity: 1000 },
    // 과거 예정, 미완료(지연)
    { id: "IP-2448", planNo: "IP-2448", materialId: "CHM-001", unit: "L", plannedDate: dayIso(2026, 7, 25), plannedQuantity: 1000, receivedQuantity: 300, remainingQuantity: 700 },
  ],
  materials,
};

const out = buildInboundToday(input);

// 총 입고 건수
assert.equal(out.totalReceiptCount, 5, "총 입고 건수");
assert.equal(out.lastReceiptAt, todayAt(14, 0), "마지막 입고 시각");

// 카테고리별 단위별 총량 (합산 금지)
const gas = out.categoryTotals.find((c) => c.category === "GAS");
assert.ok(gas, "GAS 카테고리 존재");
assert.equal(gas!.receiptCount, 3, "GAS 입고 3건");
assert.equal(gas!.totalsByUnit[0].unit, "봄베");
assert.equal(gas!.totalsByUnit[0].quantity, 10, "GAS 봄베 3+5+2=10");
const chm = out.categoryTotals.find((c) => c.category === "CHM")!;
assert.equal(chm.totalsByUnit[0].quantity, 300, "CHM L 300");
// 카테고리 순서는 CATEGORY_ORDER (GAS, CHM, ..., PKG)
assert.deepEqual(out.categoryTotals.map((c) => c.category), ["GAS", "CHM", "PKG"], "카테고리 고정 순서");

// 시간대별 버킷 (6~20 고정 축)
assert.equal(out.hourBuckets.length, 15, "시간 버킷 6~20 = 15칸");
assert.equal(out.hourBuckets.find((b) => b.hour === 9)!.count, 3, "9시 3건");
assert.equal(out.hourBuckets.find((b) => b.hour === 11)!.count, 1, "11시 1건");
assert.equal(out.hourBuckets.find((b) => b.hour === 7)!.count, 0, "7시 0건");

// 계획 달성률 (건수 기반): 오늘예정 3건(2455,2451,2460) 중 완료 1건(2455) → 33%
assert.equal(out.achievement.plannedCount, 3, "오늘 예정 3건");
assert.equal(out.achievement.completedCount, 1, "완료 1건");
assert.equal(out.achievement.delayedCount, 1, "지연 1건(IP-2448)");
assert.equal(out.achievement.pct, 33, "달성률 33%");

// 레이스 트랙 상태 판정
const row = (id: string) => out.raceRows.find((r) => r.planId === id)!;
assert.equal(row("IP-2455").status, "COMPLETED");
assert.equal(row("IP-2451").status, "IN_PROGRESS");
assert.equal(row("IP-2451").progressPct, 50, "5/10=50%");
assert.equal(row("IP-2460").status, "GHOST");
assert.equal(row("IP-2448").status, "DELAYED");
// 정렬: DELAYED 먼저
assert.equal(out.raceRows[0].status, "DELAYED", "지연 행이 맨 위");

// 애드혹 레인: 계획 없는 입고 2건 (PKG-001, GAS-004 무계획)
assert.equal(out.adhocRows.length, 2, "애드혹 2건");
assert.equal(out.adhocRows[0].materialCode, "PKG-001", "최신 애드혹이 먼저");

// 빈 상태
const empty = buildInboundToday({ now, receipts: [], plans: [], materials });
assert.equal(empty.totalReceiptCount, 0);
assert.equal(empty.lastReceiptAt, null);
assert.equal(empty.achievement.pct, 0);
assert.equal(empty.categoryTotals.length, 0);
assert.equal(empty.hourBuckets.length, 15, "빈 상태도 축은 유지");

console.log("✅ inbound-today 셰이핑 로직 통과");
