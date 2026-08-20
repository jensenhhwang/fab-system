import assert from "node:assert/strict";
import { planInbound, settleArrivals, updateBurnEma, observedDailyDemand } from "../src/lib/twin/inbound";
import { operatingDaysToMs } from "../src/lib/twin/operating-clock";

// K4 회귀 배경: engine.ts가 EMA에 실제 요청량(qty) 대신 burnInventoryProjection이 반환한
// burned(재고 부족 시 min(onHand, qty)로 깎인 값)만 넣고 있었다 — 재고가 부족할수록 EMA가
// 낮아지고, 낮아진 EMA가 ROP·재주문 판단 기준이 되니 발주가 더 안 나가는 자기강화 나선이었다
// (실관측: 결품률 08-05 40%→08-09 73%). 진짜 수요는 burned+shortfall(=qty 그대로)이다.
assert.equal(observedDailyDemand(100, 2), 50, "emaSimDays로 나눈 일일 수요");
assert.equal(observedDailyDemand(100, 0), 100, "emaSimDays가 0이면 그대로(부트스트랩 안전장치)");
// 재고가 부족해 burned=20/shortfall=80이어도(qty=100), EMA에는 진짜 수요 100 기준이 들어가야
// 한다 — burned(20)만 넣으면 재고 부족 상황에서 EMA가 오히려 더 내려가는 게 이 회귀의 핵심.
assert.equal(observedDailyDemand(20 + 80, 2), 50, "부족분(shortfall)까지 포함한 진짜 수요를 반영해야 한다");

// EMA: 초기값이 0이면 관측값을 그대로 채택(부트스트랩)
assert.equal(updateBurnEma(0, 100, 0.2), 100, "EMA 부트스트랩");
assert.ok(Math.abs(updateBurnEma(100, 200, 0.2) - 120) < 1e-9, "EMA 0.2*200+0.8*100=120");

// 회귀 배경: 동기화된 WIP 무리가 같은 tick에 한 스텝을 완료하면 그 tick의 burn이 순간적으로
// 폭증하고(observedDaily = burned/simDays), alpha=0.2라도 극단값이 그대로 들어가면 EMA가
// 한 번에 몇 배씩 튀어 ROP/발주량이 폭주해 창고가 넘친다(실관측: MWH-01 422%→654%).
// 한 tick의 관측치가 EMA를 과도하게 흔들지 못하도록 상한을 둔다(진짜 지속적 증가는 여러
// tick에 걸쳐 서서히 반영되고, 한 번의 튀는 값만 걸러진다).
const spike = updateBurnEma(1_000, 1_000_000, 0.2);
assert.ok(spike < 5_000, `극단적 burst 한 번으로 EMA가 폭주하면 안 된다 (got ${spike})`);
assert.ok(spike > 1_000, "그래도 어느 정도는 반영은 돼야 한다(완전 무시 금지)");

// 진짜 지속적인 증가(2~3배 이내)는 여전히 정상적으로 반영돼야 한다 — 위 상한이 정상 신호까지
// 죽이면 안 된다
assert.ok(Math.abs(updateBurnEma(100, 250, 0.2) - 130) < 1e-9, "2.5배 이내 정상 증가는 클리핑 없이 그대로 반영");

// 회귀 배경: prevEma가 0(리셋 직후)일 때는 위 3배 클리핑이 아예 적용 안 됐다 — 부트스트랩
// 관측치를 무조건 그대로 채택했다. Twin이 며칠 멈췄다 재개되면 밀린 로트가 한 tick에 몰려
// 그 순간 burn이 폭증하는데, 그게 하필 리셋 직후 첫 관측이면 그대로 새 기준선이 되고, 거기서
// 다시 3배씩 불어나 결국 설계기준 대비 40배까지 벌어졌다(실관측: CSM-001 173/일 설계 대비
// 7,083/일 실측). referenceCeiling(설계기준 수요 등)을 넘는 관측치는 부트스트랩이든 아니든
// 항상 잘라내야 한다 — 진짜 증가는 여러 tick에 걸쳐 서서히 ceiling까지만 올라가면 된다.
assert.equal(updateBurnEma(0, 1_000_000, 0.2, 200), 200, "부트스트랩이어도 referenceCeiling을 넘으면 잘라내야 한다");
assert.equal(updateBurnEma(0, 150, 0.2, 200), 150, "referenceCeiling 이내 관측치는 부트스트랩에서 그대로 채택");
assert.ok(Math.abs(updateBurnEma(100, 1_000_000, 0.2, 5_000) - updateBurnEma(100, 1_000_000, 0.2)) < 1e-9, "정상 범위의 referenceCeiling은 기존 3배 클리핑 동작을 안 바꿔야 한다");

