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

export interface UserDoc {
  _id: string; email: string; name: string; password: string;
  role: Role; department: string; createdAt?: Date;
}
export interface MaterialDoc {
  _id: string; code: string; name: string; nameEn?: string | null;
  category: Category; unit: string; safetyStock: number; ropDays: number; notes?: string | null;
}
export interface WarehouseDoc {
  _id: string; code: string; name: string; type: string;
  totalCapacity: number; unit: string; temperature?: string | null; notes?: string | null;
}
export interface InventoryDoc {
  _id: string; materialId: string; warehouseId: string; quantity: number; avgDailyUsage: number;
}
export interface ProcessUsageDoc {
  _id: string; materialId: string; processCode: string; product: Product; monthlyQty: number;
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
  };
}
