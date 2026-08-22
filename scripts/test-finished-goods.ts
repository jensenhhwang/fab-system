import assert from "node:assert/strict";
import { finishedGoodsPerWafer, FINISHED_GOODS_UNIT } from "../src/lib/finished-goods";
import { M20_HBM_OUTPUT_MODEL } from "../src/lib/fab-scenario";

// fab-scenario.ts에 이미 있는 M20_HBM_OUTPUT_MODEL(계획 기준 완제품 환산 가정)을
// 그대로 재사용한다 — 새 숫자를 만들지 않는다. knownGoodDiesPerWafer ÷ stackDieCount ×
// assemblyYield = 웨이퍼 1장당 완성 스택 수.
const expected = (M20_HBM_OUTPUT_MODEL.knownGoodDiesPerWafer / M20_HBM_OUTPUT_MODEL.stackDieCount)
  * M20_HBM_OUTPUT_MODEL.assemblyYield;

assert.equal(finishedGoodsPerWafer(), expected, "웨이퍼당 완제품 환산은 M20_HBM_OUTPUT_MODEL 가정을 그대로 따라야 한다");
assert.ok(finishedGoodsPerWafer() > 0, "환산값은 양수여야 한다");
assert.equal(FINISHED_GOODS_UNIT, "STACK", "완제품 단위는 STACK");

console.log("✅ finished-goods 환산 테스트 통과");
