import assert from "node:assert/strict";
import {
  computeBayLoads,
  BAY_CAPACITY_TIGHT_THRESHOLD,
  BAY_CONGESTION_DEVIATION_PP,
  type BayLoadInput,
} from "../src/lib/process-bay-load";

// 배경: /usage의 "공정별 설비 대수·계획 부하" 카드와 "FAB 노드 밀도" 카드가 서로 다른 축을 써서
// 나란히 놓아도 대응이 안 됐다 — 전자는 processCode(P01~P10) × 설계 WSPM 정적 계획, 후자는
// routeMaster nodeId × 실시간 WIP. cell-array 노드 하나가 P02·P03·P04·P07을 포함하고 P07은
// cell-array에도 beol-metal에도 나오기 때문이다. 실측(2026-08-12): 계획 부하는 전 공정이
// 70~85%로 고른데 실제 WIP은 P03 45.6%·P07 36.6%에 몰리고 P02·P04는 0%였다.
//
// 이 모듈은 둘을 processCode라는 하나의 축 위에 올리고, 적체가 보이면 그 원인이 설비 부족인지
// 자재 결품인지까지 판정한다 — 화면에서 세 경우가 똑같이 보이던 문제를 없앤다.

function baseInput(over: Partial<BayLoadInput> = {}): BayLoadInput {
  return {
    // route: P01 1스텝, P03 2스텝, P07 1스텝 (총 4스텝)
    visits: [
      { stepIndex: 0, processCode: "P01" },
      { stepIndex: 1, processCode: "P03" },
      { stepIndex: 2, processCode: "P03" },
      { stepIndex: 3, processCode: "P07" },
    ],
    wipByStepIndex: { 0: 25, 1: 25, 2: 25, 3: 25 }, // 균등 = 정상 흐름
    materialsByProcess: { P01: ["GAS-001"], P03: ["CHM-003"], P07: ["CSM-001"] },
    stockoutMaterialIds: new Set<string>(),
    plannedLoadByProcess: { P01: 0.7, P03: 0.7, P07: 0.7 },
    equipmentCountByProcess: { P01: 9, P03: 66, P07: 62 },
    ...over,
  };
}

// ── 기대 비중은 route의 스텝 수 비중이다 ──────────────────────────────────────
// WIP이 스텝에 고르게 퍼져 있으면 각 공정의 WIP 비중은 그 공정이 차지하는 스텝 비중과 같다.
// P03은 4스텝 중 2스텝이므로 50%가 정상이다 — 이게 "적체"의 기준선이 된다.
{
  const loads = computeBayLoads(baseInput());
  const byCode = new Map(loads.map((l) => [l.processCode, l]));
  assert.equal(byCode.get("P01")!.expectedPercent, 25, "P01은 4스텝 중 1스텝 = 25%");
  assert.equal(byCode.get("P03")!.expectedPercent, 50, "P03은 4스텝 중 2스텝 = 50%");
  assert.equal(byCode.get("P03")!.actualPercent, 50, "WIP이 균등하면 실제도 50%");
  assert.equal(byCode.get("P03")!.deviationPp, 0, "기대와 실제가 같으면 편차 0");
  for (const l of loads) assert.equal(l.reason, "NORMAL", `${l.processCode}은 정상이어야 한다`);
}

// ── 적체 + 그 공정 자재가 결품이면 자재 원인으로 판정한다 ─────────────────────
// 실측 사례: P03(세정)에 WIP 45.6%가 몰렸는데 설비 계획 부하는 84.6%로 여유가 있었다.
// 원인은 설비가 아니라 CHM-003·004·005·010 결품이었다. 화면이 이 둘을 구분해야 한다.
{
  const loads = computeBayLoads(baseInput({
    wipByStepIndex: { 0: 0, 1: 45, 2: 45, 3: 10 }, // P03에 90% 적체
    stockoutMaterialIds: new Set(["CHM-003"]),
  }));
  const p03 = loads.find((l) => l.processCode === "P03")!;
  assert.equal(p03.actualPercent, 90, "P03 실제 90%");
  assert.equal(p03.deviationPp, 40, "기대 50% 대비 +40%p");
  assert.equal(p03.reason, "MATERIAL_BLOCKED", "결품 자재가 있으면 자재 원인");
  assert.deepEqual(p03.blockingMaterialIds, ["CHM-003"], "어느 자재 때문인지 짚어줘야 한다");
}

// ── 적체 + 설비 부하가 임계 이상이면 설비 원인으로 판정한다 ───────────────────
{
  const loads = computeBayLoads(baseInput({
    wipByStepIndex: { 0: 0, 1: 45, 2: 45, 3: 10 },
    plannedLoadByProcess: { P01: 0.7, P03: BAY_CAPACITY_TIGHT_THRESHOLD, P07: 0.7 },
  }));
  const p03 = loads.find((l) => l.processCode === "P03")!;
  assert.equal(p03.reason, "CAPACITY_TIGHT", "결품이 없고 설비 부하가 임계 이상이면 설비 원인");
  assert.deepEqual(p03.blockingMaterialIds, [], "자재 원인이 아니면 목록은 비어야 한다");
}

