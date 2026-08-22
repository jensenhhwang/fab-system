import assert from "node:assert/strict";
import {
  diagnoseTick,
  lifeSignOf,
  fulfillmentRate,
  type TickDiagnosisInput,
} from "../src/lib/twin/tick-diagnosis";

// "tick은 도는데 아무것도 안 만들어진다"를 시스템이 이상 신호로 정의하기 위한 순수 판정.
// DB를 타지 않으므로 여기서 전 분기를 검증한다.

const base: TickDiagnosisInput = {
  now: new Date("2026-08-09T14:00:00Z"),
  engineStatus: "RUNNING",
  lastTickAt: new Date("2026-08-09T13:59:57Z"),
  lastOutputAt: new Date("2026-08-09T13:59:00Z"),
  burnedTotal: 1000,
  shortfallTotal: 0,
  criticalMaterials: [],
  capacityOverFinishedGoods: [],
  pendingApprovalCount: 0,
  inboundHoldCount: 0,
  blockedLots: 0,
  starvedMaterials: [],
};

// ── 생명신호 3상태 ──
{
  assert.equal(lifeSignOf(base.now, base.lastOutputAt).level, "ALIVE", "1분 전 산출이면 정상");
  const stale = lifeSignOf(base.now, new Date("2026-08-09T13:15:00Z"));
  assert.equal(stale.level, "DEGRADED", "45분 전 산출이면 지연");
  const dead = lifeSignOf(base.now, new Date("2026-08-09T10:01:00Z"));
  assert.equal(dead.level, "STOPPED", "4시간 전 산출이면 정지");
  assert.equal(dead.minutesSinceOutput, 239, "경과 분이 정확해야 한다");
  const never = lifeSignOf(base.now, null);
  assert.equal(never.level, "STOPPED", "산출 이력이 없으면 정지");
  assert.equal(never.minutesSinceOutput, null, "이력 없으면 경과 분은 null");
}

// ── 충족률: 부족분을 분모에 포함해야 물질보존 위반이 드러난다 ──
{
  assert.equal(fulfillmentRate(371125, 998956), 371125 / (371125 + 998956), "충족률 = burned/(burned+shortfall)");
  assert.equal(fulfillmentRate(0, 0), null, "소모도 부족도 없으면 판정 불가(null)");
  assert.equal(fulfillmentRate(1000, 0), 1, "부족이 없으면 1");
}

// ── 정상: 정체 원인 없음 ──
{
  const d = diagnoseTick(base);
  assert.equal(d.lifeSign.level, "ALIVE");
  assert.deepEqual(d.blockReasons, [], "정상이면 정체 원인이 없다");
  assert.equal(d.topBlockReason, null);
}

// ── 자재결품: 사람이 풀어야 함 ──
{
  const d = diagnoseTick({
    ...base,
    lastOutputAt: new Date("2026-08-09T10:01:00Z"),
    criticalMaterials: [{ materialId: "m1", code: "CHM-008", state: "STOCKOUT" }],
    blockedLots: 14040,
  });
  const r = d.blockReasons.find((b) => b.reason === "MATERIAL_CRITICAL");
  assert.ok(r, "결품이 있으면 MATERIAL_CRITICAL이 잡힌다");
  assert.equal(r.releaseActor, "HUMAN", "결품 해소는 사람이 입고를 반영해야 한다");
  assert.ok(r.impactLabel.includes("14,040"), "영향 로트 수가 라벨에 들어간다");
  assert.ok(r.deepLink, "처방으로 갈 링크가 있어야 한다");
}

// ── 완제품 창고 초과: 담당 에이전트가 아직 없음 ──
{
  const d = diagnoseTick({ ...base, capacityOverFinishedGoods: [{ warehouseId: "WH-FG01", utilization: 198 }] });
  const r = d.blockReasons.find((b) => b.reason === "FG_CAPACITY_OVER");
  assert.ok(r, "FG 창고 초과가 잡힌다");
  assert.equal(r.releaseActor, "UNASSIGNED", "출하 주체(정영업)가 아직 없으므로 미배치");
  assert.ok(r.impactLabel.includes("198"), "점유율이 라벨에 들어간다");
}