// ROP = avgDailyBurn(10) * ropDays(7) = 70. onHand+inTransit = 30 < 70 → 재주문
// 재주문량 = rop*2 - (onHand+inTransit) = 140 - 30 = 110
const plan = planInbound({ onHand: 20, inTransit: 10, avgDailyBurn: 10, ropDays: 7 });
assert.equal(plan?.qty, 110, "ROP 미달 시 재주문량");

// onHand+inTransit >= ROP → 발주 없음
assert.equal(planInbound({ onHand: 100, inTransit: 0, avgDailyBurn: 10, ropDays: 7 }), null, "충분하면 발주 없음");
// avgDailyBurn=0(소모 없음)이면 발주 없음
assert.equal(planInbound({ onHand: 0, inTransit: 0, avgDailyBurn: 0, ropDays: 7 }), null, "소모 없으면 발주 없음");

// P0 회귀 배경: avgDailyBurn 자체가(EMA 클리핑을 우회해서든, 수동 리셋 실수로든) 잘못 설정되면
// planInbound는 그 값을 그대로 믿고 거대한 rop*2 발주를 계속 쏜다 — 실관측: PKG-LBD-001이
// 30분 만에 입고 1.39억 vs 소비 428만(32배 불균형)까지 벌어짐. avgDailyBurn의 정합성과
// 무관하게, 발주량 자체가 최근 발주 이력 대비 비정상적으로 크면 한 번에 다 승인하지 않고
// 걸러낸다(진짜 지속적 수요 증가는 여러 번의 발주를 거쳐 서서히 반영된다).
const spikePlan = planInbound({ onHand: 10, inTransit: 0, avgDailyBurn: 1_000_000, ropDays: 7, recentOrderQty: 100 });
assert.ok(spikePlan, "발주 자체는 나가야 한다(완전 차단 아님)");
assert.ok(spikePlan!.qty <= 500, `최근 발주량(100) 대비 비정상 배수는 클리핑돼야 한다 (got ${spikePlan!.qty})`);
assert.ok(spikePlan!.qty > 100, "그래도 최근 발주량보다는 늘어날 여지가 있어야 한다(완전 고정 금지)");

// recentOrderQty가 없으면(최초 발주) 클리핑하지 않는다 — EMA 부트스트랩과 동일한 철학
const firstPlan = planInbound({ onHand: 0, inTransit: 0, avgDailyBurn: 1_000, ropDays: 7 });
assert.equal(firstPlan?.qty, 14_000, "최초 발주(이력 없음)는 클리핑 없이 그대로");

// 진짜 지속적인 수요 증가(최근 발주 대비 3배 이내)는 클리핑 없이 그대로 반영돼야 한다
const normalGrowth = planInbound({ onHand: 0, inTransit: 0, avgDailyBurn: 100, ropDays: 7, recentOrderQty: 500 });
assert.equal(normalGrowth?.qty, 1_400, "정상 범위 증가는 클리핑 없이 그대로");

// P1 회귀 배경(2026-08-11): ropDays가 조달 리드타임보다 짧은 자재는 발주가 즉시 나가도 구조적으로
// 결품난다 — ROP에 도달해 발주를 걸어도 남은 재고는 ropDays치인데 화물은 leadTimeDays 뒤에
// 도착하므로, ropDays < leadTimeDays면 그 차이만큼은 반드시 재고 0으로 보낸다(실관측: CHM-002
// 과산화수소 ropDays 7일 vs CHM 리드타임 11일 — 승인 게이트를 제거해도 남는 결품). ERP 쪽
// inventory-policy.ts의 calculateBaselineTarget은 이미 protectedDays = max(ropDays, leadTimeDays)로
// 이 문제를 처리하고 있었다 — twin의 재주문도 같은 기준을 써야 두 계산이 어긋나지 않는다.
const shortRop = planInbound({ onHand: 0, inTransit: 0, avgDailyBurn: 10, ropDays: 7, leadTimeDays: 11 });
assert.equal(shortRop?.qty, 220, "ropDays(7) < leadTimeDays(11)이면 리드타임 기준으로 ROP를 잡아야 한다 (10*11*2)");

