import { MongoClient, Db, Collection } from "mongodb";
import type { FabId, FacilityRole } from "@/lib/fab-domain";
import type {
  InventoryBalanceV2Doc,
  InventoryMovementV2Doc,
  MaterialUomLockV2Doc,
  MaterialUomRuleV2Doc,
} from "@/lib/inventory-v2-contract";
import type { ControlTowerAIEpisodeDoc } from "@/lib/control-tower-live";

// MongoDB(Atlas) 네이티브 드라이버. TCP 기반이라 Next.js fetch 패치 영향 없음.
// 서버리스 콜드스타트에서 커넥션을 재사용하도록 클라이언트를 글로벌 캐시.
const uri = process.env.DATABASE_URL;

const g = globalThis as unknown as { _mongoClientPromise?: Promise<MongoClient> };

export function getMongoClient(): Promise<MongoClient> {
  if (!uri) throw new Error("DATABASE_URL 환경변수가 설정되지 않았습니다 (MongoDB 연결 문자열).");
  if (!g._mongoClientPromise) {
    g._mongoClientPromise = new MongoClient(uri).connect();
  }
  return g._mongoClientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(); // DB 이름은 연결 문자열의 /fab 에서 결정
}

// ─── 도메인 타입 (문서 스키마) ─────────────────────────────
export type Role = "ADMIN" | "MATERIALS" | "PRODUCTION" | "LOGISTICS";
export type Category = "GAS" | "CHM" | "CSM" | "UTL" | "PKG";
export type Product = "HBM" | "DRAM" | "NAND";
export type RiskLevel = "HIGH" | "MEDIUM" | "LOW";
export type TxType = "IN" | "OUT";
export type InventoryStatus = "AVAILABLE" | "HOLD" | "QUARANTINE" | "CONSUMED";
export type SupplyMode = "ON_SITE" | "BULK_GAS" | "SPECIALTY_CYLINDER" | "BULK_CHEMICAL" | "DRUM_CHEMICAL" | "PRECURSOR_CANISTER" | "GENERAL_STORAGE";

export interface UserDoc {
  _id: string; email: string; name: string; password: string;
  role: Role; department: string; createdAt?: Date;
}
export interface MaterialDoc {
  _id: string; code: string; name: string; nameEn?: string | null;
  category: Category; unit: string; safetyStock: number; ropDays: number; notes?: string | null;
  materialType?: "CONSUMABLE" | "DIRECT_COMPONENT" | "REUSABLE_CARRIER";
  purchaseUnit?: string;
  purchaseToInventoryFactor?: number;
  inventoryToStorageFactor?: number;
  inventoryBaselineVersion?: string;
  assumptionConfidence?: "HIGH" | "MEDIUM" | "LOW" | "CALIBRATION_REQUIRED";
  palletFactor?: number; // 파렛트 환산 예외 override (없으면 단위표 사용)
  supplyMode?: SupplyMode; // 공급 형태 (기존 문서는 분류 규칙으로 fallback)
  regulatoryClass?: string; // 실제 SDS/허가 데이터 연결용
  designatedQuantity?: number; // 물질별 지정수량 (material unit 기준)
  permittedQuantity?: number; // 사업장 허가량 (material unit 기준)
}
export interface WarehouseDoc {
  _id: string; code: string; name: string; type: string;
  totalCapacity: number; unit: string; temperature?: string | null; notes?: string | null;
  legalLimit?: number; // 위험물 등 법적 저장 한도 (파렛트 환산)
  capacityMode?: "SPACE" | "TANK_LEVEL" | "CONTINUOUS";
  facilityRole?: FacilityRole;
  fabId?: FabId;
  layoutVersion?: string;
}
export interface InventoryDoc {
  _id: string; materialId: string; warehouseId: string; quantity: number; avgDailyUsage: number;
  avgDailyBurn?: number; // twin 엔진이 실측한 일일 소모 EMA
  capacityLimit?: number; // 벌크 탱크별 최대량 (자재 unit 기준)
  status?: InventoryStatus;
  updatedAt?: Date;
}
export interface TwinEngineStateDoc {
  _id: "singleton";
  status: "RUNNING" | "PAUSED";
  /** 벽시계 — 마지막 tick이 실제로 실행된 시각(사실 기록이므로 가속하지 않는다) */
  lastTickAt: Date;
  tickIntervalMs: number;
  // ── 공통 Twin 운영시계 (RULES.md § Twin 운영시간, §lib/twin/operating-clock.ts) ──
  // 모든 모델 운영시간(WIP 진행·자재 소모·발주 ETA·최종테스트·자동출하)이 이 하나를 쓴다.
  // 실제 경과 벽시계 × 24로만 흐르며 tick 횟수와 무관하다.
  /** 운영 절대시각(ms). 기능들이 "지금 운영시각"으로 참조한다. */
  operatingEpochMs?: number;
  /** 운영시계를 마지막으로 갱신한 벽시계 시각 — 다음 경과분 계산의 기준점 */
  operatingClockWallAt?: Date;
  lockedBy?: string | null;
  lockExpiresAt?: Date | null;
  // MODELED_FOUP 재투입 목표(dailyRate*simDays)의 tick간 소수부 이월분 — 드리프트 방지용.
  // releaseCarry는 HBM 하위호환. 다제품(HBM/DRAM/NAND)은 releaseCarryByProduct를 쓴다.
  releaseCarry?: number;
  releaseCarryByProduct?: Partial<Record<Product, number>>;
  /** STEP_BUCKET 공통 5분 운영 퀀텀에 못 미친 잔여 운영시간. 별도 시계가 아니다. */
  wipFlowCarryMs?: number;
  pausedAt?: Date;
  pausedBy?: string;
}
export interface ControlTowerAIStateDoc {
  _id: "singleton";
  aiEnabled: boolean;
  updatedAt: Date;
  updatedBy: string;
}
export interface TwinPurchaseOrderDoc {
  _id: string;
  materialId: string;
  qty: number;
  /** 벽시계 — 발주가 실제로 나간 시각(사실 기록) */
  orderedAt: Date;
  /** 벽시계 환산 ETA. 화면 표시용이며 도착 판정의 근거가 아니다. */
  etaAt: Date;
  /** 운영시각 ETA — 도착 판정의 근거(§twin/operating-clock.ts). 리드타임은 운영시간이다. */
  etaOperatingMs?: number;
  leadTimeDays: number;
  status: "PENDING_APPROVAL" | "ORDERED" | "IN_TRANSIT" | "RECEIVED" | "REJECTED" | "INBOUND_HOLD";
  // PENDING_APPROVAL(자율등급 L2 — 위험물·단일소싱) 판정 근거. 승인/반려 UI에 그대로 노출한다.
  autonomyCeiling?: 2 | 4;
  autonomyReason?: string | null;
  decidedAt?: Date;
  decidedBy?: string;
  // 발주 시점에 배정된 목적 창고 스냅샷 — 도착 시점에 재고 최다 창고가 바뀌어도 원래 배정
  // 기준으로 게이팅하기 위해 저장한다(박물류 CAPACITY_OVER 게이팅, INBOUND_HOLD).
  destinationWarehouseId?: string;
  holdReason?: string | null;
  releasedAt?: Date;
  releasedBy?: string;
}
export interface TwinBurnEventDoc {
  _id: string;
  tickAt: Date;
  /** 운영시각(ms) — 트렌드 집계의 시간축. 없는 문서는 운영시계 도입 이전분이다. */
  operatingEpochMs?: number;
  materialId: string;
  burnedQty: number;
  shortfallQty: number;
}
/**
 * 운영일 1일치 운영 상태 스냅샷 — 트렌드 화면의 유일한 데이터원.
 *
 * 재고 커버리지·창고 점유율은 *상태*라 이벤트로 과거를 복원할 수 없다. 어제의 점유율은 어제
 * 찍어둬야만 안다. 그래서 이벤트 재집계가 아니라 스냅샷으로 쌓는다.
 *
 * `_id`가 운영일이라 같은 날이 두 번 적재될 수 없다. 엔진이 멈추면 운영일이 넘어가지 않으므로
 * 스냅샷도 안 생기고, 그 공백 자체가 정지의 증거가 된다.
 */
