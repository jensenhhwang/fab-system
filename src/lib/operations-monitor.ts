import { createHash } from "node:crypto";

export const OPERATION_MONITOR_POLICY_VERSION = "OPERATION_MONITOR_V1";
export const ENGINE_STALE_AFTER_SECONDS = 180;
export const SHIPMENT_STALLED_AFTER_MINUTES = 60;

export type OperationRole = "PROCUREMENT" | "MATERIALS" | "PRODUCTION" | "LOGISTICS";
export type OperationSeverity = "ATTENTION" | "CRITICAL";
export type EvidenceValue = string | number | boolean | null;
export type JsonValue = EvidenceValue | JsonValue[] | { [key: string]: JsonValue };

export type OperationSignalKind =
  | "ENGINE_STALE"
  | "OUTPUT_STOPPED"
  | "MATERIAL_STOCKOUT"
  | "MATERIAL_CRITICAL"
  | "EMA_STARVATION"
  | "PENDING_APPROVAL"
  | "INBOUND_HOLD"
  | "FG_CAPACITY_OVER"
  | "SHIPMENT_STALLED"
  | "DATA_GAP"
  | "MONITOR_FAILURE";

export type OperationObservationInput = {
  recordedAt: Date;
  operatingEpochMs: number;
  engine: {
    status: "RUNNING" | "PAUSED";
    secondsSinceTick: number | null;
    tickInProgress: boolean;
    lifeSign: "ALIVE" | "DEGRADED" | "STOPPED";
    minutesSinceOutput: number | null;
  };
  materials: Array<{
    materialId: string;
    code: string;
    state: "STOCKOUT" | "CRITICAL" | "BELOW_ROP" | "NO_BURN" | "NORMAL";
    onHand: number;
    coverageDays: number | null;
    blockedLots: number;
  }>;
  procurement: {
    pendingApproval: number;
    oldestPendingApprovalMinutes: number;
    pendingOrders: Array<{
      poId: string;
      materialId: string;
      waitingMinutes: number;
    }>;
    openOrders: Array<{
      poId: string;
      materialId: string;
      etaOperatingMs: number | null;
    }>;
  };
  inbound: {
    held: Array<{
      poId: string;
      materialId: string;
      reason: string | null;
    }>;
  };
  production: {
    materialBlockedLots: number;
    finishedGoodsHeldLots: number;
  };
  warehouses: Array<{
    warehouseId: string;
    utilization: number;
    verdict: "NORMAL" | "WATCH" | "CAPACITY_OVER";
    isFinishedGoods?: boolean;
  }>;
  shipments: Array<{
    product: "HBM" | "DRAM" | "NAND";
    availableQuantity: number;
    dueRemainingQty: number;
    minutesSinceLastShipment: number | null;
  }>;
  starvedMaterials: Array<{
    materialId: string;
    code: string;
    avgDailyBurn: number;
    designDaily: number;
  }>;
  dataGaps: Array<{ source: string; field: string }>;
};

export type OperationSignal = {
  kind: OperationSignalKind;
  targetId: string;
  fingerprint: string;
  policyVersion: typeof OPERATION_MONITOR_POLICY_VERSION;
  severity: OperationSeverity;
  affectedRoles: OperationRole[];
  summary: string;
  evidence: Record<string, EvidenceValue>;
  releaseCondition: string;
  recordedAt: Date;
  operatingEpochMs: number;
};

export type OperationProposalChange = {
  kind: "ALLOWLIST_ACTION" | "CODE_OR_POLICY_CHANGE";
  actionType: string;
  targetId: string;
  before: JsonValue;
  after: JsonValue;
};

export type OperationProposalDraft = {
  kind: OperationSignalKind;
  proposedByRole: OperationRole;
  change: OperationProposalChange;
  expectedEffects: string[];
  risks: string[];
  evidenceRefs: string[];
  validationPlan: string[];
  rollbackPlan: string[];
};