// 트리거 시점도 같이 올라가야 의미가 있다 — 리드타임 수요(110)를 밑돌면 발주가 나가야 한다.
assert.ok(planInbound({ onHand: 100, inTransit: 0, avgDailyBurn: 10, ropDays: 7, leadTimeDays: 11 }), "ropDays 기준(70)으론 충분해 보여도 리드타임 기준(110) 미달이면 발주해야 한다");

// ropDays가 리드타임보다 길면 지금까지의 동작 그대로 — 넉넉한 쪽을 깎으면 안 된다.
assert.equal(planInbound({ onHand: 20, inTransit: 10, avgDailyBurn: 10, ropDays: 7, leadTimeDays: 3 })?.qty, 110, "ropDays >= leadTimeDays면 기존 동작 유지");
// leadTimeDays를 안 넘기는 기존 호출자는 동작이 바뀌면 안 된다.
assert.equal(planInbound({ onHand: 20, inTransit: 10, avgDailyBurn: 10, ropDays: 7 })?.qty, 110, "leadTimeDays 미지정 시 기존 동작 유지");

// P2 회귀 배경(2026-08-11): planInbound가 목적창고의 잔여 용량을 전혀 보지 않아서, 담을 수
// 없는 양을 발주해놓고 도착 시점에 박물류가 INBOUND_HOLD로 묶는 구조였다. 그러면 그 물량은
// inTransit에 계속 잡혀 재발주까지 막고(§settleArrivals 주석), 자재는 결품인데 창고는 초과인
// 교착이 된다 — 실관측: 라인 정지 → catch-up burst로 EMA가 설계수요의 3배(상한)에 고착 →
// ROP·발주량도 3배 → 창고 초과 → INBOUND_HOLD → 결품 → 라인 정지의 닫힌 루프. 못 담을 양은
// 애초에 주문하지 않는다(ERP 쪽 capacityDecision이 BLOCKED_CAPACITY로 이미 쓰는 규칙).
const capped = planInbound({ onHand: 0, inTransit: 0, avgDailyBurn: 100, ropDays: 10, capacityHeadroomQty: 300 });
assert.equal(capped?.qty, 300, "잔여 용량(300)이 재주문량(2,000)보다 작으면 잔여 용량까지만 발주");

// 용량이 남아 있으면 기존 산식 그대로.
assert.equal(planInbound({ onHand: 0, inTransit: 0, avgDailyBurn: 100, ropDays: 10, capacityHeadroomQty: 99_999 })?.qty, 2_000, "여유가 충분하면 클리핑 없음");
// 미지정이면 기존 호출자 동작 보존.
assert.equal(planInbound({ onHand: 0, inTransit: 0, avgDailyBurn: 100, ropDays: 10 })?.qty, 2_000, "capacityHeadroomQty 미지정 시 기존 동작 유지");

// 창고가 이미 꽉 찼으면 발주 자체가 나가면 안 된다 — 0을 주문하는 PO가 생기면 inTransit만
// 늘려서 오히려 재발주를 막는다.
assert.equal(planInbound({ onHand: 0, inTransit: 0, avgDailyBurn: 100, ropDays: 10, capacityHeadroomQty: 0 }), null, "잔여 용량이 없으면 발주하지 않는다");
assert.equal(planInbound({ onHand: 0, inTransit: 0, avgDailyBurn: 100, ropDays: 10, capacityHeadroomQty: -50 }), null, "이미 초과된 창고(음수 여유)도 발주하지 않는다");

// 스파이크 클립과 함께 걸리면 더 작은 쪽이 이긴다.
assert.equal(planInbound({ onHand: 0, inTransit: 0, avgDailyBurn: 100, ropDays: 10, recentOrderQty: 100, capacityHeadroomQty: 900 })?.qty, 500, "스파이크 클립(500)과 용량 여유(900) 중 작은 쪽");
assert.equal(planInbound({ onHand: 0, inTransit: 0, avgDailyBurn: 100, ropDays: 10, recentOrderQty: 1_000, capacityHeadroomQty: 400 })?.qty, 400, "용량 여유(400)가 스파이크 클립(5,000)보다 작으면 용량이 이긴다");