export interface TwinDailySnapshotDoc {
  _id: string;               // `OP-${operatingDay}`
  operatingDay: number;
  wallDayKey: string;        // "2026-08-18" — 벽시계 축 토글용 버킷
  /** 벽시계 사실 기록 — 가속하지 않는다 */
  recordedAt: Date;
  production: { product: Product; producedQty: number; designDailyQty: number; ratePct: number }[];
  materials: {
    stockoutCount: number;
    criticalCount: number;
    medianDoh: number;
    worst: { materialCode: string; doh: number }[];
  };
  warehouses: { code: string; utilization: number; baselineUtilization: number }[];
  shipments: { product: Product; shippedQty: number; contractDailyQty: number; fulfillmentPct: number }[];
  policy: { r1: number; r2: number; r3: number; r4: number };
  engine: { ticks: number; elapsedOperatingMs: number; clampedCatchUps: number };
}

export interface WarehouseZoneDoc {
  _id: string; warehouseId: string; code: string; name: string; zoneType: string;
  temperatureMin?: number; temperatureMax?: number; humidityMin?: number; humidityMax?: number;
  hazardClass?: string[]; accessLevel?: string;
}
export interface StorageLocationDoc {
  _id: string; warehouseId: string; zoneId: string; code: string;
  aisle?: number; bay?: number; level?: number; bin?: number;
  locationType: "PALLET" | "SHELF" | "BIN" | "CYLINDER" | "TANK" | "CANISTER" | "PROCESS";
  capacity: number; status: "AVAILABLE" | "OCCUPIED" | "BLOCKED" | "MAINTENANCE";
  position: { x: number; y: number; z: number };
  operationalPurpose?: "RECONCILIATION_HOLD";
}
export interface InventoryReconciliationMetadata {
  version: "OPENING_RECONCILIATION_V1";
  batchId: string;
  fingerprint: string;
  origin: "MODELED_OPENING_PROJECTION";
  verificationStatus: "PENDING_PHYSICAL_VERIFICATION";
  projectionKind: "RECOVERED_LOT_REFERENCE" | "MODELED_CONTAINER_GROUP";
  sourceInventoryIds?: string[];
  sourceHandlingUnitIds?: string[];
  createdAt: Date;
}
export interface InventoryLotDoc {
  _id: string; materialId: string; lotNo: string; quantity: number; availableQuantity: number;
  receivedAt?: Date; manufactureDate?: Date; expiryDate?: Date;
  qualityStatus: InventoryStatus; holdReason?: string; updatedAt: Date;
  warehouseId?: string; slotId?: string;
  inboundPlanId?: string;
  simulated?: true;
  reconciliation?: InventoryReconciliationMetadata;
}
export interface HandlingUnitDoc {
  _id: string; inventoryLotId: string; materialId: string; warehouseId: string; locationId: string;
  containerType: string; quantity: number; status: InventoryStatus; updatedAt: Date;
  logisticsStatus?: "STORED" | "RESERVED" | "STAGED" | "IN_TRANSIT" | "RECEIVED" | "LINE_SIDE" | "CONSUMED";
  currentFacilityId?: string;
  currentLocationId?: string;
  reservedWorkOrderId?: string;
  reservedTransferOrderId?: string;
  version?: number;
  reconciliation?: InventoryReconciliationMetadata;
}
export interface InventoryReconciliationBatchDoc {
  _id: string;
  version: "OPENING_RECONCILIATION_V1";
  fingerprint: string;
  status: "APPLIED" | "ROLLED_BACK";
  createdAt: Date;
  rolledBackAt?: Date;
  aggregateHashBefore: string;
  aggregateHashAfter: string;
  createdLotIds: string[];
  createdHandlingUnitIds: string[];
  createdLocationIds: string[];
  createdZoneIds: string[];
  preExistingHandlingUnitIdsByCreatedLot: Record<string, string[]>;
  createdLots: InventoryLotDoc[];
  createdHandlingUnits: HandlingUnitDoc[];
}
export interface InventoryReconciliationEntryDoc {
  _id: string;
  batchId: string;
  materialId: string;
  warehouseId?: string;
  kind: "RECOVER_ORPHAN_HU_LOT" | "FILL_EXISTING_LOT_HU" | "OPENING_POSITION" | "SKIP" | "ROLLBACK";
  status: "APPLIED" | "SKIPPED_UNCALIBRATED_ZERO_BASELINE" | "ROLLED_BACK";
  quantity: number;
  referenceIds: string[];
  createdAt: Date;
}
export type InventoryVerificationCaseStatus = "AWAITING_OBSERVATION" | "OBSERVED" | "SOURCE_DRIFT";
export interface InventoryVerificationCaseDoc {
  _id: string;
  reconciliationBatchId: string;
  reconciliationFingerprint: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  warehouseId: string;
  sourceLotId: string;
  sourceHandlingUnitId: string;
  expectedQuantity: number;
  uom: string;
  reconciliationHoldLocationId: string;
  sourceSnapshotHash: string;
  status: InventoryVerificationCaseStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  observedAt?: Date;
  observedBy?: string;
  observationId?: string;
}
export interface InventoryVerificationObservationDoc {
  _id: string;
  requestId: string;
  requestHash: string;
  caseId: string;
  caseVersion: number;
  observedQuantity: string;
  uom: string;
  actualLocationId: string;
  evidenceReference: string;
  observedBy: string;
  recordedAt: Date;
}
export interface InventoryVerificationEventDoc {
  _id: string;
  caseId: string;
  sequence: number;
  type: "CASE_CREATED" | "OBSERVATION_SUBMITTED";
  actorId: string;
  at: Date;
  requestId?: string;
  observationId?: string;
}
export interface InventoryMovementDoc {
  _id: string; handlingUnitId?: string; materialId: string; type: "RECEIPT" | "PUTAWAY" | "MOVE" | "PICK" | "ISSUE" | "HOLD" | "RELEASE" | "QUARANTINE" | "ADJUSTMENT";
  fromLocationId?: string | null; toLocationId?: string | null; quantity: number;
  reason?: string; userId: string; createdAt: Date;
  lotId?: string; processCode?: string;
  inboundPlanId?: string; requestId?: string;
  requestHash?: string;
  simulated?: true;
}
export interface FacilityTelemetryDoc {
  _id: string; warehouseId: string; metric: "LEVEL" | "TEMPERATURE" | "HUMIDITY" | "PRESSURE" | "GAS_ALARM" | "UPW_RESISTIVITY" | "FLOW";
  value: number; unit: string; status: "NORMAL" | "WARNING" | "CRITICAL" | "STALE"; measuredAt: Date;
}
export interface ProcessUsageDoc {
  _id: string; materialId: string; processCode: string; product: Product; monthlyQty: number;
  fabId?: FabId;
  routeKey?: string;
  routeVersion?: string;
  operationCode?: string;
  active?: boolean;
  modelProduct?: string;
  equivalentPerWafer?: number;
  consumptionBasis?: "WAFER_VISIT" | "TOOL_USAGE" | "REPLACEMENT_LIFE" | "STACK_EQUIVALENT" | "DIRECT_COMPONENT";
  source?: "MODELED_BASELINE" | "MES_ACTUAL";
  sourceVersion?: string;
}
export interface TransactionDoc {
  _id: string; materialId: string; type: TxType; quantity: number; date: Date;
  userId: string; note?: string | null; processCode?: string | null; supplierId?: string | null; createdAt: Date;
}
export interface SupplierDoc {
  _id: string; name: string; country?: string | null; contact?: string | null; notes?: string | null;
}
export interface MaterialSupplierDoc {
  _id: string; materialId: string; supplierId: string; leadTimeDays: number; isPrimary: boolean;
  qualificationStatus?: "APPROVED" | "CONDITIONAL" | "SUSPENDED";
  sourcingRole?: "PRIMARY" | "SECONDARY";
  minLeadTimeDays?: number | null; standardLeadTimeDays?: number | null; maxLeadTimeDays?: number | null;
  currentExpectedLeadTimeDays?: number | null; currentExpectedValidUntil?: Date | null; leadTimeReason?: string | null;
  emergencyOrderAllowed?: boolean; plannedSharePct?: number | null; updatedAt?: Date;
}
export type InboundPlanStatus = "DRAFT" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
export interface InboundPlanEvent {
  type: "CREATED" | "UPDATED" | "CONFIRMED" | "CANCELLED" | "RECEIVED";
  userId: string; at: Date; reason?: string | null;
  changes?: Record<string, { before: string | number | null; after: string | number | null }>;
  receiptId?: string; quantity?: number;
}
export interface InboundPlanDoc {
  _id: string; planNo: string; materialId: string; supplierId: string; unit: string;
  plannedDate: Date; plannedQuantity: number; receivedQuantity: number; remainingQuantity: number;
  status: InboundPlanStatus; note?: string | null;
  createdBy: string; createdAt: Date; updatedAt: Date;
  confirmedBy?: string | null; confirmedAt?: Date | null;
  cancelledBy?: string | null; cancelledAt?: Date | null; cancelReason?: string | null;
  completedAt?: Date | null; events: InboundPlanEvent[];
  source?: "MANUAL" | "INVENTORY_SCALE_UP";
  scaleUpRequestId?: string;
  scaleUp?: {
    formulaVersion: "SAFETY_PLUS_1D_V1";
    reviewStatus: "READY" | "CAPACITY_REVIEW" | "MASTER_DATA_REVIEW";
    referenceQuantity: number; activeInboundQuantity: number; safetyStock: number;
    dailyUsage: number; targetQuantity: number;
  };
}
export type InventoryPolicyStatus = "READY" | "BLOCKED_CAPACITY" | "BLOCKED_MASTER_DATA";
export interface InventoryPolicyDoc {
  _id: string; materialId: string; facilityId: string;
  referenceQuantity: number; targetQuantity: number; shortageQuantity: number;
  dailyUsage: number; ropDays: number; leadTimeDays: number; protectedDays: number;
  supplierId: string; status: InventoryPolicyStatus; blockReason?: string | null;
  formulaVersion: "BASELINE_V1"; batchId: string; calculatedAt: Date; updatedAt: Date;
}
export interface InventoryPolicyAuditDoc {
  _id: string; batchId: string; materialId: string; action: "APPLY" | "ROLLBACK";
  before: InventoryPolicyDoc | null; after: InventoryPolicyDoc | null; createdAt: Date;
}
export interface InfraDoc {
  _id: string; name: string; processCode: string; unit: string;
  replacementCriteria: number; currentUsage: number; lastReplacedAt?: Date | null; notes?: string | null;
}
export interface RiskDoc {
  _id: string; title: string; level: RiskLevel; category: string; owner: string;
  status: string; description?: string | null; mitigation?: string | null; createdAt?: Date;
}
export interface WikiDoc {
  _id: string; date: Date; title: string; category: string; content: string;
  result?: string | null; nextAction?: string | null; userId: string; createdAt: Date;
}
export type BenefitCategory = "COST" | "TIME" | "RISK" | "QUALITY" | "CONTROL";
export type BenefitValueType = "CASH_SAVING" | "WORKING_CAPITAL" | "COST_AVOIDANCE" | "TIME_VALUE" | "RISK_AVOIDANCE" | "FORECAST_QUALITY";
export type BenefitStatus = "HYPOTHESIS" | "OBSERVED" | "CALCULATED" | "VALIDATED" | "REALIZED" | "NOT_REALIZED" | "REJECTED";
export interface BenefitCaseDoc {
  _id: string; title: string; category: BenefitCategory; valueType: BenefitValueType; status: BenefitStatus;
  materialId?: string | null; baselineDescription: string; systemFinding: string; actionTaken?: string | null;
  actualOutcome?: string | null; affectedQuantity?: number | null; unit?: string | null; unitPrice?: number | null;
  calculationFormula?: string | null; calculatedAmount?: number | null; approvedAmount?: number | null;
  evidence?: string | null; ownerId: string; validatorId?: string | null; detectedAt: Date;
  validatedAt?: Date | null; createdAt: Date; updatedAt: Date;
}

