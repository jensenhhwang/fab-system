import assert from "node:assert/strict";
import {
  detectOperationSignals,
  proposalDraftFor,
  type OperationObservationInput,
} from "../src/lib/operations-monitor";

const recordedAt = new Date("2026-08-20T12:00:00.000Z");

const base: OperationObservationInput = {
  recordedAt,
  operatingEpochMs: 1_296_000_000,
  engine: {
    status: "RUNNING",
    secondsSinceTick: 30,
    tickInProgress: false,
    lifeSign: "ALIVE",
    minutesSinceOutput: 1,
  },
  materials: [],
  procurement: { pendingApproval: 0, oldestPendingApprovalMinutes: 0, pendingOrders: [], openOrders: [] },
  inbound: { held: [] },
  production: { materialBlockedLots: 0, finishedGoodsHeldLots: 0 },
  warehouses: [],
  shipments: [],
  starvedMaterials: [],
  dataGaps: [],
};

assert.deepEqual(detectOperationSignals(base), [], "정상 관측에는 incident 신호가 없어야 한다");

{
  const signals = detectOperationSignals({
    ...base,
    engine: {
      status: "RUNNING",
      secondsSinceTick: 240,
      tickInProgress: false,
      lifeSign: "STOPPED",
      minutesSinceOutput: 61,
    },
    materials: [{
      materialId: "GAS-014",
      code: "GAS-014",
      state: "STOCKOUT",
      onHand: 0,
      coverageDays: 0,
      blockedLots: 120,
    }],
    procurement: {
      pendingApproval: 0,
      oldestPendingApprovalMinutes: 0,
      pendingOrders: [],
      openOrders: [{
        poId: "PO-TEOS",
        materialId: "GAS-014",
        etaOperatingMs: 2_400_000_000,
      }],
    },
  });

  assert.ok(signals.some((signal) => signal.kind === "ENGINE_STALE"));
  assert.ok(signals.some((signal) => signal.kind === "OUTPUT_STOPPED"));
  const stockout = signals.find((signal) => signal.kind === "MATERIAL_STOCKOUT");
  assert.ok(stockout && stockout.targetId === "GAS-014");
  assert.equal(new Set(signals.map((signal) => signal.fingerprint)).size, signals.length);
  const draft = proposalDraftFor(stockout);
  assert.equal(draft?.change.kind, "CODE_OR_POLICY_CHANGE");
  assert.equal(draft?.change.actionType, "REVIEW_REPLENISHMENT_GAP");
}

{
  const [pending] = detectOperationSignals({
    ...base,
    procurement: {
      pendingApproval: 1,
      oldestPendingApprovalMinutes: 90,
      pendingOrders: [{ poId: "PO-PENDING", materialId: "GAS-014", waitingMinutes: 90 }],
      openOrders: [{ poId: "PO-PENDING", materialId: "GAS-014", etaOperatingMs: null }],
    },
  });
  assert.equal(pending.kind, "PENDING_APPROVAL");
  assert.equal(pending.targetId, "PO-PENDING", "승인 제안은 집계가 아니라 개별 PO를 가리켜야 한다");
  assert.equal(proposalDraftFor(pending)?.change.actionType, "APPROVE_PURCHASE_ORDER");
}

{
  const [stockout] = detectOperationSignals({
    ...base,
    materials: [{
      materialId: "CSM-001",
      code: "CSM-001",
      state: "STOCKOUT",
      onHand: 0,
      coverageDays: 0,
      blockedLots: 10,
    }],
  });
  assert.equal(proposalDraftFor(stockout)?.change.actionType, "CREATE_INBOUND_PLAN_DRAFT");
}

{
  const signals = detectOperationSignals({
    ...base,
    inbound: { held: [{ poId: "PO-HOLD", materialId: "CHM-002", reason: "CAPACITY_OVER" }] },
    warehouses: [{ warehouseId: "WH-FG", utilization: 105, verdict: "CAPACITY_OVER", isFinishedGoods: true }],
    shipments: [{ product: "HBM", availableQuantity: 500, dueRemainingQty: 200, minutesSinceLastShipment: 61 }],
  });
  assert.ok(signals.some((signal) => signal.kind === "INBOUND_HOLD"));
  assert.ok(signals.some((signal) => signal.kind === "FG_CAPACITY_OVER"));
  assert.ok(signals.some((signal) => signal.kind === "SHIPMENT_STALLED"));
}

{
  const [gap] = detectOperationSignals({
    ...base,
    dataGaps: [{ source: "shipments", field: "shippedOperatingMs" }],
  });
  assert.equal(gap.kind, "DATA_GAP");
  assert.equal(proposalDraftFor(gap), null, "데이터 결손은 자동 개선안으로 승격하지 않는다");
}

console.log("✅ 운영 모니터 detector 테스트 통과");
