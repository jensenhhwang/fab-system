import assert from "node:assert/strict";
import { blockingMaterialIds, buildMaterialsShadow, coverageState, criticalMaterialIds, type MaterialSignal } from "../src/lib/materials-agent";

// coverageState: 재고/일소모/ROP로 4단계 분류 (procurement 스냅샷 빌더와 동일 규칙)
assert.equal(coverageState(0, 10, 5), "STOCKOUT", "재고 0이면 STOCKOUT");
assert.equal(coverageState(100, 0, 5), "NO_BURN", "소모율 0이면 NO_BURN(데이터 갭)");
assert.equal(coverageState(10, 10, 10), "CRITICAL", "커버리지가 ROP의 절반 미만이면 CRITICAL");
assert.equal(coverageState(70, 10, 10), "BELOW_ROP", "커버리지가 ROP 미만이면 BELOW_ROP");
assert.equal(coverageState(200, 10, 10), "NORMAL", "커버리지가 ROP 이상이면 NORMAL");

function signal(over: Partial<MaterialSignal>): MaterialSignal {
  return {
    materialId: "MAT-1", code: "MAT-1", name: "테스트자재", unit: "kg",
    ropDays: 5, quantity: 1000, dailyBurn: 100, coverageDays: 10, state: "NORMAL",
    ...over,
  };
}

// 전부 정상이면 top은 null, verdict는 COVERAGE_NORMAL
{
  const report = buildMaterialsShadow([signal({})], "2026-08-02T00:00:00Z");
  assert.equal(report.top, null, "정상 자재만 있으면 top이 없어야 한다");
  assert.equal(report.summary.critical, 0);
}

// STOCKOUT/CRITICAL이 BELOW_ROP보다 우선순위가 높다
{
  const report = buildMaterialsShadow([
    signal({ code: "A", state: "BELOW_ROP", coverageDays: 4 }),
    signal({ code: "B", state: "STOCKOUT", coverageDays: 0, quantity: 0 }),
  ], "2026-08-02T00:00:00Z");
  assert.equal(report.top?.code, "B", "STOCKOUT이 BELOW_ROP보다 급하다");
  assert.equal(report.top?.verdict, "COVERAGE_CRITICAL");
}

// NO_BURN(DATA_GAP)은 CRITICAL/BELOW_ROP보다 덜 급한 것으로 취급한다
{
  const report = buildMaterialsShadow([
    signal({ code: "C", state: "NO_BURN", coverageDays: null, dailyBurn: 0 }),
    signal({ code: "D", state: "BELOW_ROP", coverageDays: 4 }),
  ], "2026-08-02T00:00:00Z");
  assert.equal(report.top?.code, "D", "실측 부족(BELOW_ROP)이 데이터갭보다 급하다");
  assert.equal(report.top?.verdict, "COVERAGE_WATCH");
}

assert.equal(
  buildMaterialsShadow([signal({ state: "NO_BURN", coverageDays: null, dailyBurn: 0 })], "2026-08-02T00:00:00Z").top?.verdict,
  "DATA_GAP",
  "NO_BURN만 있으면 DATA_GAP verdict",
);

// M0 회귀: 최생산(WIP 진행)·이자재(소모 반영)를 게이팅하려면 "지금 COVERAGE_CRITICAL인
// 자재 id 집합"이 필요하다 — advanceAggregateWip가 다음 스텝에 이 자재를 쓰는 로트를
// 배치에서 제외하는 데 쓴다. STOCKOUT/CRITICAL만 차단 대상이고 BELOW_ROP/NO_BURN/NORMAL은
// 아직 여유가 있으니 차단하면 안 된다.
{
  const ids = criticalMaterialIds([
    signal({ materialId: "M-STOCKOUT", state: "STOCKOUT" }),
    signal({ materialId: "M-CRITICAL", state: "CRITICAL" }),
    signal({ materialId: "M-WATCH", state: "BELOW_ROP" }),
    signal({ materialId: "M-GAP", state: "NO_BURN" }),
    signal({ materialId: "M-NORMAL", state: "NORMAL" }),
  ]);
  assert.deepEqual([...ids].sort(), ["M-CRITICAL", "M-STOCKOUT"], "STOCKOUT·CRITICAL만 긴급 대상");
}

// M1 회귀 배경(2026-08-11): criticalMaterialIds 하나가 "라인을 세울 자재"와 "긴급 조달할 자재"
// 양쪽에 같이 쓰이면서, 재고가 넉넉한데도 라인이 서는 상황이 나왔다 — 실관측: 라인을 세우던
// 6종 중 4종이 재고 보유 상태였고, PKG-LBD-001은 재고 862만 개·커버리지 13.5일인데
// ropDays(30) × 0.5 = 15일에 못 미친다는 이유로 전체 라인을 세우고 있었다.
//
// 게다가 이 임계는 재주문 정책과 구조적으로 충돌한다(docs/fab-operating-baseline.md R1):
// 재주문은 커버리지가 max(ropDays, 리드타임)일 때 걸리는데 화물은 리드타임 뒤에 오므로,
// ropDays < 2 × 리드타임인 자재는 발주가 제때 나가도 도착 전에 ropDays×0.5를 지나 라인이 선다
// (44종 중 17종이 해당). 실제 팹은 커버리지 며칠 남았다고 라인을 세우지 않고 긴급 조달로 대응한다.
//
// 두 신호의 역할을 나눈다:
//   CRITICAL(+STOCKOUT) → 긴급 조달 신호(용량 초과여도 입고, §twin/inbound settleArrivals)
//   STOCKOUT            → 라인 차단 신호(자재가 실제로 없으면 물리적으로 공정을 못 지난다)
{
  const ids = blockingMaterialIds([
    signal({ materialId: "M-STOCKOUT", state: "STOCKOUT" }),
    signal({ materialId: "M-CRITICAL", state: "CRITICAL" }),
    signal({ materialId: "M-WATCH", state: "BELOW_ROP" }),
    signal({ materialId: "M-GAP", state: "NO_BURN" }),
    signal({ materialId: "M-NORMAL", state: "NORMAL" }),
  ]);
  assert.deepEqual([...ids], ["M-STOCKOUT"], "라인은 재고가 실제로 0일 때만 세운다");
}

// 차단 대상은 반드시 긴급 대상의 부분집합이어야 한다 — 라인을 세울 만큼 급한 자재가
// 긴급 조달 대상에서 빠지면 그 자재는 영영 안 들어오고 라인도 안 풀린다.
{
  const signals = [
    signal({ materialId: "A", state: "STOCKOUT" }),
    signal({ materialId: "B", state: "CRITICAL" }),
    signal({ materialId: "C", state: "BELOW_ROP" }),
  ];
  const blocking = blockingMaterialIds(signals);
  const urgent = criticalMaterialIds(signals);
  for (const id of blocking) {
    assert.ok(urgent.has(id), `차단 대상 ${id}는 긴급 조달 대상에도 들어 있어야 한다`);
  }
}

console.log("✅ materials-agent 규칙엔진 테스트 통과");