export interface SimStateDoc {
  _id: "singleton";
  status: "IDLE" | "RUNNING" | "PAUSED";
  simDate: Date;
  simStartDate: Date;
  realStartedAt: Date;
  speedMultiplier: number;
}

export interface SimPurchaseOrderDoc {
  _id: string;
  materialId: string;
  qty: number;
  status: "PENDING" | "IN_TRANSIT" | "RECEIVED" | "CANCELLED";
  createdSimDate: Date;
  expectedArrival: Date;
  actualArrival?: Date;
  leadTimeDays: number;
  delayDays: number;
  simulated?: true;
}

export interface SimEventDoc {
  _id: string;
  simDate: Date;
  type: "CONSUMPTION" | "PO_CREATED" | "GR_ARRIVED" | "STOCKOUT_RISK" | "DELAY" | "PARTIAL_GR" | "PO_CANCELLED" | "MANUAL";
  materialId?: string;
  qty?: number;
  poId?: string;
  note: string;
  simulated?: true;
}

// 체크포인트: 각 sim-day 시작 시점의 실제 lot 수량 스냅샷
// _id = simDate.toISOString() (하루 1개, upsert로 중복 방지)
export interface SimCheckpointDoc {
  _id: string;
  simDate: Date;
  createdAt: Date;
  realLotStates: { lotId: string; availableQuantity: number; qualityStatus: InventoryStatus }[];
}

export interface PickedLot {
  lotId: string;
  qty: number;
}

export interface BomLine {
  materialId: string;
  plannedQty: number;
  pickedQty?: number;
  consumedQty?: number;
  actualQty?: number;
  pickedLots: PickedLot[];
}

export interface BomTemplateDoc {
  _id: string; // V1: "{processCode}-{product}", V2: route/version/operation namespace
  processCode: string;
  product: Product;
  routeKey?: string;
  routeVersion?: string;
  operationCode?: string;
  lines: { materialId: string; qtyPerRun: number }[];
  updatedAt: Date;
}

