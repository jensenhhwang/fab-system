import assert from "node:assert/strict";
import {
  buildContractLines,
  contractTypeFor,
  designMonthlyOutput,
  fulfillmentPctOf,
  TIER_SHARE,
} from "../src/lib/customer-contracts";
import { finishedGoodsUnit } from "../src/lib/finished-goods";

// 계약이 제품 구분 없는 단일 숫자(contractedMonthlyQty)라, 이번 달 출하를 customerId로만
// group·$sum 해서 HBM STACK과 NAND DIE를 더한 뒤 HBM 기준 분모로 나누고 있었다
// (실관측: CUST-A 이행률 820%). 여기서 계약을 제품축으로 쪼갠다.

// ── 제품별 월 설계산출: 팹 config × 웨이퍼당 완제품 환산 ──
{
  assert.equal(Math.round(designMonthlyOutput("HBM")), 5_703_750, "HBM 월 설계산출");
  assert.equal(Math.round(designMonthlyOutput("DRAM")), 136_862_880, "DRAM 월 설계산출");
  assert.equal(Math.round(designMonthlyOutput("NAND")), 129_496_320, "NAND 월 설계산출");
}

// ── 계약 유형: 스팟은 계약물량 개념이 없다 ──
{
  assert.equal(contractTypeFor(1), "LTA", "Tier-1은 장기계약");
  assert.equal(contractTypeFor(2), "COMMITTED", "Tier-2는 커밋 물량");
  assert.equal(contractTypeFor(3), "SPOT", "Tier-3은 스팟");
}

// ── 계약 라인: 고객 × 제품 ──
{
  const customers = [
    { _id: "CUST-A", name: "고객사 A", priorityTier: 1 as const },
    { _id: "CUST-E", name: "고객사 E", priorityTier: 3 as const },
  ];
  const lines = buildContractLines(customers);
  assert.equal(lines.length, 6, "고객 2 × 제품 3 = 6개 라인");

  const aHbm = lines.find((l) => l.customerId === "CUST-A" && l.product === "HBM")!;
  assert.equal(aHbm.contractType, "LTA");
  assert.equal(aHbm.unit, "STACK");
  assert.equal(aHbm.contractedMonthlyQty, Math.round(designMonthlyOutput("HBM") * TIER_SHARE["CUST-A"]));

  // 제품마다 단위가 다르다 — 예전 화면은 NAND 출하량에도 STACK을 붙이고 있었다
  for (const l of lines) {
    assert.equal(l.unit, finishedGoodsUnit(l.product), `${l.product} 단위가 제품 config와 같아야 한다`);
  }

  // 스팟 라인은 계약물량이 없다
  const eNand = lines.find((l) => l.customerId === "CUST-E" && l.product === "NAND")!;
  assert.equal(eNand.contractType, "SPOT");
  assert.equal(eNand.contractedMonthlyQty, 0, "스팟은 계약물량 개념이 없으므로 0");
}

// ── 이행률: 스팟은 계산하지 않는다(퍼센트가 존재하지 않는 개념) ──
{
  assert.equal(fulfillmentPctOf({ contractType: "LTA", contractedMonthlyQty: 1000 }, 500), 50);
  assert.equal(fulfillmentPctOf({ contractType: "LTA", contractedMonthlyQty: 1000 }, 2579), 258, "초과도 그대로 드러낸다");
  assert.equal(fulfillmentPctOf({ contractType: "SPOT", contractedMonthlyQty: 0 }, 999), null, "스팟은 이행률 없음");
  assert.equal(fulfillmentPctOf({ contractType: "LTA", contractedMonthlyQty: 0 }, 100), null, "계약 0이면 판정 불가");
}

// ── 전체 고객 시드에서 티어 비율 합이 1이어야 한다 ──
{
  const sum = Object.values(TIER_SHARE).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `티어 비율 합이 1이어야 한다 (현재 ${sum})`);
}

console.log("✅ 고객 계약 제품축 분리 테스트 통과");