// 도착 정산: etaAt <= now 이고 아직 RECEIVED 아닌 PO만 입고
const now = new Date("2026-07-25T00:00:00Z");
const pos = [
  { _id: "po1", etaAt: new Date("2026-07-24T00:00:00Z"), qty: 50, materialId: "GAS-001", status: "ORDERED" },
  { _id: "po2", etaAt: new Date("2026-07-26T00:00:00Z"), qty: 30, materialId: "GAS-001", status: "ORDERED" },
  { _id: "po3", etaAt: new Date("2026-07-20T00:00:00Z"), qty: 10, materialId: "CHM-002", status: "RECEIVED" },
];
const res = settleArrivals(pos, now);
assert.deepEqual(res.arrivedPoIds, ["po1"], "도착 대상은 po1만");
assert.equal(res.receipts[0].qty, 50, "입고 수량");

// P1b 회귀: PENDING_APPROVAL(김구매 승인 대기)·REJECTED 상태는 etaAt이 지났어도 자동 입고되면
// 안 된다 — 승인 게이팅의 핵심 불변식이다. 승인 전까지는 실제로 발주가 나간 게 아니다.
const gated = [
  { _id: "po4", etaAt: new Date("2026-07-01T00:00:00Z"), qty: 999, materialId: "GAS-004", status: "PENDING_APPROVAL" },
  { _id: "po5", etaAt: new Date("2026-07-01T00:00:00Z"), qty: 999, materialId: "GAS-004", status: "REJECTED" },
];
const gatedRes = settleArrivals(gated, now);
assert.deepEqual(gatedRes.arrivedPoIds, [], "PENDING_APPROVAL·REJECTED는 자동 입고되면 안 된다");

// L0 회귀 배경: 박물류(LOGISTICS)가 목적창고를 CAPACITY_OVER로 판단하면, PO가 도착 시각이
// 됐어도 Twin이 자동으로 재고에 반영하면 안 된다 — 오늘 이것 때문에 창고가 654%까지 넘쳤다.
// 대신 heldPoIds로 분리해서 사람이 확인해야 실제 입고되게 한다.
const overCapacity = new Set(["WH-OVER"]);
const inboundCases = [
  { _id: "po6", etaAt: new Date("2026-07-01T00:00:00Z"), qty: 100, materialId: "GAS-001", status: "ORDERED", destinationWarehouseId: "WH-OVER" },
  { _id: "po7", etaAt: new Date("2026-07-01T00:00:00Z"), qty: 100, materialId: "GAS-001", status: "ORDERED", destinationWarehouseId: "WH-NORMAL" },
];
const inboundRes = settleArrivals(inboundCases, now, undefined, overCapacity);
assert.deepEqual(inboundRes.arrivedPoIds, ["po7"], "정상 창고행만 실제로 입고돼야 한다");
assert.deepEqual(inboundRes.heldPoIds, ["po6"], "용량초과 창고행은 보류(heldPoIds)로 분리돼야 한다");

// warehouseCapacityOver 파라미터가 없으면(호출부 안 바뀐 기존 코드) 기존처럼 전부 통과 — 하위호환
const backwardCompat = settleArrivals(inboundCases, now);
assert.deepEqual(backwardCompat.arrivedPoIds.sort(), ["po6", "po7"], "verdict 정보 없이 호출하면 기존 동작 그대로여야 한다");

// P2 회귀 배경: settleArrivals가 ORDERED/IN_TRANSIT만 처리하고 INBOUND_HOLD는 건드리지 않아서,
// 한 번 보류된 PO는 목적창고 용량이 정상으로 돌아와도 영원히 재정산되지 않았다. 게다가
// planInbound의 inTransit에는 계속 잡혀서 재발주까지 막혀, 재고 0인데도 영구 결품이 됐다
// (실관측: 자재 7종). INBOUND_HOLD도 매 tick 재평가해서 용량이 풀리면 자동 입고돼야 한다.
const releasedWhenCapacityFreed = settleArrivals(
  [{ _id: "po8", etaAt: new Date("2026-07-01T00:00:00Z"), qty: 40, materialId: "GAS-001", status: "INBOUND_HOLD", destinationWarehouseId: "WH-NORMAL" }],
  now,
  undefined,
  new Set<string>(), // 더 이상 CAPACITY_OVER 아님
);
assert.deepEqual(releasedWhenCapacityFreed.arrivedPoIds, ["po8"], "용량이 풀리면 INBOUND_HOLD도 자동 입고돼야 한다");
assert.equal(releasedWhenCapacityFreed.receipts[0]?.qty, 40, "해제된 PO의 수량이 입고 반영돼야 한다");