export type OperationMonitorView = {
  generatedAt: string;
  canDecide: boolean;
  incidents: Array<{
    id: string;
    kind: OperationSignalKind;
    severity: OperationSeverity;
    status: "OBSERVED" | "ANALYZED" | "PROPOSED" | "RECOVERED";
    summary: string;
    affectedRoles: OperationRole[];
    firstObservedAt: string;
    lastObservedAt: string;
    observationCount: number;
    latestEvidence: Record<string, EvidenceValue>;
    releaseCondition: string;
    proposalId: string | null;
  }>;
  proposals: Array<{
    id: string;
    kind: OperationSignalKind;
    status: "PROPOSED" | "APPROVED" | "REJECTED" | "APPLYING" | "ACTIVE" | "FAILED" | "ROLLED_BACK" | "VERIFIED";
    proposedByRole: OperationRole;
    change: OperationProposalChange;
    expectedEffects: string[];
    risks: string[];
    validationPlan: string[];
    rollbackPlan: string[];
    createdAt: string;
    decidedAt: string | null;
    decisionReason: string | null;
    applyResult: Record<string, EvidenceValue> | null;
  }>;
  revisions: Array<{
    id: string;
    proposalId: string;
    decision: "APPROVED" | "REJECTED";
    decidedBy: string;
    decidedAt: string;
    reason: string;
    previousVersion: string;
    newVersion: string | null;
    applyResult: Record<string, EvidenceValue> | null;
    verificationResult: Record<string, EvidenceValue> | null;
  }>;
  monitor: {
    lastScanAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
  } | null;
};

function fingerprint(kind: OperationSignalKind, targetId: string): string {
  return createHash("sha256")
    .update(`${kind}:${targetId}:${OPERATION_MONITOR_POLICY_VERSION}`)
    .digest("hex");
}

function makeSignal(
  input: OperationObservationInput,
  value: Omit<OperationSignal, "fingerprint" | "policyVersion" | "recordedAt" | "operatingEpochMs">,
): OperationSignal {
  return {
    ...value,
    fingerprint: fingerprint(value.kind, value.targetId),
    policyVersion: OPERATION_MONITOR_POLICY_VERSION,
    recordedAt: input.recordedAt,
    operatingEpochMs: input.operatingEpochMs,
  };
}