// 자재 결품과 설비 과부하가 겹치면 자재를 먼저 말한다 — 자재는 즉시 조치 가능한 원인이고
// 설비 증설은 몇 달짜리 결정이다. 둘 다 떠 있으면 사람이 무엇부터 볼지 흐려진다.
{
  const loads = computeBayLoads(baseInput({
    wipByStepIndex: { 0: 0, 1: 45, 2: 45, 3: 10 },
    stockoutMaterialIds: new Set(["CHM-003"]),
    plannedLoadByProcess: { P01: 0.7, P03: 0.99, P07: 0.7 },
  }));
  assert.equal(loads.find((l) => l.processCode === "P03")!.reason, "MATERIAL_BLOCKED", "자재 원인이 우선");
}

// ── 적체가 없으면 결품이어도 적체로 표시하지 않는다 ───────────────────────────
// 결품 자재를 쓰지만 아직 WIP이 안 쌓인 공정까지 빨갛게 칠하면 경보가 무의미해진다.
{
  const loads = computeBayLoads(baseInput({ stockoutMaterialIds: new Set(["CHM-003"]) }));
  const p03 = loads.find((l) => l.processCode === "P03")!;
  assert.equal(p03.reason, "NORMAL", "편차가 없으면 결품 자재가 있어도 적체가 아니다");
  assert.deepEqual(p03.blockingMaterialIds, ["CHM-003"], "다만 결품 사실 자체는 계속 알려준다");
}

// 편차 임계 미만은 정상으로 본다 — 흐름은 원래 조금씩 출렁인다.
{
  const justUnder = BAY_CONGESTION_DEVIATION_PP - 1;
  const loads = computeBayLoads(baseInput({
    // P03 기대 50% → 실제 (50 + justUnder)%
    wipByStepIndex: { 0: (50 - justUnder) / 2, 1: (50 + justUnder) / 2, 2: (50 + justUnder) / 2, 3: (50 - justUnder) / 2 },
    stockoutMaterialIds: new Set(["CHM-003"]),
  }));
  assert.equal(loads.find((l) => l.processCode === "P03")!.reason, "NORMAL", "임계 미만 편차는 정상");
}

// ── WIP이 0인 공정(비어 있음)도 편차로 드러나야 한다 ──────────────────────────
// 실측: P02·P04는 계획 부하 84%인데 실제 WIP 0%였다. 앞 공정이 막혀 굶고 있다는 신호다.
{
  const loads = computeBayLoads(baseInput({ wipByStepIndex: { 0: 0, 1: 50, 2: 50, 3: 0 } }));
  const p07 = loads.find((l) => l.processCode === "P07")!;
  assert.equal(p07.actualPercent, 0, "P07 WIP 없음");
  assert.equal(p07.deviationPp, -25, "기대 25% 대비 -25%p");
  assert.equal(p07.reason, "STARVED", "기대보다 크게 비어 있으면 STARVED");
}

// ── WIP이 전혀 없으면(라인 정지) 비율을 0으로 나누지 않는다 ───────────────────
{
  const loads = computeBayLoads(baseInput({ wipByStepIndex: {} }));
  for (const l of loads) {
    assert.equal(l.actualPercent, 0, "WIP 총계 0이면 실제 비중도 0");
    assert.ok(Number.isFinite(l.deviationPp), `${l.processCode} 편차가 유한해야 한다`);
  }
}

// ── route에 없는 공정은 결과에 넣지 않는다 ────────────────────────────────────
// 설비 마스터에는 P05가 있어도 그 fab의 route가 P05를 안 지나면 bay 부하가 성립하지 않는다.
{
  const loads = computeBayLoads(baseInput({
    plannedLoadByProcess: { P01: 0.7, P03: 0.7, P07: 0.7, P05: 0.73 },
    equipmentCountByProcess: { P01: 9, P03: 66, P07: 62, P05: 13 },
  }));
  assert.equal(loads.find((l) => l.processCode === "P05"), undefined, "route가 안 지나는 공정은 제외");
  assert.equal(loads.length, 3, "route가 지나는 3개 공정만");
}

// ── 설비 대수·계획 부하는 그대로 실어 보낸다(3D bay 렌더링이 같이 쓴다) ────────
{
  const loads = computeBayLoads(baseInput());
  const p03 = loads.find((l) => l.processCode === "P03")!;
  assert.equal(p03.equipmentCount, 66, "설비 대수 전달");
  assert.equal(p03.plannedLoad, 0.7, "계획 부하 전달");
}

// 계획 부하가 없는 공정(평가 보류 — M20 P05·P10 등)도 안전하게 처리한다.
{
  const loads = computeBayLoads(baseInput({ plannedLoadByProcess: { P01: 0.7, P03: null, P07: 0.7 } }));
  const p03 = loads.find((l) => l.processCode === "P03")!;
  assert.equal(p03.plannedLoad, null, "계획 부하 N/A는 null로");
  assert.equal(p03.reason, "NORMAL", "계획 부하가 없다고 CAPACITY_TIGHT로 단정하면 안 된다");
}

console.log("✅ process bay load 규칙 테스트 통과");