// 아직 용량이 안 풀렸으면 INBOUND_HOLD는 그대로 보류 유지 — 단, 이미 held였던 PO를 매 tick
// heldPoIds에 다시 넣지는 않는다(엔진의 held 카운트가 "이번 tick에 새로 보류된 건수"라는 의미를
// 유지하도록; 상태 갱신도 실제로는 no-op이라 불필요한 write를 피한다).
const stillHeld = settleArrivals(
  [{ _id: "po9", etaAt: new Date("2026-07-01T00:00:00Z"), qty: 40, materialId: "GAS-001", status: "INBOUND_HOLD", destinationWarehouseId: "WH-OVER" }],
  now,
  undefined,
  overCapacity,
);
assert.deepEqual(stillHeld.arrivedPoIds, [], "용량이 여전히 초과면 계속 보류돼야 한다");
assert.deepEqual(stillHeld.heldPoIds, [], "이미 보류 중인 PO를 매 tick 새로 보류된 것처럼 다시 세지 않는다");

// P3 회귀 배경(2026-08-11): 용량 초과로 보류하는 규칙과 자재 결품으로 라인을 세우는 규칙이
// 서로를 먹여 살리는 교착이 됐다 — 목적창고가 초과면 그 자재는 영원히 못 들어오고, 못 들어오니
// COVERAGE_CRITICAL이 풀리지 않아 라인이 계속 서고, 라인이 서면 소모가 없어 창고도 안 빠진다
// (실관측: 차단 로트 97~100%, 결품 유발 자재는 단 3종인데 그 3종의 보충분이 전부 INBOUND_HOLD).
// 실제 팹에서 라인을 세우는 것과 통로 적치 중 하나를 골라야 하면 후자를 고른다 — 결품 임박
// (COVERAGE_CRITICAL) 자재는 용량 초과여도 긴급 입고한다. 나머지 자재의 보류는 그대로 유지해서
// 창고가 무제한으로 넘치지는 않게 한다.
const urgentCases = [
  { _id: "po10", etaAt: new Date("2026-07-01T00:00:00Z"), qty: 100, materialId: "GAS-014", status: "ORDERED", destinationWarehouseId: "WH-OVER" },
  { _id: "po11", etaAt: new Date("2026-07-01T00:00:00Z"), qty: 100, materialId: "GAS-001", status: "ORDERED", destinationWarehouseId: "WH-OVER" },
];
const urgentRes = settleArrivals(urgentCases, now, undefined, overCapacity, new Set(["GAS-014"]));
assert.deepEqual(urgentRes.arrivedPoIds, ["po10"], "결품 임박 자재는 용량 초과여도 긴급 입고돼야 한다");
assert.deepEqual(urgentRes.heldPoIds, ["po11"], "그 외 자재는 지금까지처럼 보류");

// 이미 보류된 PO도 그 자재가 결품 임박으로 바뀌면 즉시 풀려야 한다 — 교착을 끊는 지점.
const heldThenUrgent = settleArrivals(
  [{ _id: "po12", etaAt: new Date("2026-07-01T00:00:00Z"), qty: 40, materialId: "GAS-014", status: "INBOUND_HOLD", destinationWarehouseId: "WH-OVER" }],
  now,
  undefined,
  overCapacity,
  new Set(["GAS-014"]),
);
assert.deepEqual(heldThenUrgent.arrivedPoIds, ["po12"], "보류 중이던 PO도 결품 임박이면 긴급 입고");

// 긴급 목록이 없으면(파라미터 미지정) 기존 동작 그대로 — 하위호환
assert.deepEqual(settleArrivals(urgentCases, now, undefined, overCapacity).arrivedPoIds, [], "긴급 목록 없이 호출하면 기존처럼 전부 보류");