export type WorkOrderStatus = "QUEUED" | "MATERIAL_WAIT" | "RUNNING" | "DONE" | "HOLD";

export interface WorkOrderDoc {
  _id: string; // "WO-{Date.now()}"
  fabId: FabId;
  processCode: string;
  routeKey?: string;
  routeVersion?: string;
  operationCode?: string;
  product: Product;
  plannedQty: number;
  plannedQtyUnit?: "RUN" | "WAFER";
  scope?: "FULL_BOM" | "M20_PILOT";
  requestId?: string;
  lotId?: string; // M20_PILOT이 waferLots 실행 원장에서 자동 생성된 경우, 트리거한 웨이퍼 로트
  foupCode?: string; // 위 lotId의 FOUP 식별자 — MES 화면에서 어떤 FOUP의 사이클인지 구분하는 용도
  status: WorkOrderStatus;
  bomLines: BomLine[];
  plannedStart?: Date;
  actualStart?: Date;
  actualEnd?: Date;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  note?: string;
}

export interface FacilityNodeDoc {
  _id: string;
  code: string;
  name: string;
  role: FacilityRole;
  fabId?: FabId;
  parentFacilityId?: string;
  layoutVersion: string;
  position: { x: number; y: number; z: number };
  active: boolean;
  updatedAt: Date;
}

export type AllocationStatus = "PLANNED" | "RESERVED" | "RELEASED" | "CONSUMED" | "CANCELLED";
export interface MaterialAllocationDoc {
  _id: string;
  materialId: string;
  fabId: FabId;
  quantity: number;
  unit: string;
  status: AllocationStatus;
  sourceFacilityId: string;
  destinationFacilityId: string;
  workOrderId?: string;
  inventoryLotIds?: string[];
  source: "OPERATOR" | "MES" | "PLAN_ADAPTER";
  createdAt: Date;
  updatedAt: Date;
}

export type TransferOrderStatus = "CREATED" | "PICKING" | "STAGED" | "IN_TRANSIT" | "RECEIVED" | "DELIVERED" | "CANCELLED";
export interface TransferOrderDoc {
  _id: string;
  allocationId: string;
  materialId: string;
  fabId: FabId;
  quantity: number;
  unit: string;
  fromFacilityId: string;
  toFacilityId: string;
  fromLocationId?: string;
  toLocationId?: string;
  workOrderId?: string;
  processCode?: string;
  lotId?: string;
  handlingUnitId?: string;
  status: TransferOrderStatus;
  requestedAt?: Date;
  pickedAt?: Date;
  stagedAt?: Date;
  departedAt?: Date;
  eta?: Date;
  receivedAt?: Date;
  deliveredAt?: Date;
  telemetryAt?: Date;
  lastPosition?: { x: number; y: number; z: number; progress?: number };
  version?: number;
  createdAt: Date;
  updatedAt: Date;
}

export type MaterialFlowEventType = "ALLOCATED" | "PICKING_STARTED" | "PICKED" | "STAGED" | "DISPATCHED" | "RECEIVED" | "DELIVERED" | "CANCELLED" | "LINE_SIDE" | "CONSUMED" | "RETURNED" | "HELD";
export interface MaterialFlowEventDoc {
  _id: string;
  materialId: string;
  fabId: FabId;
  type: MaterialFlowEventType;
  quantity: number;
  unit: string;
  facilityId: string;
  locationId?: string;
  allocationId?: string;
  transferOrderId?: string;
  workOrderId?: string;
  processCode?: string;
  lotId?: string;
  handlingUnitId?: string;
  requestId?: string;
  sequence?: number;
  occurredAt: Date;
  recordedBy: string;
}

