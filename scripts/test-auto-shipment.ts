import assert from "node:assert/strict";
import { planAutoShipments, type AutoShipmentLine } from "../src/lib/twin/auto-shipment";

// 출하가 사람이 버튼을 누를 때만 생겨서, 완제품 창고가 차면 마지막 공정이 막히고 라인이 섰다
// (실관측: 손으로 70%까지 비운 NAND 창고가 2시간 만에 192%로 재포화). tick이 계약 rate만큼
// 자동 출하하면 창고 포화가 구조적으로 해소된다. 배분 규칙을 순수함수로 고정한다.

const lines: AutoShipmentLine[] = [
  { customerId: "CUST-A", product: "NAND", contractType: "LTA", priorityTier: 1, contractedMonthlyQty: 30_000 },
  { customerId: "CUST-B", product: "NAND", contractType: "COMMITTED", priorityTier: 2, contractedMonthlyQty: 30_000 },
  { customerId: "CUST-E", product: "NAND", contractType: "SPOT", priorityTier: 3, contractedMonthlyQty: 0 },
];

// ── 재고가 충분하면 계약 일량 × simDays 만큼 나간다 ──
{
  // 월 30,000 → 일 1,000. simDays=1이면 각 1,000.
  const r = planAutoShipments({ lines, availableQty: 1_000_000, simDays: 1 });
  assert.equal(r.total, 2000, "LTA+COMMITTED만 나간다");
  assert.equal(r.allocations.length, 2);
  assert.equal(r.allocations.find((a) => a.customerId === "CUST-A")!.qty, 1000);
  assert.equal(r.allocations.find((a) => a.customerId === "CUST-B")!.qty, 1000);
  assert.ok(!r.allocations.some((a) => a.customerId === "CUST-E"), "스팟은 자동출하 대상이 아니다");
}

// ── simDays에 비례한다 ──
{
  const r = planAutoShipments({ lines, availableQty: 1_000_000, simDays: 0.5 });
  assert.equal(r.total, 1000, "simDays 절반이면 절반만");
}

// ── 재고가 모자라면 티어 순으로 자른다 ──
{
  // 필요 2,000인데 재고 1,200 → LTA가 1,000 먼저, 남은 200이 COMMITTED로
  const r = planAutoShipments({ lines, availableQty: 1_200, simDays: 1 });
  assert.equal(r.total, 1200, "가용 재고를 넘지 않는다");
  assert.equal(r.allocations.find((a) => a.customerId === "CUST-A")!.qty, 1000, "LTA가 먼저 채워진다");
  assert.equal(r.allocations.find((a) => a.customerId === "CUST-B")!.qty, 200, "남은 만큼만 COMMITTED로");
}

// ── 재고가 0이면 아무것도 안 나간다 ──
{
  const r = planAutoShipments({ lines, availableQty: 0, simDays: 1 });
  assert.equal(r.total, 0);
  assert.deepEqual(r.allocations, []);
}

// ── 재고를 절대 넘지 않는다 (폭주 방지의 핵심 불변식) ──
{
  for (const avail of [0, 1, 999, 1_999, 2_000, 5_000]) {
    const r = planAutoShipments({ lines, availableQty: avail, simDays: 3 });
    assert.ok(r.total <= avail, `배분 합(${r.total})이 가용재고(${avail})를 넘으면 안 된다`);
    assert.ok(r.allocations.every((a) => a.qty > 0), "0짜리 배분은 만들지 않는다");
  }
}

// ── 계약량을 넘지 않는다 (재고가 아무리 많아도) ──
{
  const r = planAutoShipments({ lines, availableQty: 10_000_000, simDays: 1 });
  assert.equal(r.total, 2000, "재고가 남아돌아도 계약 rate 이상은 안 나간다");
}

// ── 계약이 없는 제품이면 빈 결과 ──
{
  const r = planAutoShipments({ lines: [], availableQty: 1_000_000, simDays: 1 });
  assert.equal(r.total, 0);
}

// ── 소수점: 배분 합이 가용재고를 절대 초과하지 않도록 내림 처리 ──
{
  const tiny: AutoShipmentLine[] = [
    { customerId: "C1", product: "HBM", contractType: "LTA", priorityTier: 1, contractedMonthlyQty: 31 },
  ];
  const r = planAutoShipments({ lines: tiny, availableQty: 1_000, simDays: 0.001 });
  assert.ok(Number.isInteger(r.total), "정수 수량으로 떨어져야 한다");
  assert.ok(r.total >= 0);
}

console.log("✅ tick 자동출하 배분 테스트 통과");