export function detectOperationSignals(input: OperationObservationInput): OperationSignal[] {
  const signals: OperationSignal[] = [];

  if (
    input.engine.status === "RUNNING"
    && !input.engine.tickInProgress
    && (input.engine.secondsSinceTick ?? 0) > ENGINE_STALE_AFTER_SECONDS
  ) {
    signals.push(makeSignal(input, {
      kind: "ENGINE_STALE",
      targetId: "TWIN",
      severity: "CRITICAL",
      affectedRoles: ["PRODUCTION", "MATERIALS", "PROCUREMENT", "LOGISTICS"],
      summary: `Twin tick이 ${input.engine.secondsSinceTick}초 동안 갱신되지 않았습니다.`,
      evidence: { secondsSinceTick: input.engine.secondsSinceTick },
      releaseCondition: "서버 또는 Twin scheduler가 새 tick을 완료해야 합니다.",
    }));
  }

  if (input.engine.status === "RUNNING" && input.engine.lifeSign === "STOPPED") {
    signals.push(makeSignal(input, {
      kind: "OUTPUT_STOPPED",
      targetId: "ALL_PRODUCTS",
      severity: "CRITICAL",
      affectedRoles: ["PRODUCTION", "MATERIALS", "LOGISTICS"],
      summary: input.engine.minutesSinceOutput === null
        ? "완제품 산출 이력이 없습니다."
        : `완제품 산출이 ${input.engine.minutesSinceOutput}분 동안 없습니다.`,
      evidence: { minutesSinceOutput: input.engine.minutesSinceOutput },
      releaseCondition: "차단 원인을 해소한 뒤 완제품 산출 이벤트가 발생해야 합니다.",
    }));
  }

  for (const material of input.materials) {
    if (material.state !== "STOCKOUT" && material.state !== "CRITICAL") continue;
    const kind = material.state === "STOCKOUT" ? "MATERIAL_STOCKOUT" : "MATERIAL_CRITICAL";
    const openOrders = input.procurement.openOrders.filter((order) => order.materialId === material.materialId);
    signals.push(makeSignal(input, {
      kind,
      targetId: material.materialId,
      severity: material.state === "STOCKOUT" ? "CRITICAL" : "ATTENTION",
      affectedRoles: ["MATERIALS", "PROCUREMENT", "PRODUCTION"],
      summary: material.state === "STOCKOUT"
        ? `${material.code} 재고가 소진되어 ${material.blockedLots}개 WIP가 영향을 받습니다.`
        : `${material.code} 커버리지가 ROP 절반 미만입니다.`,
      evidence: {
        materialCode: material.code,
        onHand: material.onHand,
        coverageDays: material.coverageDays,
        blockedLots: material.blockedLots,
        openPoCount: openOrders.length,
        earliestEtaOperatingMs: openOrders
          .map((order) => order.etaOperatingMs)
          .filter((value): value is number => value !== null)
          .sort((a, b) => a - b)[0] ?? null,
      },
      releaseCondition: "가용재고가 반영되고 차단 WIP가 다시 진행되어야 합니다.",
    }));
  }

  for (const material of input.starvedMaterials) {
    const ratio = material.designDaily > 0 ? material.avgDailyBurn / material.designDaily : 0;
    signals.push(makeSignal(input, {
      kind: "EMA_STARVATION",
      targetId: material.materialId,
      severity: "CRITICAL",
      affectedRoles: ["MATERIALS", "PROCUREMENT", "PRODUCTION"],
      summary: `${material.code} 발주 기준선이 설계수요의 ${Math.round(ratio * 100)}%입니다.`,
      evidence: {
        materialCode: material.code,
        avgDailyBurn: material.avgDailyBurn,
        designDaily: material.designDaily,
        ratio,
      },
      releaseCondition: "실제 요청량을 반영하도록 소모 EMA 입력을 교정해야 합니다.",
    }));
  }

  for (const order of input.procurement.pendingOrders) {
    if (order.waitingMinutes < 60) continue;
    signals.push(makeSignal(input, {
      kind: "PENDING_APPROVAL",
      targetId: order.poId,
      severity: "CRITICAL",
      affectedRoles: ["PROCUREMENT", "MATERIALS"],
      summary: `${order.materialId} 발주가 ${Math.round(order.waitingMinutes)}분 동안 승인 대기 중입니다.`,
      evidence: {
        poId: order.poId,
        materialId: order.materialId,
        waitingMinutes: order.waitingMinutes,
      },
      releaseCondition: "승인 대기 PO를 승인 또는 반려해야 합니다.",
    }));
  }

  for (const hold of input.inbound.held) {
    signals.push(makeSignal(input, {
      kind: "INBOUND_HOLD",
      targetId: hold.poId,
      severity: "CRITICAL",
      affectedRoles: ["LOGISTICS", "MATERIALS", "PROCUREMENT"],
      summary: `${hold.materialId} 입고가 목적창고 조건 때문에 보류되었습니다.`,
      evidence: { poId: hold.poId, materialId: hold.materialId, reason: hold.reason },
      releaseCondition: "목적창고 여유를 확보하고 입고를 재정산해야 합니다.",
    }));
  }

  for (const warehouse of input.warehouses) {
    if (!warehouse.isFinishedGoods || warehouse.verdict !== "CAPACITY_OVER") continue;
    signals.push(makeSignal(input, {
      kind: "FG_CAPACITY_OVER",
      targetId: warehouse.warehouseId,
      severity: "CRITICAL",
      affectedRoles: ["LOGISTICS", "PRODUCTION"],
      summary: `완제품 창고 ${warehouse.warehouseId}가 ${Math.round(warehouse.utilization)}%로 포화되었습니다.`,
      evidence: {
        warehouseId: warehouse.warehouseId,
        utilization: warehouse.utilization,
        finishedGoodsHeldLots: input.production.finishedGoodsHeldLots,
      },
      releaseCondition: "출하 또는 생산조정으로 완제품 창고가 100% 미만이 되어야 합니다.",
    }));
  }

  for (const shipment of input.shipments) {
    if (
      shipment.availableQuantity <= 0
      || shipment.dueRemainingQty <= 0
      || (shipment.minutesSinceLastShipment !== null
        && shipment.minutesSinceLastShipment < SHIPMENT_STALLED_AFTER_MINUTES)
    ) continue;
    signals.push(makeSignal(input, {
      kind: "SHIPMENT_STALLED",
      targetId: shipment.product,
      severity: "CRITICAL",
      affectedRoles: ["LOGISTICS", "PRODUCTION"],
      summary: `${shipment.product} 출하 가능 재고가 있지만 계약 출하가 정체되었습니다.`,
      evidence: {
        product: shipment.product,
        availableQuantity: shipment.availableQuantity,
        dueRemainingQty: shipment.dueRemainingQty,
        minutesSinceLastShipment: shipment.minutesSinceLastShipment,
      },
      releaseCondition: "자동출하가 실행되거나 계약 잔량이 해소되어야 합니다.",
    }));
  }

  for (const gap of input.dataGaps) {
    signals.push(makeSignal(input, {
      kind: "DATA_GAP",
      targetId: `${gap.source}.${gap.field}`,
      severity: "ATTENTION",
      affectedRoles: ["MATERIALS", "PRODUCTION", "LOGISTICS", "PROCUREMENT"],
      summary: `${gap.source}.${gap.field} 관측값이 없어 0으로 가정하지 않았습니다.`,
      evidence: { source: gap.source, field: gap.field },
      releaseCondition: "원천 데이터 필드를 적재해야 합니다.",
    }));
  }

  return signals;
}

