import assert from "node:assert/strict";
import {
  campusScenarioMetrics,
  FAB_SCENARIO,
  fabScenarioMetrics,
  m20ProductionScenarioMetrics,
} from "../src/lib/fab-scenario";

const [m20, m21, m22] = FAB_SCENARIO.map(fabScenarioMetrics);
assert.equal(Math.round(m20.effectiveWspm), 99_450, "M20 유효 WSPM");
assert.equal(Math.round(m21.effectiveWspm), 66_240, "M21 유효 WSPM");
assert.equal(Math.round(m22.effectiveWspm), 79_200, "M22 유효 WSPM");
assert.ok(Math.abs(m20.waferEquivalentSharePct - 22.1) < 0.05, "M20 설계비중");
const campus = campusScenarioMetrics();
assert.equal(campus.nominalWspm, 310_000, "캠퍼스 명목 WSPM");
assert.equal(Math.round(campus.effectiveWspm), 244_890, "캠퍼스 유효 WSPM");

assert.equal(m20ProductionScenarioMetrics("NORMAL").targetWip, 16_380, "NORMAL 목표 WIP");
assert.equal(m20ProductionScenarioMetrics("NORMAL").grossDiesPerWafer, 765, "wafer당 gross DRAM die");
assert.equal(m20ProductionScenarioMetrics("NORMAL").knownGoodDiesPerWafer, 650, "wafer당 양품 DRAM die");
assert.ok(Math.abs(m20ProductionScenarioMetrics("NORMAL").theoreticalStacksPerWafer - 54.1666666667) < 0.000001, "wafer당 이론 HBM4 12-Hi stack");
assert.equal(m20ProductionScenarioMetrics("NORMAL").finishedHbmStacksPerWafer, 48.75, "wafer당 양품 HBM4 12-Hi");
assert.equal(m20ProductionScenarioMetrics("NORMAL").finishedHbmStacks, 5_703_750, "NORMAL HBM4 12-Hi 완제품 환산");
assert.equal(m20ProductionScenarioMetrics("NORMAL").grossStackStarts, 6_337_500, "NORMAL gross HBM stack starts");
assert.equal(m20ProductionScenarioMetrics("NORMAL").baseDieKgdsForAssembly, 6_337_500, "P10 Base Die KGD 실투입");
assert.equal(m20ProductionScenarioMetrics("NORMAL").baseDiePurchaseRequirement, 6_401_516, "99% 입고합격률 가정 Base Die 발주 필요량");
assert.equal(m20ProductionScenarioMetrics("NORMAL").finishedHbmCapacityGb, 205_335_000, "NORMAL HBM4 12-Hi 36GB 총 용량");
assert.equal(m20ProductionScenarioMetrics("NORMAL").finishedHbmCapacityPbDecimal, 205.335, "NORMAL HBM4 12-Hi 36GB PB 환산");
assert.equal(m20ProductionScenarioMetrics("UPLIFT").referenceWip, 17_290, "UPLIFT 105일 참조 WIP");
assert.equal(m20ProductionScenarioMetrics("UPLIFT").targetWip, 18_443, "UPLIFT 계획 WIP");
assert.equal(m20ProductionScenarioMetrics("NAMEPLATE").targetWip, 21_840, "NAMEPLATE 계획 WIP");
assert.equal(m20ProductionScenarioMetrics("NAMEPLATE").finishedHbmStacks, 6_337_500, "NAMEPLATE HBM4 12-Hi 완제품 환산");
assert.equal(m20ProductionScenarioMetrics("EXPANSION").targetWip, 20_020, "EXPANSION 계획 WIP");
console.log("✅ fab scenario rules passed");