// P4 회귀 배경(2026-08-12): 리드타임은 운영시간인데 도착 판정이 벽시계 etaAt으로 이뤄졌다.
// tick 간격(설정 5초 vs 실측 26.5초)이 어긋나면 벽시계 환산도 같이 어긋나서, 리드타임 5일짜리
// 발주가 실제로는 운영 0.94일 만에 도착했다(의도의 19%). 판정 근거를 운영시각으로 옮긴다
// (RULES.md § Twin 운영시간 — 재보충과 발주 ETA는 운영시간에 속한다).
{
  const opNow = operatingDaysToMs(100);
  const arrived = settleArrivals(
    [{ _id: "op1", etaAt: new Date("2099-01-01T00:00:00Z"), etaOperatingMs: operatingDaysToMs(99), qty: 10, materialId: "GAS-001", status: "ORDERED" }],
    now, opNow,
  );
  assert.deepEqual(arrived.arrivedPoIds, ["op1"], "운영시각이 ETA를 지났으면 벽시계 etaAt이 한참 미래여도 입고된다");

  const notYet = settleArrivals(
    [{ _id: "op2", etaAt: new Date("2000-01-01T00:00:00Z"), etaOperatingMs: operatingDaysToMs(101), qty: 10, materialId: "GAS-001", status: "ORDERED" }],
    now, opNow,
  );
  assert.deepEqual(notYet.arrivedPoIds, [], "운영시각이 ETA 전이면 벽시계가 지났어도 입고되지 않는다");
}

// 운영시계 도입 전에 나간 PO는 etaOperatingMs가 없다 — 벽시계 etaAt으로 정산해 하위호환을 지킨다.
{
  const legacy = settleArrivals(
    [{ _id: "legacy", etaAt: new Date("2026-07-24T00:00:00Z"), qty: 10, materialId: "GAS-001", status: "ORDERED" }],
    now, operatingDaysToMs(100),
  );
  assert.deepEqual(legacy.arrivedPoIds, ["legacy"], "etaOperatingMs가 없으면 벽시계 기준으로 정산");
}

// ── 벌크 탱크 물리 한도 ────────────────────────────────────────────────────────
// planInbound는 ROP에 닿으면 rop×2까지 채우는데, 그 양이 탱크에 안 들어가는 자재가 있었다
// (실측 2026-08-20: 12종, 정책목표가 탱크의 1.1~1.5배). 엔진은 capacityHeadroomQty를 SPACE
// 창고에만 넘겨서 탱크 자재는 용량 제약을 아예 안 봤다 — 담을 수 없는 양을 계속 주문했고,
// 그 자재들은 영구히 목표 미달로 살며 소모가 조금만 튀면 0으로 갔다.
{
  // onHand 0, burn 100/일, rop 10일 → rop=1000, 목표 rop×2=2000
  const base = { onHand: 0, inTransit: 0, avgDailyBurn: 100, ropDays: 10 };
  assert.deepEqual(planInbound(base), { qty: 2000 }, "한도가 없으면 rop×2까지 채운다");

  // 탱크가 1200밖에 안 되면 1200까지만 주문한다
  assert.deepEqual(
    planInbound({ ...base, capacityLimitQty: 1200 }), { qty: 1200 },
    "탱크 한도를 넘겨 주문하지 않는다",
  );

  // 이미 들어 있는 양은 한도에서 빼야 한다 — 현재고 900 + 주문 1200이면 탱크를 넘는다
  assert.deepEqual(
    planInbound({ ...base, onHand: 900, capacityLimitQty: 1200 }), { qty: 300 },
    "현재고를 뺀 잔여 용량까지만 주문한다",
  );

  // 미착 화물도 결국 이 탱크에 들어온다
  assert.deepEqual(
    planInbound({ ...base, onHand: 500, inTransit: 400, capacityLimitQty: 1200 }), { qty: 300 },
    "미착분도 탱크 잔여 용량에서 뺀다",
  );

  // 탱크가 이미 가득이면 주문하지 않는다
  assert.equal(
    planInbound({ ...base, onHand: 1200, capacityLimitQty: 1200 }), null,
    "탱크가 가득이면 발주 없음",
  );

  // 한도가 0이거나 음수면 무제한으로 해석하지 않는다
  assert.equal(planInbound({ ...base, capacityLimitQty: 0 }), null, "한도 0이면 발주 없음");
}

console.log("✅ twin inbound passed");