export type ProductionActualSource = "MANUAL" | "MES_MASTER";
export interface ProductionActualRevision {
  producedQty: number;
  note?: string;
  reason?: string;
  enteredBy: string;
  recordedAt: Date;
}
export interface ProductionActualDoc {
  _id: string; // `${fabId}:${product}:${date}`
  fabId: FabId;
  product: Product;
  date: string; // "YYYY-MM-DD"
  producedQty: number;
  planQty: number;
  unit: "K_WAFER";
  note?: string;
  source: ProductionActualSource;
  enteredBy: string;
  confirmedAt: Date;
  revisions: ProductionActualRevision[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MaterialRerouteDoc {
  _id: string;
  materialId: string;
  fromFabId: FabId;
  toFabId: FabId;
  quantity: number;
  unit: string;
  reason?: string;
  decidedBy: string;
  decidedAt: Date;
}

export type RouteNodeStage = "FRONT_END" | "TSV_FRONT" | "BACKGRIND" | "TSV_BACK" | "TEST" | "SINGULATION" | "ASSEMBLY" | "PACKAGING" | "PERIPHERAL" | "CELL_STACK";
export interface RouteMasterNode {
  id: string;
  label: string;
  cycle: string[]; // 이 노드에서 도는 공정 코드 순서 (예: ["P03","P04","P02","P07"])
  repeatCount: number; // cycle을 몇 번 반복하는지
  stage: RouteNodeStage;
  operationCode?: string;
  inputUnit?: "WAFER" | "MEMORY_KGD" | "BASE_KGD" | "STACK" | "DIE";
  outputUnit?: "WAFER" | "MEMORY_KGD" | "STACK" | "GOOD_PACKAGE" | "DIE";
}
export interface RouteMasterEdge {
  from: string; // node id 또는 "START"
  to: string; // node id 또는 "END"
  condition?: string;
}
export interface RouteMasterDoc {
  _id: string; // V1: `${fabId}:${product}`, V2+: `${fabId}:${product}:Vn`
  fabId: FabId;
  product: Product;
  routeKey?: string;
  isActive?: boolean;
  version: string;
  nodes: RouteMasterNode[];
  edges: RouteMasterEdge[];
  source: "MODELED_BASELINE";
  sourceRefs: string[];
  updatedAt: Date;
}

// "lots"는 이미 InventoryLotDoc(재고 로트)이 쓰고 있어서, 웨이퍼 생산 로트는 waferLots로 분리한다.
export type WaferLotStatus = "IN_PROGRESS" | "DONE";
export type WaferLotCohort = "AGGREGATE" | "LEGACY_AGGREGATE" | "MODELED_FOUP" | "WATCHED";
export interface WaferLotDoc {
  _id: string;
  fabId: FabId;
  product: Product;
  routeMasterId: string; // `${fabId}:${product}`
  foupCode: string; // 예: "FOUP-01" (VISUAL) 또는 "FOUP-WIP-xxxxx" (AGGREGATE)
  status: WaferLotStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  // AGGREGATE 코호트 전용 필드 — undefined면 기존 12개 VISUAL(3D 개별 추적) 로트.
  cohort?: WaferLotCohort;
  currentStepIndex?: number; // waferLotStepEvents 감사 이벤트 없이 진행 상태를 로트 문서에 직접 비정규화
  currentNodeId?: string;
  lastEventAt?: Date;
  waferQty?: number;
  watched?: boolean;
  source?: "MODELED_BASELINE" | "MES_ACTUAL";
  bootstrapVersion?: string;
  modeledReleaseAt?: Date;
  nextTransitionAt?: Date;
  dwellModel?: "SIMPLIFIED_UNIFORM_DWELL";
  /** 다음 route 스텝을 완료할 운영 절대시각. 엔진 due 판정의 유일한 시간 근거. */
  nextStepOperatingMs?: number;
  // 이자재(MATERIALS)가 COVERAGE_CRITICAL로 판단한 자재를 다음 스텝에 쓸 때 진행을 막은
  // 시각. 최초 차단 시각을 보존해 대기시간을 계산한다(다시 진행되면 지운다).
  materialBlockedAt?: Date;
  // 박물류(LOGISTICS)가 완제품 창고를 CAPACITY_OVER로 판정해 마지막 스텝 완료(=완제품 적립)를
  // 막은 시각. materialBlockedAt과 같은 패턴이지만 원인이 자재가 아니라 완제품 창고 포화다.
  finishedGoodsHoldAt?: Date;
}

export type ProductionCarrierType = "FOUP" | "DICING_FRAME" | "DIE_TRAY" | "STACK_TRAY";
export type ProductionCarrierState = "AVAILABLE" | "ASSIGNED_IN_PROCESS" | "CLEANING" | "MAINTENANCE";
export type ProductionCarrierMovementStatus = "STATIONARY" | "IN_TRANSIT" | "EMPTY_RETURN";
export interface ProductionCarrierDoc {
  _id: string;
  fabId: FabId;
  carrierType: ProductionCarrierType;
  capacity: number;
  capacityUnit: "WAFER" | "DIE" | "STACK";
  state: ProductionCarrierState;
  movementStatus: ProductionCarrierMovementStatus;
  currentProcessCode?: string;
  currentLocationId: string;
  source: "MODELED_BASELINE" | "MES_ACTUAL";
  bootstrapVersion?: string;
  positionAccuracy: "ZONE_DERIVED" | "SENSOR_ACTUAL";
  updatedAt: Date;
}

export interface LotCarrierAssignmentDoc {
  _id: string;
  fabId: FabId;
  lotId: string;
  carrierId: string;
  carrierType: ProductionCarrierType;
  status: "ACTIVE" | "RELEASED";
  assignedAt: Date;
  releasedAt?: Date;
  source: "MODELED_BASELINE" | "MES_ACTUAL";
  bootstrapVersion?: string;
  updatedAt: Date;
}

// 완제품(웨이퍼 로트가 140스텝을 다 통과해 DONE된 뒤) 재고 — 원자재 inventory 컬렉션과
// 같은 aggregate 수량 모델. WaferLot 1개=완제품 1개가 아니므로(다이싱→KGD→스택 팬아웃)
// 개별 로트 단위가 아니라 fab+product+warehouse 단위로 수량만 누적한다.
export interface FinishedGoodsDoc {
  _id: string; // `${fabId}__${product}__${warehouseId}`
  fabId: FabId;
  product: Product;
  warehouseId: string;
  quantity: number; // 최종테스트 통과 · 판매 가능 재고(창고 점유·출하는 이 값만 본다)
  unit: "STACK" | "CHIP" | "DIE"; // 제품별 native 단위(HBM=STACK, DRAM=CHIP, NAND=DIE)
  updatedAt: Date;
  // 패키징은 끝났지만 최종테스트 대기 중인 배치 — 업계 관행(Final Test 통과 전엔 판매재고
  // 아님)을 반영한다. 새 수율은 안 만들고(assemblyYield가 이미 반영됨) 시간 지연만 둔다.
  pendingTestQuantity?: number;
  /** 운영시각 기준 최종테스트 방출 예정 시각(ms). 벽시계가 아니다(RULES.md). */
  pendingTestReadyOperatingMs?: number | null;
}

// twinBurnEvents와 같은 패턴 — tick당 완제품 적립량을 이벤트로 남겨 "방금 몇 개 늘었는지"를
// 다시 계산하지 않고 그대로 보여줄 수 있게 한다. addedQty=최종테스트 통과해 실제 재고로
// 반영된 양, queuedQty=이번 tick에 새로 패키징 완료돼 테스트 대기열에 들어간 양.
export interface FinishedGoodsEventDoc {
  _id: string;
  fabId: FabId;
  product: Product;
  tickAt: Date;
  /** 운영시각(ms) — 트렌드 집계의 시간축. */
  operatingEpochMs?: number;
  addedQty: number;
  queuedQty: number;
}

// DRAM(M21)·NAND(M22) WIP는 개별 FOUP 4만개를 만들지 않고 docs/foup-wip-master.md §22의 설계대로
// step별 FOUP-equivalent count로 집계 표현한다(step bucket). counts[i] = 공정 스텝 i에 있는
// FOUP-equivalent 수량. 틱당 counts를 한 스텝씩 시프트해 진행·완료를 계산하므로 per-lot 대비
// write가 O(스텝수)로 줄어 대규모 WIP도 빠르게 돌릴 수 있다. HBM은 여전히 per-lot(waferLots).
export interface WipStepBucketDoc {
  _id: string; // `${fabId}__${product}`
  fabId: FabId;
  product: Product;
  totalSteps: number;
  counts: number[]; // length=totalSteps, 소수 FOUP-equivalent 허용
  updatedAt: Date;
}

// 가상 고객사 — 실제 영업/계약 데이터가 없어 데모용으로 명시적으로 라벨링된 참고 데이터.
// contractedMonthlyQty도 실제 계약이 아니라 등급별로 임의 배정한 가상 목표치다.
export interface CustomerDoc {
  _id: string;
  name: string;
  priorityTier: 1 | 2 | 3;
  contractedMonthlyQty: number;
  virtual: true;
}

export interface ShipmentDoc {
  _id: string;
  fabId: FabId;
  product: Product;
  warehouseId: string;
  customerId: string;
  quantity: number;
  // 제품별 완제품 단위(finishedGoodsUnit) — 예전엔 "STACK" 리터럴로 고정돼 있어서 DRAM/NAND
  // 출하가 타입 레벨에서 불가능했다. 그래서 완제품이 나갈 문이 HBM에만 있었고, DRAM/NAND는
  // 만들수록 자기 창고를 CAPACITY_OVER로 막아 생산을 스스로 세웠다.
  unit: "STACK" | "CHIP" | "DIE";
  shippedAt: Date;
  /** 운영시각(ms) — 계약 이행률의 집계 창 근거. 계약 월량이 운영 1개월치이기 때문이다. */
  shippedOperatingMs?: number;
  shippedBy: string;
}

export interface FoupWipBootstrapManifestDoc {
  _id: string;
  fabId: "M20";
  routeMasterId: string;
  status: "PREPARING" | "ACTIVE" | "FAILED";
  mode: "STEADY_STATE_BOOTSTRAP";
  dwellModel: "SIMPLIFIED_UNIFORM_DWELL";
  bootstrapEndAt: Date;
  targetCounts: { physicalFleet: number; occupied: number; reserve: number; watched: number };
  actualCounts?: { physicalFleet: number; occupied: number; reserve: number; watched: number; activeLots: number; activeAssignments: number };
  snapshotPath?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type WaferLotStepTriggerType = "OPERATOR_CONFIRM" | "MES_TELEMETRY";
export interface WaferLotStepEventDoc {
  _id: string; // `${lotId}:${stepIndex}`
  lotId: string;
  nodeId: string;
  processCode: string;
  operationCode?: string;
  stepIndex: number; // routeMaster 전개 시퀀스에서 절대 순번 (0-based)
  visitIndex: number; // 해당 노드 안에서 몇 번째 반복인지 (0-based)
  enteredAt: Date;
  completedAt?: Date;
  triggeredBy: { type: WaferLotStepTriggerType; actorId: string };
  idempotencyKey: string;
}

export interface FabScenarioDoc {
  _id: FabId; // "M20" | "M21" | "M22"
  product: Product;
  utilization: number; // 실시간 조절 가능한 가동률(0~1). nominalWspm은 fab-scenario.ts의 정적 값을 그대로 씀.
  updatedAt: Date;
  updatedBy: string;
}

export type FabStockLocationType = "PRS" | "LINE_SIDE";
export interface FabMaterialStockDoc {
  _id: string;
  fabId: FabId;
  processCode: string;
  locationType: FabStockLocationType;
  locationId: string;
  materialId: string;
  quantity: number;
  unit: string;
  updatedAt: Date;
}

export type EquipmentStatus = "RUN" | "IDLE" | "PM" | "DOWN";
export interface EquipmentMasterDoc {
  _id: string;
  fabId: FabId;
  processCode: string;
  model: string;
  bay: string;
  position: { x: number; y: number; z: number };
  status: EquipmentStatus;
  ratedCapacity: number;
  capacityUnit: "WAFER_DAY";
  capacityStage?: string;
  oee: number;
  source: "MODELED_BASELINE" | "MES_MASTER";
  updatedAt: Date;
}

export type AgentRole = "PROCUREMENT" | "WMS" | "MES" | "PROCESS";
export type AgentRunStatus = "OPEN" | "WAITING_APPROVAL" | "WAITING_PHYSICAL" | "HUMAN_MODE_HOLD" | "BLOCKED" | "COMPLETED" | "FAILED";
export type AgentRunStage = "CREATED" | "RESERVED" | "PICKED" | "STAGED" | "IN_TRANSIT" | "RECEIVED" | "LINE_SIDE" | "RELEASED" | "CONSUMED";
export interface AgentRunDoc {
  _id: string;
  workOrderId: string;
  fabId: FabId;
  traceId: string;
  status: AgentRunStatus;
  stage: AgentRunStage;
  policyVersion: string;
  nextHumanAction?: "PICK_CONFIRM" | "STAGE_CONFIRM" | "DEPART_CONFIRM" | "RECEIVE_CONFIRM" | "DELIVER_CONFIRM" | "CONSUME_CONFIRM" | "PO_APPROVAL"
    | "PROCUREMENT_MANUAL_RUN" | "WMS_MANUAL_RUN" | "MES_MANUAL_RUN" | "PROCESS_MANUAL_RUN";
  blockedReason?: string | null;
  lastTrigger?: "AUTO" | "MANUAL";
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentDecisionDoc {
  _id: string;
  runId: string;
  workOrderId: string;
  traceId: string;
  agentRole: AgentRole;
  policyVersion: string;
  inputSnapshot: Record<string, unknown>;
  reasonCodes: string[];
  proposedAction: string;
  result: "AUTO_EXECUTED" | "WAITING_APPROVAL" | "WAITING_PHYSICAL" | "NO_ACTION" | "BLOCKED" | "HUMAN_MODE_HOLD";
  idempotencyKey: string;
  createdAt: Date;
}

export type AgentRoleMode = "AGENT" | "HUMAN";
export interface AgentRoleModeDoc {
  _id: AgentRole;
  mode: AgentRoleMode;
  updatedBy: string;
  updatedAt: Date;
}

export interface AgentPolicyDoc {
  _id: string; // `${fabId}:${materialId}`
  fabId: FabId;
  materialId: string;
  supplierId: string;
  supplierName: string;
  moq: number;
  orderMultiple: number;
  leadTimeDays: number;
  unitPrice: number;
  currency: "KRW";
  effectiveFrom: string;
  updatedBy: string;
  updatedAt: Date;
}

// 자율등급 사람 확정값 — AgentPolicyDoc과 별도 컬렉션으로 둔다.
// AgentPolicyDoc은 moq/orderMultiple 등 필수 필드를 가정하는 기존 발주량 계산
// (scenario-engine.applyOrderPolicy)이 의존하고 있어, 그 필드 없이 자율등급만
// upsert하면 부분 문서가 생겨 MOQ 계산이 NaN으로 깨질 위험이 있다.
export type AgentAutonomyLevel = 2 | 4;
export interface AgentAutonomyOverrideDoc {
  _id: string; // `${fabId ?? "ALL"}:${materialId}`
  materialId: string;
  fabId: FabId | null;
  level: AgentAutonomyLevel;
  updatedBy: string;
  updatedAt: Date;
}

// PROCUREMENT 그림자 조종석이 읽는 "현재 활성 시나리오". 사람이 /simulation에서
// What-if를 세우고 "입고 관제에 반영"을 누르면 이 싱글턴에 저장된다. 없으면
// 그림자 에이전트는 이벤트 없는 "현재 재고 기준 위험 점검"으로 되돌아간다.
export interface ProcurementActiveScenarioDoc {
  _id: "singleton";
  label: string;
  events: { id: string; product: "HBM" | "DRAM" | "NAND"; startDay: number; changePct: number; durationDays: number }[];
  horizonDays: number;
  coverageDays: number;
  fabId: FabId | null;
  submittedBy: string;
  submittedAt: Date;
}

export type PurchaseOrderDraftStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "OUTBOXED" | "CANCELLED";
export interface PurchaseOrderDraftDoc {
  _id: string;
  poNo: string;
  sourceWorkOrderId: string;
  agentRunId: string;
  materialId: string;
  supplierId: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  currency: "KRW";
  moq: number;
  orderMultiple: number;
  leadTimeDays: number;
  expectedDate: Date;
  status: PurchaseOrderDraftStatus;
  policyVersion: string;
  calculation: {
    onHand: number;
    activeReservations: number;
    confirmedInbound: number;
    projectedAvailable: number;
    policyTarget: number;
    shortage: number;
  };
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  approvedBy?: string;
  approvedAt?: Date;
  rejectedBy?: string;
  rejectedAt?: Date;
  rejectionReason?: string;
}

export interface IntegrationOutboxDoc {
  _id: string;
  aggregateType: "PURCHASE_ORDER";
  aggregateId: string;
  eventType: "PURCHASE_ORDER_APPROVED";
  payload: Record<string, unknown>;
  status: "PENDING" | "SENT" | "FAILED";
  createdAt: Date;
  sentAt?: Date;
}

export type WhatIfCopilotActionStatus = "NEW" | "ACKNOWLEDGED" | "SNOOZED" | "DISMISSED";

export interface WhatIfCopilotActionDoc {
  _id: string;
  userId: string;
  scopeHash: string;
  candidateId: string;
  status: WhatIfCopilotActionStatus;
  snoozedUntil?: Date | null;
  reason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WhatIfCopilotBriefingDoc {
  _id: string;
  candidateHash: string;
  role: Role;
  promptVersion: string;
  model: string;
  status: "GENERATING" | "COMPLETE" | "FAILED";
  generationId: string;
  narratives: {
    candidateId: string;
    actionCode: string;
    title: string;
    why: string;
    action: string;
    inactionImpact: string;
  }[];
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  error?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AIInvocationDoc {
  _id: string;
  feature: "WHAT_IF_COPILOT";
  userId: string;
  role: Role;
  inputHash: string;
  model: string;
  promptVersion: string;
  status: "SUCCESS" | "FAILED";
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  latencyMs: number;
  error?: string | null;
  createdAt: Date;
}

export type MarketSourceId = "TWSE" | "SEC";
export type MarketSourceStatus = "HEALTHY" | "STALE" | "ERROR" | "DISABLED" | "NEVER_COLLECTED";

export interface MarketSourceDoc {
  _id: MarketSourceId;
  label: string;
  officialUrl: string;
  cadence: string;
  freshnessMs: number;
  status: MarketSourceStatus;
  lastAttemptAt?: Date | null;
  lastSuccessAt?: Date | null;
  lastError?: string | null;
  updatedAt: Date;
}

export interface MarketIngestionRunDoc {
  _id: string;
  sourceId: MarketSourceId;
  window: string;
  status: "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";
  startedAt: Date;
  finishedAt?: Date | null;
  fetchedCount: number;
  storedCount: number;
  error?: string | null;
}

export interface MarketRawArtifactDoc {
  _id: string;
  sourceId: MarketSourceId;
  hash: string;
  sourceUrl: string;
  contentType: string;
  payload: string;
  collectedAt: Date;
}

export interface MarketObservationDoc {
  _id: string;
  sourceId: MarketSourceId;
  metricId: "MONTHLY_REVENUE" | "SEC_FILING";
  entityId: string;
  entityName: string;
  period: string;
  value?: number | null;
  unit?: string | null;
  changeMoM?: number | null;
  changeYoY?: number | null;
  title?: string | null;
  detail?: string | null;
  sourceUrl: string;
  observedAt: Date;
  publishedAt: Date;
  collectedAt: Date;
  rawHash: string;
  artifactHash: string;
  revision: number;
  previousId?: string | null;
  quality: "ACTUAL";
  license: string;
}

export interface EquipmentAssignmentDoc {
  _id: string;
  workOrderId: string;
  equipmentId: string;
  fabId: FabId;
  processCode: string;
  plannedLoad: number;
  capacityUnit: "WAFER_DAY";
  capacitySource: "MODELED_BASELINE" | "MES_MASTER";
  status: "RESERVED" | "ACTIVE" | "COMPLETED" | "CANCELLED";
  createdAt: Date;
  updatedAt: Date;
}

export type BottleneckRisk = "HIGH" | "MEDIUM" | "LOW";

export interface ProcessMetadataDoc {
  _id: string;        // processCode (예: "P01")
  name: string;       // 한국어 이름 (예: "산화막")
  nameEn: string;     // 영문 이름 (예: "Oxidation")
  sequence: number;   // 공정 순서 (P01=1, P10=10)
  bottleneckRisk: BottleneckRisk;
}

// ─── 컬렉션 접근자 ─────────────────────────────────────────
export async function collections(): Promise<{
  users: Collection<UserDoc>;
  materials: Collection<MaterialDoc>;
  warehouses: Collection<WarehouseDoc>;
  inventory: Collection<InventoryDoc>;
  twinEngineState: Collection<TwinEngineStateDoc>;
  twinPurchaseOrders: Collection<TwinPurchaseOrderDoc>;
  twinBurnEvents: Collection<TwinBurnEventDoc>;
  twinDailySnapshots: Collection<TwinDailySnapshotDoc>;
  processUsage: Collection<ProcessUsageDoc>;
  transactions: Collection<TransactionDoc>;
  suppliers: Collection<SupplierDoc>;
  materialSuppliers: Collection<MaterialSupplierDoc>;
  infraEquipment: Collection<InfraDoc>;
  risks: Collection<RiskDoc>;
  wikiEntries: Collection<WikiDoc>;
  warehouseZones: Collection<WarehouseZoneDoc>;
  storageLocations: Collection<StorageLocationDoc>;
  inventoryLots: Collection<InventoryLotDoc>;
  handlingUnits: Collection<HandlingUnitDoc>;
  inventoryMovements: Collection<InventoryMovementDoc>;
  inventoryReconciliationBatches: Collection<InventoryReconciliationBatchDoc>;
  inventoryReconciliationEntries: Collection<InventoryReconciliationEntryDoc>;
  inventoryVerificationCases: Collection<InventoryVerificationCaseDoc>;
  inventoryVerificationObservations: Collection<InventoryVerificationObservationDoc>;
  inventoryVerificationEvents: Collection<InventoryVerificationEventDoc>;
  inventoryBalancesV2: Collection<InventoryBalanceV2Doc>;
  inventoryMovementsV2: Collection<InventoryMovementV2Doc>;
  materialUomLocksV2: Collection<MaterialUomLockV2Doc>;
  materialUomRulesV2: Collection<MaterialUomRuleV2Doc>;
  facilityTelemetry: Collection<FacilityTelemetryDoc>;
  benefitCases: Collection<BenefitCaseDoc>;
  simState: Collection<SimStateDoc>;
  simPurchaseOrders: Collection<SimPurchaseOrderDoc>;
  simEvents: Collection<SimEventDoc>;
  simCheckpoints: Collection<SimCheckpointDoc>;
  bomTemplates: Collection<BomTemplateDoc>;
  workOrders: Collection<WorkOrderDoc>;
  processMetadata: Collection<ProcessMetadataDoc>;
  inboundPlans: Collection<InboundPlanDoc>;
  inventoryPolicies: Collection<InventoryPolicyDoc>;
  inventoryPolicyAudits: Collection<InventoryPolicyAuditDoc>;
  facilityNodes: Collection<FacilityNodeDoc>;
  materialAllocations: Collection<MaterialAllocationDoc>;
  transferOrders: Collection<TransferOrderDoc>;
  materialFlowEvents: Collection<MaterialFlowEventDoc>;
  fabMaterialStocks: Collection<FabMaterialStockDoc>;
  equipmentMaster: Collection<EquipmentMasterDoc>;
  agentRuns: Collection<AgentRunDoc>;
  agentDecisions: Collection<AgentDecisionDoc>;
  agentPolicies: Collection<AgentPolicyDoc>;
  agentRoleModes: Collection<AgentRoleModeDoc>;
  agentAutonomyOverrides: Collection<AgentAutonomyOverrideDoc>;
  procurementActiveScenario: Collection<ProcurementActiveScenarioDoc>;
  purchaseOrderDrafts: Collection<PurchaseOrderDraftDoc>;
  integrationOutbox: Collection<IntegrationOutboxDoc>;
  equipmentAssignments: Collection<EquipmentAssignmentDoc>;
  productionActuals: Collection<ProductionActualDoc>;
  materialReroutes: Collection<MaterialRerouteDoc>;
  routeMasters: Collection<RouteMasterDoc>;
  waferLots: Collection<WaferLotDoc>;
  waferLotStepEvents: Collection<WaferLotStepEventDoc>;
  productionCarriers: Collection<ProductionCarrierDoc>;
  lotCarrierAssignments: Collection<LotCarrierAssignmentDoc>;
  foupWipBootstrapManifests: Collection<FoupWipBootstrapManifestDoc>;
  fabScenarios: Collection<FabScenarioDoc>;
  whatIfCopilotActions: Collection<WhatIfCopilotActionDoc>;
  whatIfCopilotBriefings: Collection<WhatIfCopilotBriefingDoc>;
  aiInvocations: Collection<AIInvocationDoc>;
  controlTowerAIEpisodes: Collection<ControlTowerAIEpisodeDoc>;
  controlTowerAIState: Collection<ControlTowerAIStateDoc>;
  marketSources: Collection<MarketSourceDoc>;
  marketIngestionRuns: Collection<MarketIngestionRunDoc>;
  marketRawArtifacts: Collection<MarketRawArtifactDoc>;
  marketObservations: Collection<MarketObservationDoc>;
  finishedGoods: Collection<FinishedGoodsDoc>;
  finishedGoodsEvents: Collection<FinishedGoodsEventDoc>;
  wipStepBuckets: Collection<WipStepBucketDoc>;
  customers: Collection<CustomerDoc>;
  shipments: Collection<ShipmentDoc>;
}> {
  const db = await getDb();
  return {
    users: db.collection<UserDoc>("users"),
    materials: db.collection<MaterialDoc>("materials"),
    warehouses: db.collection<WarehouseDoc>("warehouses"),
    inventory: db.collection<InventoryDoc>("inventory"),
    twinEngineState: db.collection<TwinEngineStateDoc>("twinEngineState"),
    twinPurchaseOrders: db.collection<TwinPurchaseOrderDoc>("twinPurchaseOrders"),
    twinBurnEvents: db.collection<TwinBurnEventDoc>("twinBurnEvents"),
    twinDailySnapshots: db.collection<TwinDailySnapshotDoc>("twinDailySnapshots"),
    processUsage: db.collection<ProcessUsageDoc>("processUsage"),
    transactions: db.collection<TransactionDoc>("transactions"),
    suppliers: db.collection<SupplierDoc>("suppliers"),
    materialSuppliers: db.collection<MaterialSupplierDoc>("materialSuppliers"),
    infraEquipment: db.collection<InfraDoc>("infraEquipment"),
    risks: db.collection<RiskDoc>("risks"),
    wikiEntries: db.collection<WikiDoc>("wikiEntries"),
    warehouseZones: db.collection<WarehouseZoneDoc>("warehouseZones"),
    storageLocations: db.collection<StorageLocationDoc>("storageLocations"),
    inventoryLots: db.collection<InventoryLotDoc>("inventoryLots"),
    handlingUnits: db.collection<HandlingUnitDoc>("handlingUnits"),
    inventoryMovements: db.collection<InventoryMovementDoc>("inventoryMovements"),
    inventoryReconciliationBatches: db.collection<InventoryReconciliationBatchDoc>("inventoryReconciliationBatches"),
    inventoryReconciliationEntries: db.collection<InventoryReconciliationEntryDoc>("inventoryReconciliationEntries"),
    inventoryVerificationCases: db.collection<InventoryVerificationCaseDoc>("inventoryVerificationCases"),
    inventoryVerificationObservations: db.collection<InventoryVerificationObservationDoc>("inventoryVerificationObservations"),
    inventoryVerificationEvents: db.collection<InventoryVerificationEventDoc>("inventoryVerificationEvents"),
    inventoryBalancesV2: db.collection<InventoryBalanceV2Doc>("inventoryBalancesV2"),
    inventoryMovementsV2: db.collection<InventoryMovementV2Doc>("inventoryMovementsV2"),
    materialUomLocksV2: db.collection<MaterialUomLockV2Doc>("materialUomLocksV2"),
    materialUomRulesV2: db.collection<MaterialUomRuleV2Doc>("materialUomRulesV2"),
    facilityTelemetry: db.collection<FacilityTelemetryDoc>("facilityTelemetry"),
    benefitCases: db.collection<BenefitCaseDoc>("benefitCases"),
    simState: db.collection<SimStateDoc>("simState"),
    simPurchaseOrders: db.collection<SimPurchaseOrderDoc>("simPurchaseOrders"),
    simEvents: db.collection<SimEventDoc>("simEvents"),
    simCheckpoints: db.collection<SimCheckpointDoc>("simCheckpoints"),
    bomTemplates: db.collection<BomTemplateDoc>("bomTemplates"),
    workOrders: db.collection<WorkOrderDoc>("workOrders"),
    processMetadata: db.collection<ProcessMetadataDoc>("processMetadata"),
    inboundPlans: db.collection<InboundPlanDoc>("inboundPlans"),
    inventoryPolicies: db.collection<InventoryPolicyDoc>("inventoryPolicies"),
    inventoryPolicyAudits: db.collection<InventoryPolicyAuditDoc>("inventoryPolicyAudits"),
    facilityNodes: db.collection<FacilityNodeDoc>("facilityNodes"),
    materialAllocations: db.collection<MaterialAllocationDoc>("materialAllocations"),
    transferOrders: db.collection<TransferOrderDoc>("transferOrders"),
    materialFlowEvents: db.collection<MaterialFlowEventDoc>("materialFlowEvents"),
    fabMaterialStocks: db.collection<FabMaterialStockDoc>("fabMaterialStocks"),
    equipmentMaster: db.collection<EquipmentMasterDoc>("equipmentMaster"),
    agentRuns: db.collection<AgentRunDoc>("agentRuns"),
    agentDecisions: db.collection<AgentDecisionDoc>("agentDecisions"),
    agentPolicies: db.collection<AgentPolicyDoc>("agentPolicies"),
    agentRoleModes: db.collection<AgentRoleModeDoc>("agentRoleModes"),
    agentAutonomyOverrides: db.collection<AgentAutonomyOverrideDoc>("agentAutonomyOverrides"),
    procurementActiveScenario: db.collection<ProcurementActiveScenarioDoc>("procurementActiveScenario"),
    purchaseOrderDrafts: db.collection<PurchaseOrderDraftDoc>("purchaseOrderDrafts"),
    integrationOutbox: db.collection<IntegrationOutboxDoc>("integrationOutbox"),
    equipmentAssignments: db.collection<EquipmentAssignmentDoc>("equipmentAssignments"),
    productionActuals: db.collection<ProductionActualDoc>("productionActuals"),
    materialReroutes: db.collection<MaterialRerouteDoc>("materialReroutes"),
    routeMasters: db.collection<RouteMasterDoc>("routeMasters"),
    waferLots: db.collection<WaferLotDoc>("waferLots"),
    waferLotStepEvents: db.collection<WaferLotStepEventDoc>("waferLotStepEvents"),
    productionCarriers: db.collection<ProductionCarrierDoc>("productionCarriers"),
    lotCarrierAssignments: db.collection<LotCarrierAssignmentDoc>("lotCarrierAssignments"),
    foupWipBootstrapManifests: db.collection<FoupWipBootstrapManifestDoc>("foupWipBootstrapManifests"),
    fabScenarios: db.collection<FabScenarioDoc>("fabScenarios"),
    whatIfCopilotActions: db.collection<WhatIfCopilotActionDoc>("whatIfCopilotActions"),
    whatIfCopilotBriefings: db.collection<WhatIfCopilotBriefingDoc>("whatIfCopilotBriefings"),
    aiInvocations: db.collection<AIInvocationDoc>("aiInvocations"),
    controlTowerAIEpisodes: db.collection<ControlTowerAIEpisodeDoc>("controlTowerAIEpisodes"),
    controlTowerAIState: db.collection<ControlTowerAIStateDoc>("controlTowerAIState"),
    marketSources: db.collection<MarketSourceDoc>("marketSources"),
    marketIngestionRuns: db.collection<MarketIngestionRunDoc>("marketIngestionRuns"),
    marketRawArtifacts: db.collection<MarketRawArtifactDoc>("marketRawArtifacts"),
    marketObservations: db.collection<MarketObservationDoc>("marketObservations"),
    finishedGoods: db.collection<FinishedGoodsDoc>("finishedGoods"),
    finishedGoodsEvents: db.collection<FinishedGoodsEventDoc>("finishedGoodsEvents"),
    wipStepBuckets: db.collection<WipStepBucketDoc>("wipStepBuckets"),
    customers: db.collection<CustomerDoc>("customers"),
    shipments: db.collection<ShipmentDoc>("shipments"),
  };
}
