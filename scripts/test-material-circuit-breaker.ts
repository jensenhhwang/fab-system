import assert from "node:assert/strict";
import { isLotMaterialBlocked } from "../src/lib/lot-route";
import type { StepConsumption } from "../src/lib/twin/burn";

// 회귀 배경: 이자재(MATERIALS)가 COVERAGE_CRITICAL로 판단한 자재를 다음 스텝에 쓰는 로트가
// "자재 없이 공정을 통과한" 물리적 모순 없이 실제로 멈춰야 한다. WIP 진행(최생산 도메인)과
// 자재 소모(이자재 도메인)는 advanceAggregateWip 한 지점에서 같이 게이팅된다(패브 검증).
const stepConsumption: StepConsumption = new Map([
  [3, [{ materialId: "GAS-001", equivalentPerWafer: 1 }, { materialId: "CHM-002", equivalentPerWafer: 1 }]],
  [7, [{ materialId: "PKG-001", equivalentPerWafer: 1 }]],
]);

// 다음 스텝(fromStep)에서 쓰는 자재가 차단 목록에 있으면 막힌다
assert.equal(isLotMaterialBlocked(3, stepConsumption, new Set(["GAS-001"])), true, "차단 자재를 쓰는 스텝은 막혀야 한다");
assert.equal(isLotMaterialBlocked(3, stepConsumption, new Set(["CHM-002"])), true, "여러 자재 중 하나만 걸려도 막혀야 한다");

// 차단 목록에 없는 자재를 쓰는 스텝은 안 막힌다
assert.equal(isLotMaterialBlocked(7, stepConsumption, new Set(["GAS-001"])), false, "관련 없는 자재 차단은 영향 없어야 한다");

// 이 스텝에서 아무 자재도 안 쓰면(stepConsumption에 없는 stepIndex) 절대 안 막힌다
assert.equal(isLotMaterialBlocked(99, stepConsumption, new Set(["GAS-001"])), false, "소비가 없는 스텝은 차단 대상이 아니다");

// 차단 목록이 비어있으면 아무것도 안 막힌다(정상 상태)
assert.equal(isLotMaterialBlocked(3, stepConsumption, new Set()), false, "차단 목록이 비어있으면 아무것도 안 막혀야 한다");

console.log("✅ 자재 서킷브레이커(isLotMaterialBlocked) 테스트 통과");
