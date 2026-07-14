import { MongoClient, Db, Collection } from "mongodb";

// MongoDB(Atlas) 네이티브 드라이버. TCP 기반이라 Next.js fetch 패치 영향 없음.
// 서버리스 콜드스타트에서 커넥션을 재사용하도록 클라이언트를 글로벌 캐시.
const uri = process.env.DATABASE_URL;

const g = globalThis as unknown as { _mongoClientPromise?: Promise<MongoClient> };

function clientPromise(): Promise<MongoClient> {
  if (!uri) throw new Error("DATABASE_URL 환경변수가 설정되지 않았습니다 (MongoDB 연결 문자열).");
  if (!g._mongoClientPromise) {
    g._mongoClientPromise = new MongoClient(uri).connect();
  }
  return g._mongoClientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await clientPromise();
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
}
export interface InventoryDoc {
  _id: string; materialId: string; warehouseId: string; quantity: number; avgDailyUsage: number;
  capacityLimit?: number; // 벌크 탱크별 최대량 (자재 unit 기준)
  status?: InventoryStatus;
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
}
export interface InventoryLotDoc {
  _id: string; materialId: string; lotNo: string; quantity: number; availableQuantity: number;
  receivedAt: Date; manufactureDate?: Date; expiryDate?: Date;
  qualityStatus: InventoryStatus; holdReason?: string; updatedAt: Date;
  warehouseId?: string; slotId?: string;
  simulated?: true;
}
export interface HandlingUnitDoc {
  _id: string; inventoryLotId: string; materialId: string; warehouseId: string; locationId: string;
  containerType: string; quantity: number; status: InventoryStatus; updatedAt: Date;
}
export interface InventoryMovementDoc {
  _id: string; handlingUnitId?: string; materialId: string; type: "RECEIPT" | "PUTAWAY" | "MOVE" | "PICK" | "ISSUE" | "HOLD" | "RELEASE" | "QUARANTINE";
  fromLocationId?: string | null; toLocationId?: string | null; quantity: number;
  reason?: string; userId: string; createdAt: Date;
  lotId?: string; processCode?: string;
  simulated?: true;
}
export interface FacilityTelemetryDoc {
  _id: string; warehouseId: string; metric: "LEVEL" | "TEMPERATURE" | "HUMIDITY" | "PRESSURE" | "GAS_ALARM" | "UPW_RESISTIVITY" | "FLOW";
  value: number; unit: string; status: "NORMAL" | "WARNING" | "CRITICAL" | "STALE"; measuredAt: Date;
}
export interface ProcessUsageDoc {
  _id: string; materialId: string; processCode: string; product: Product; monthlyQty: number;
  site?: "이천" | "청주";
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
  actualQty?: number;
  pickedLots: PickedLot[];
}

export interface BomTemplateDoc {
  _id: string; // "{processCode}-{product}"
  processCode: string;
  product: Product;
  lines: { materialId: string; qtyPerRun: number }[];
  updatedAt: Date;
}

export type WorkOrderStatus = "QUEUED" | "MATERIAL_WAIT" | "RUNNING" | "DONE" | "HOLD";

export interface WorkOrderDoc {
  _id: string; // "WO-{Date.now()}"
  processCode: string;
  product: Product;
  plannedQty: number;
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

export type BottleneckRisk = "HIGH" | "MEDIUM" | "LOW";

export interface ProcessMetadataDoc {
  _id: string;        // processCode (예: "P01")
  name: string;       // 한국어 이름 (예: "산화막")
  nameEn: string;     // 영문 이름 (예: "Oxidation")
  site: ("이천" | "청주")[];  // 해당 공정이 있는 사이트
  sequence: number;   // 공정 순서 (P01=1, P10=10)
  bottleneckRisk: BottleneckRisk;
}

// ─── 컬렉션 접근자 ─────────────────────────────────────────
export async function collections(): Promise<{
  users: Collection<UserDoc>;
  materials: Collection<MaterialDoc>;
  warehouses: Collection<WarehouseDoc>;
  inventory: Collection<InventoryDoc>;
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
  facilityTelemetry: Collection<FacilityTelemetryDoc>;
  benefitCases: Collection<BenefitCaseDoc>;
  simState: Collection<SimStateDoc>;
  simPurchaseOrders: Collection<SimPurchaseOrderDoc>;
  simEvents: Collection<SimEventDoc>;
  simCheckpoints: Collection<SimCheckpointDoc>;
  bomTemplates: Collection<BomTemplateDoc>;
  workOrders: Collection<WorkOrderDoc>;
  processMetadata: Collection<ProcessMetadataDoc>;
}> {
  const db = await getDb();
  return {
    users: db.collection<UserDoc>("users"),
    materials: db.collection<MaterialDoc>("materials"),
    warehouses: db.collection<WarehouseDoc>("warehouses"),
    inventory: db.collection<InventoryDoc>("inventory"),
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
    facilityTelemetry: db.collection<FacilityTelemetryDoc>("facilityTelemetry"),
    benefitCases: db.collection<BenefitCaseDoc>("benefitCases"),
    simState: db.collection<SimStateDoc>("simState"),
    simPurchaseOrders: db.collection<SimPurchaseOrderDoc>("simPurchaseOrders"),
    simEvents: db.collection<SimEventDoc>("simEvents"),
    simCheckpoints: db.collection<SimCheckpointDoc>("simCheckpoints"),
    bomTemplates: db.collection<BomTemplateDoc>("bomTemplates"),
    workOrders: db.collection<WorkOrderDoc>("workOrders"),
    processMetadata: db.collection<ProcessMetadataDoc>("processMetadata"),
  };
}
