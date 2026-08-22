import assert from "node:assert/strict";
import { buildStepConsumption, computeBurn } from "../src/lib/twin/burn";

// 스텝0=P01, 스텝1=P02, 스텝2=P01(재방문)
const visits = [
  { stepIndex: 0, processCode: "P01" },
  { stepIndex: 1, processCode: "P02" },
  { stepIndex: 2, processCode: "P01" },
];
const rows = [
  { materialId: "GAS-001", processCode: "P01", equivalentPerWafer: 0.2 },
  { materialId: "GAS-001", processCode: "P02", equivalentPerWafer: 0.3 },
  { materialId: "CHM-002", processCode: "P01", equivalentPerWafer: 0.02 },
];

const sc = buildStepConsumption(visits, rows);
assert.equal(sc.get(0)?.length, 2, "P01 스텝은 GAS-001+CHM-002 두 자재 소모");
assert.equal(sc.get(1)?.length, 1, "P02 스텝은 GAS-001만");

// 스텝0을 100웨이퍼, 스텝1을 50웨이퍼가 통과.
// P01은 2회 방문(스텝0·2)이므로 방문당 원단위의 절반이다 — 예전에는 방문마다 전액을
// 부과해 P01 자재를 2배로 먹었다(2026-08-22 수정).
// GAS-001 = 100*(0.2/2) + 50*0.3 = 25, CHM-002 = 100*(0.02/2) = 1
const burn = computeBurn({ 0: 100, 1: 50 }, sc);
assert.ok(Math.abs((burn.get("GAS-001") ?? 0) - 25) < 1e-9, "GAS-001 소모 합산");
assert.ok(Math.abs((burn.get("CHM-002") ?? 0) - 1) < 1e-9, "CHM-002 소모");

// 소모 자재가 없는 스텝은 무시, 빈 입력은 빈 결과
assert.equal(computeBurn({}, sc).size, 0, "빈 진행은 소모 없음");

// ── 방문 횟수 분배 ──────────────────────────────────────────────────────────────
// equivalentPerWafer는 "월 총소요량 ÷ 월 웨이퍼 투입수"로 만든 값이다
// (material-consumption.ts). 즉 웨이퍼 1장이 route를 **완주하는 동안 쓰는 총량**이지
// 방문 1회당 양이 아니다.
//
// 예전에는 같은 processCode를 지날 때마다 그 값을 통째로 부과했다. M22 route는 256 스텝 중
// P02를 162번 지나므로 GAS-004·006·014를 162배 먹었다(실측 2026-08-22: 라인이 막혀 처리량이
// 설계의 몇 %라 겉으로는 4~6배로 보였다). 리필을 해도 하루를 못 간 이유다.
{
  const visits = [
    { stepIndex: 0, processCode: "P02" },
    { stepIndex: 1, processCode: "P07" },
    { stepIndex: 2, processCode: "P02" },
    { stepIndex: 3, processCode: "P02" },
  ];
  const rows = [
    { materialId: "GAS-006", processCode: "P02", equivalentPerWafer: 30 },
    { materialId: "CSM-001", processCode: "P07", equivalentPerWafer: 7 },
  ];
  const sc = buildStepConsumption(visits, rows);

  // P02를 3번 지나므로 방문당 1/3씩 나눠 갖는다
  assert.equal(sc.get(0)?.[0].equivalentPerWafer, 10, "3회 방문이면 방문당 1/3");
  assert.equal(sc.get(2)?.[0].equivalentPerWafer, 10);
  assert.equal(sc.get(3)?.[0].equivalentPerWafer, 10);
  // 1회만 지나는 공정은 그대로
  assert.equal(sc.get(1)?.[0].equivalentPerWafer, 7, "1회 방문이면 전액");

  // route를 완주한 웨이퍼 1장의 총 소모 = equivalentPerWafer와 정확히 같아야 한다
  const advancedAll = { 0: 1, 1: 1, 2: 1, 3: 1 };
  const burn = computeBurn(advancedAll, sc);
  assert.equal(burn.get("GAS-006"), 30, "완주 시 총 소모가 웨이퍼당 원단위와 일치");
  assert.equal(burn.get("CSM-001"), 7);
}

console.log("✅ twin burn passed");
