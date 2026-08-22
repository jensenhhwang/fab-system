import assert from "node:assert/strict";
import { buildLogisticsShadow, warehouseVerdict, type WarehouseSignal } from "../src/lib/logistics-agent";

function wh(over: Partial<WarehouseSignal>): WarehouseSignal {
  return { code: "WH-1", name: "테스트창고", utilization: 50, legalUtilization: null, ...over };
}

// 전부 정상이면 top 없음
{
  const report = buildLogisticsShadow([wh({})], 0, "2026-08-02T00:00:00Z");
  assert.equal(report.top, null);
}

// 100% 이상은 CAPACITY_OVER, 80% 이상은 CAPACITY_WATCH
{
  const report = buildLogisticsShadow([
    wh({ code: "A", utilization: 85 }),
    wh({ code: "B", utilization: 101 }),
  ], 0, "2026-08-02T00:00:00Z");
  assert.equal(report.top?.code, "B", "가장 높은 utilization이 top이어야 한다");
  assert.equal(report.top?.verdict, "CAPACITY_OVER");
}

{
  const report = buildLogisticsShadow([wh({ utilization: 85 })], 0, "2026-08-02T00:00:00Z");
  assert.equal(report.top?.verdict, "CAPACITY_WATCH");
}

// 법적 한도(legalUtilization)가 일반 utilization보다 높으면 그 기준으로 판정한다
{
  const report = buildLogisticsShadow([wh({ utilization: 50, legalUtilization: 102 })], 0, "2026-08-02T00:00:00Z");
  assert.equal(report.top?.verdict, "CAPACITY_OVER", "법적 한도 초과가 우선 반영돼야 한다");
}

// L0 회귀: Twin의 실제 입고 게이팅(settleArrivals)이 재사용하는 단일 창고 판정 함수 —
// 관제탑 표시용 계산과 실제 게이팅 계산이 따로 놀면 오늘처럼 다시 어긋난다.
assert.equal(warehouseVerdict(wh({ utilization: 101 })), "CAPACITY_OVER");
assert.equal(warehouseVerdict(wh({ utilization: 85 })), "CAPACITY_WATCH");
assert.equal(warehouseVerdict(wh({ utilization: 50 })), "INBOUND_NORMAL");
assert.equal(warehouseVerdict(wh({ utilization: 50, legalUtilization: 102 })), "CAPACITY_OVER", "법적 한도 초과 우선");

// L1 회귀 배경(2026-08-11): CONTINUOUS 모드 시설(UPW-01 초순수 생산시설)은 적치 개념이 없어
// getWarehouseCapacity가 occupancy를 항상 100으로 고정한다 — "탱크에 뭐가 얼마나 쌓였나"가
// 아니라 "현장에서 계속 만들어 Loop로 흘려보낸다"는 뜻이다. 그런데 warehouseVerdict는 이
// 고정값 100을 그대로 임계값(>=100)에 넣어 UPW-01을 영구 CAPACITY_OVER로 판정했다. 그 결과
// 이 시설을 목적창고로 하는 PO는 settleArrivals에서 무조건 INBOUND_HOLD로 묶이고(영구 결품),
// 관제탑 박물류 카드도 늘 "수용 한계 초과"를 최상단에 띄운다. inventory-policy.ts의
// capacityDecision은 같은 상황을 이미 "현장 연속공급 품목은 자동 기준수량 적용 대상이 아니다"로
// 제외하고 있었다 — 용량 판정에서 CONTINUOUS를 빼는 같은 규칙을 여기에도 적용한다.
assert.equal(warehouseVerdict(wh({ code: "UPW-01", utilization: 100, capacityMode: "CONTINUOUS" })), "INBOUND_NORMAL", "CONTINUOUS 시설의 100%는 포화가 아니라 '연속공급 중'이다");
assert.equal(warehouseVerdict(wh({ utilization: 100 })), "CAPACITY_OVER", "SPACE 모드 100%는 지금까지처럼 포화 판정");
assert.equal(warehouseVerdict(wh({ utilization: 100, capacityMode: "SPACE" })), "CAPACITY_OVER", "capacityMode를 명시해도 SPACE면 동일");
assert.equal(warehouseVerdict(wh({ utilization: 100, capacityMode: "TANK_LEVEL" })), "CAPACITY_OVER", "TANK_LEVEL은 실제 탱크 잔량이라 포화 판정 유지");
{
  // CONTINUOUS 시설이 그림자 리포트의 top(=사람이 봐야 할 1순위)을 늘 점유하던 것도 같이 풀린다.
  const report = buildLogisticsShadow([
    wh({ code: "UPW-01", utilization: 100, capacityMode: "CONTINUOUS" }),
    wh({ code: "MWH-01", utilization: 85 }),
  ], 0, "2026-08-11T00:00:00Z");
  assert.equal(report.top?.code, "MWH-01", "CONTINUOUS 시설은 랭킹에서 빠지고 실제 포화 위험만 남아야 한다");
  assert.equal(report.summary.over, 0, "CONTINUOUS 시설은 over 카운트에도 들어가면 안 된다");
}

console.log("✅ logistics-agent 규칙엔진 테스트 통과");