// ── 승인대기: 사람 ──
{
  const d = diagnoseTick({ ...base, pendingApprovalCount: 41 });
  const r = d.blockReasons.find((b) => b.reason === "PENDING_APPROVAL");
  assert.ok(r, "승인대기가 잡힌다");
  assert.equal(r.releaseActor, "AGENT", "60분 SLA로 김구매가 자동 승인하므로 자동");
  assert.ok(r.deepLink, "사람이 더 빨리 승인할 경로는 남아 있어야 한다");
}

// ── 입고보류: 이제 tick이 자동 재정산하므로 자동 ──
{
  const d = diagnoseTick({ ...base, inboundHoldCount: 7 });
  const r = d.blockReasons.find((b) => b.reason === "INBOUND_HOLD");
  assert.ok(r, "입고보류가 잡힌다");
  assert.equal(r.releaseActor, "AGENT", "settleArrivals가 매 tick 재정산하므로 자동 해제");
}

// ── EMA 아사: 화면에서 못 푸는 코드 결함 ──
{
  const d = diagnoseTick({
    ...base,
    starvedMaterials: [
      { code: "CHM-013", avgDailyBurn: 50.3, designDaily: 109.6 },
      { code: "GAS-024", avgDailyBurn: 10.6, designDaily: 33.1 },
    ],
  });
  const r = d.blockReasons.find((b) => b.reason === "EMA_STARVATION");
  assert.ok(r, "EMA 아사가 잡힌다");
  assert.equal(r.releaseActor, "CODE_DEFECT", "버튼으로 못 푸는 코드 결함이어야 한다");
  assert.equal(r.deepLink, null, "코드 결함은 갈 곳이 없다");
  assert.ok(r.impactLabel.includes("GAS-024"), "가장 심하게 굶은 자재를 지목해야 한다");
  assert.ok(r.impactLabel.includes("32%"), "설계수요 대비 비율이 라벨에 들어간다");
}

// ── 산출이 멈추면 소모 이벤트도 멈춰서 충족률이 오히려 건강해 보인다 — 아사는 재고 원장으로 잡아야 한다 ──
{
  const d = diagnoseTick({
    ...base,
    lastOutputAt: new Date("2026-08-09T10:01:00Z"),
    burnedTotal: 27534374,
    shortfallTotal: 440937, // 충족률 98%
    starvedMaterials: [{ code: "GAS-024", avgDailyBurn: 10.6, designDaily: 33.1 }],
  });
  assert.ok(d.fulfillment !== null && d.fulfillment > 0.97, "관측창 충족률은 건강해 보일 수 있다");
  assert.ok(d.blockReasons.some((b) => b.reason === "EMA_STARVATION"), "그래도 아사는 잡혀야 한다");
}

// ── 우선순위: 코드 결함이 최상위 (눌러도 안 풀리는 걸 먼저 알려야 한다) ──
{
  const d = diagnoseTick({
    ...base,
    lastOutputAt: new Date("2026-08-09T10:01:00Z"),
    starvedMaterials: [{ code: "GAS-024", avgDailyBurn: 10.6, designDaily: 33.1 }],
    criticalMaterials: [{ materialId: "m1", code: "CHM-008", state: "STOCKOUT" }],
    capacityOverFinishedGoods: [{ warehouseId: "WH-FG01", utilization: 198 }],
    pendingApprovalCount: 41,
    inboundHoldCount: 7,
    blockedLots: 14040,
  });
  assert.equal(d.blockReasons.length, 5, "원인 5종이 모두 잡힌다");
  assert.equal(d.topBlockReason?.reason, "EMA_STARVATION", "코드 결함이 1위여야 한다");
  assert.equal(d.blockReasons[1].reason, "MATERIAL_CRITICAL", "그 다음이 실제 라인을 세운 결품");
}

// ── 엔진이 멈춰 있으면 그것 자체가 최우선 ──
{
  const d = diagnoseTick({ ...base, engineStatus: "PAUSED", criticalMaterials: [{ materialId: "m1", code: "X", state: "STOCKOUT" }] });
  assert.equal(d.topBlockReason?.reason, "ENGINE_PAUSED", "엔진 정지가 다른 무엇보다 먼저다");
  assert.equal(d.lifeSign.level, "STOPPED", "엔진이 멈췄으면 생명신호도 정지");
}

console.log("✅ tick 진단 순수함수 테스트 통과");