function draft(
  signal: OperationSignal,
  role: OperationRole,
  change: OperationProposalChange,
  expectedEffects: string[],
  risks: string[],
): OperationProposalDraft {
  return {
    kind: signal.kind,
    proposedByRole: role,
    change,
    expectedEffects,
    risks,
    evidenceRefs: [signal.fingerprint],
    validationPlan: ["변경 전 스냅샷을 보존합니다.", "변경 후 두 번 연속 정상 관측을 확인합니다."],
    rollbackPlan: ["검증 실패 시 이전 정책값 또는 실행 전 상태로 복원합니다."],
  };
}

export function proposalDraftFor(signal: OperationSignal): OperationProposalDraft | null {
  if (signal.severity !== "CRITICAL") return null;
  if (signal.kind === "ENGINE_STALE" || signal.kind === "DATA_GAP" || signal.kind === "MONITOR_FAILURE") return null;

  const before = signal.evidence;
  if (signal.kind === "MATERIAL_STOCKOUT") {
    const hasOpenPo = Number(signal.evidence.openPoCount ?? 0) > 0;
    return draft(signal, "PROCUREMENT", {
      kind: hasOpenPo ? "CODE_OR_POLICY_CHANGE" : "ALLOWLIST_ACTION",
      actionType: hasOpenPo ? "REVIEW_REPLENISHMENT_GAP" : "CREATE_INBOUND_PLAN_DRAFT",
      targetId: signal.targetId,
      before,
      after: hasOpenPo ? { replenishmentGapReviewed: true } : { inboundPlanDraftCreated: true },
    }, ["재고 소진과 도착 사이의 공백을 줄입니다."], ["과발주 또는 창고 점유 증가 가능성이 있습니다."]);
  }
  if (signal.kind === "PENDING_APPROVAL") {
    return draft(signal, "PROCUREMENT", {
      kind: "ALLOWLIST_ACTION", actionType: "APPROVE_PURCHASE_ORDER", targetId: signal.targetId,
      before, after: { status: "ORDERED" },
    }, ["승인 때문에 멈춘 리드타임을 시작합니다."], ["민감 자재 발주가 실행됩니다."]);
  }
  if (signal.kind === "INBOUND_HOLD") {
    return draft(signal, "LOGISTICS", {
      kind: "ALLOWLIST_ACTION", actionType: "RELEASE_INBOUND_HOLD", targetId: signal.targetId,
      before, after: { status: "RECEIVED" },
    }, ["도착 자재를 가용재고에 반영합니다."], ["창고 용량이 다시 초과될 수 있습니다."]);
  }
  const role: OperationRole = signal.kind === "SHIPMENT_STALLED" || signal.kind === "FG_CAPACITY_OVER"
    ? "LOGISTICS"
    : signal.kind === "OUTPUT_STOPPED" ? "PRODUCTION" : "MATERIALS";
  return draft(signal, role, {
    kind: "CODE_OR_POLICY_CHANGE",
    actionType: `REVIEW_${signal.kind}`,
    targetId: signal.targetId,
    before,
    after: { reviewed: true, expectedState: "NORMAL" },
  }, ["같은 운영 실패의 재발 가능성을 낮춥니다."], ["잘못된 임계 조정은 다른 역할 지표를 악화시킬 수 있습니다."]);
}
