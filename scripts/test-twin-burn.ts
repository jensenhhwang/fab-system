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

// 스텝0을 100웨이퍼, 스텝1을 50웨이퍼가 통과
const burn = computeBurn({ 0: 100, 1: 50 }, sc);
// GAS-001 = 100*0.2 + 50*0.3 = 35, CHM-002 = 100*0.02 = 2
assert.ok(Math.abs((burn.get("GAS-001") ?? 0) - 35) < 1e-9, "GAS-001 소모 합산");
assert.ok(Math.abs((burn.get("CHM-002") ?? 0) - 2) < 1e-9, "CHM-002 소모");

// 소모 자재가 없는 스텝은 무시, 빈 입력은 빈 결과
assert.equal(computeBurn({}, sc).size, 0, "빈 진행은 소모 없음");

console.log("✅ twin burn passed");
