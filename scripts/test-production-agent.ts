import assert from "node:assert/strict";
import { buildProductionShadow, buildAggregateProductionShadow, type WorkOrderSignal } from "../src/lib/production-agent";

function wo(over: Partial<WorkOrderSignal>): WorkOrderSignal {
  return { id: "WO-1", fabId: "M20", processCode: "P10", status: "RUNNING", ...over };
}

// 전부 RUNNING/QUEUED면 top 없음, ON_TRACK
{
  const report = buildProductionShadow([wo({ status: "RUNNING" }), wo({ id: "WO-2", status: "QUEUED" })], 100, "2026-08-02T00:00:00Z");
  assert.equal(report.top, null, "자재대기·보류가 없으면 top이 없어야 한다");
  assert.equal(report.summary.materialBlocked, 0);
}

// MATERIAL_WAIT가 HOLD보다 급하다(CRITICAL)
{
  const report = buildProductionShadow([
    wo({ id: "WO-HOLD", status: "HOLD" }),
    wo({ id: "WO-WAIT", status: "MATERIAL_WAIT" }),
  ], 100, "2026-08-02T00:00:00Z");
  assert.equal(report.top?.id, "WO-WAIT", "MATERIAL_WAIT가 HOLD보다 급하다");
  assert.equal(report.top?.verdict, "MATERIAL_BLOCKED");
}

// HOLD만 있으면 HOLD_RISK
{
  const report = buildProductionShadow([wo({ status: "HOLD" })], 100, "2026-08-02T00:00:00Z");
  assert.equal(report.top?.verdict, "HOLD_RISK");
}

// K1 회귀 배경: 관제탑의 최생산 판단이 legacy workOrders 컬렉션(M20_PILOT, /mes 폐기 후
// 더 이상 갱신 안 됨 — 실측: 2026-07-27 이후 정지)에 묶여있어서, 실제로 지금 이 순간
// 12,590/15,166개 로트가 자재차단 중인데도 화면엔 며칠 전 죽은 데이터가 그대로 떴다.
// advanceAggregateWip이 실제로 쓰는 라이브 신호(waferLots.materialBlockedAt/finishedGoodsHoldAt
// 집계)로 판단하게 한다.
{
  const report = buildAggregateProductionShadow({ fabId: "M20", inProgressCount: 15166, materialBlockedCount: 12590, finishedGoodsHoldCount: 0 }, "2026-08-08T00:00:00Z");
  assert.equal(report.top?.verdict, "MATERIAL_BLOCKED", "자재차단 로트가 있으면 MATERIAL_BLOCKED");
  assert.equal(report.summary.materialBlocked, 12590);
}

// 완제품 창고 포화로 막힌 로트만 있으면 HOLD_RISK
{
  const report = buildAggregateProductionShadow({ fabId: "M20", inProgressCount: 100, materialBlockedCount: 0, finishedGoodsHoldCount: 3 }, "2026-08-08T00:00:00Z");
  assert.equal(report.top?.verdict, "HOLD_RISK", "완제품창고 차단만 있으면 HOLD_RISK");
}

// 둘 다 없으면 ON_TRACK, top 없음
{
  const report = buildAggregateProductionShadow({ fabId: "M20", inProgressCount: 100, materialBlockedCount: 0, finishedGoodsHoldCount: 0 }, "2026-08-08T00:00:00Z");
  assert.equal(report.top, null, "차단이 없으면 top이 없어야 한다");
}

console.log("✅ production-agent 규칙엔진 테스트 통과");
