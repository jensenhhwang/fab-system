export type DemoScenario = "normal" | "delay" | "surge" | "variance";
export type EventKind = "RECEIPT" | "CONSUMPTION" | "TRANSFER" | "ADJUSTMENT" | "PLAN";
export type EventState = "ACTUAL" | "CONFIRMED" | "PENDING";

export type DemoEvent = {
  id: string;
  materialId: string;
  time: string;
  kind: EventKind;
  state: EventState;
  quantity: number;
  source: string;
  reference: string;
  description: string;
  affectsInventory: boolean;
};

export type DemoMaterial = {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  unit: string;
  category: "GAS" | "CHM" | "CSM";
  opening: number;
  safetyStock: number;
  ropDays: number;
  dailyUsage: number;
  holdQuantity: number;
  baseReceipt: number;
  baseUsed: number;
  remainingReceipt: number;
  remainingUsage: number;
  usageCoefficients: Record<ProductKey, number>;
  lastEventAt: string;
};

export type ProductKey = "HBM" | "DRAM" | "NAND";
export type ProductionActuals = Record<ProductKey, number>;
export const PRODUCTION_PLAN: Record<ProductKey, { label: string; plan: number; unit: string }> = {
  HBM: { label: "HBM", plan: 12, unit: "K wafer" },
  DRAM: { label: "DRAM", plan: 18, unit: "K wafer" },
  NAND: { label: "NAND", plan: 15, unit: "K wafer" },
};
export const DEFAULT_PRODUCTION_ACTUALS: ProductionActuals = { HBM: 10.8, DRAM: 17.6, NAND: 15.4 };

export type MaterialControlRow = DemoMaterial & {
  actualReceipt: number;
  actualUsed: number;
  adjustment: number;
  current: number;
  projectedClose: number;
  closeDoh: number;
  status: "critical" | "warning" | "ok" | "safe" | "review";
  statusReason: string;
  pendingVariance: number;
  forecastReceipt: number;
  forecastUsage: number;
  previousClose: number;
  events: DemoEvent[];
  usageByProduct: { product: ProductKey; production: number; coefficient: number; usage: number }[];
};

export const SCENARIOS: { id: DemoScenario; label: string; note: string }[] = [
  { id: "normal", label: "정상 운영", note: "입고와 공정 사용이 승인 계획 범위에서 진행됩니다." },
  { id: "delay", label: "입고 지연", note: "SiH₄ 입고가 13:00에서 19:00로 밀려 마감 전망이 낮아집니다." },
  { id: "surge", label: "생산 급증", note: "HBM 긴급 증산으로 NF₃와 EUV PR 사용량이 증가합니다." },
  { id: "variance", label: "실사 불일치", note: "NF₃ 장부와 실사 간 -6봄베 차이가 승인 대기 중입니다." },
];

export const MATERIALS: DemoMaterial[] = [
  { id: "nf3", code: "GAS-NF3-001", name: "삼불화질소", nameEn: "Nitrogen trifluoride", unit: "봄베", category: "GAS", opening: 126, safetyStock: 90, ropDays: 7, dailyUsage: 17, holdQuantity: 4, baseReceipt: 40, baseUsed: 31, remainingReceipt: 0, remainingUsage: 17, usageCoefficients: { HBM: 1.2, DRAM: 0.65, NAND: 0.45 }, lastEventAt: "13:42" },
  { id: "sih4", code: "GAS-SIH4-002", name: "실란", nameEn: "Silane", unit: "봄베", category: "GAS", opening: 92, safetyStock: 78, ropDays: 6, dailyUsage: 15, holdQuantity: 2, baseReceipt: 0, baseUsed: 20, remainingReceipt: 30, remainingUsage: 9, usageCoefficients: { HBM: 0.72, DRAM: 0.42, NAND: 0.28 }, lastEventAt: "13:10" },
  { id: "euv-pr", code: "CSM-EUV-011", name: "EUV 포토레지스트", nameEn: "EUV photoresist", unit: "캔", category: "CSM", opening: 184, safetyStock: 120, ropDays: 8, dailyUsage: 14, holdQuantity: 8, baseReceipt: 24, baseUsed: 39, remainingReceipt: 0, remainingUsage: 12, usageCoefficients: { HBM: 2.1, DRAM: 0.7, NAND: 0.12 }, lastEventAt: "13:36" },
  { id: "arf-pr", code: "CSM-ARF-008", name: "ArF 포토레지스트", nameEn: "ArF photoresist", unit: "캔", category: "CSM", opening: 232, safetyStock: 140, ropDays: 9, dailyUsage: 16, holdQuantity: 6, baseReceipt: 36, baseUsed: 45, remainingReceipt: 0, remainingUsage: 10, usageCoefficients: { HBM: 1.4, DRAM: 1.15, NAND: 0.55 }, lastEventAt: "12:55" },
  { id: "hf", code: "CHM-HF-004", name: "불산", nameEn: "Hydrofluoric acid", unit: "드럼", category: "CHM", opening: 144, safetyStock: 82, ropDays: 6, dailyUsage: 13, holdQuantity: 5, baseReceipt: 20, baseUsed: 31, remainingReceipt: 0, remainingUsage: 8, usageCoefficients: { HBM: 0.85, DRAM: 0.72, NAND: 0.55 }, lastEventAt: "13:18" },
  { id: "h2o2", code: "CHM-H2O2-007", name: "과산화수소", nameEn: "Hydrogen peroxide", unit: "드럼", category: "CHM", opening: 218, safetyStock: 110, ropDays: 7, dailyUsage: 15, holdQuantity: 0, baseReceipt: 32, baseUsed: 43, remainingReceipt: 0, remainingUsage: 11, usageCoefficients: { HBM: 1.05, DRAM: 1.0, NAND: 0.82 }, lastEventAt: "12:44" },
  { id: "cmp", code: "CHM-CMP-014", name: "Cu CMP 슬러리", nameEn: "Copper CMP slurry", unit: "드럼", category: "CHM", opening: 156, safetyStock: 96, ropDays: 8, dailyUsage: 12, holdQuantity: 4, baseReceipt: 18, baseUsed: 27, remainingReceipt: 12, remainingUsage: 9, usageCoefficients: { HBM: 0.9, DRAM: 0.62, NAND: 0.38 }, lastEventAt: "13:29" },
  { id: "he", code: "GAS-HE-003", name: "헬륨", nameEn: "Helium", unit: "봄베", category: "GAS", opening: 286, safetyStock: 130, ropDays: 8, dailyUsage: 18, holdQuantity: 0, baseReceipt: 48, baseUsed: 52, remainingReceipt: 0, remainingUsage: 13, usageCoefficients: { HBM: 1.25, DRAM: 1.05, NAND: 0.95 }, lastEventAt: "13:51" },
];

function baseEvents(material: DemoMaterial, actualUsed: number, forecastUsage: number): DemoEvent[] {
  const events: DemoEvent[] = [];
  if (material.baseReceipt > 0) events.push({ id: `${material.id}-receipt`, materialId: material.id, time: "09:24", kind: "RECEIPT", state: "ACTUAL", quantity: material.baseReceipt, source: "가상 WMS", reference: `GR-0712-${material.code.slice(-3)}`, description: "검수 완료 후 가용재고 반영", affectsInventory: true });
  events.push({ id: `${material.id}-transfer`, materialId: material.id, time: "10:40", kind: "TRANSFER", state: "ACTUAL", quantity: 0, source: "가상 WMS", reference: `MV-0712-${material.code.slice(-3)}`, description: "창고에서 공정 공급구역으로 이동", affectsInventory: false });
  events.push({ id: `${material.id}-use`, materialId: material.id, time: material.lastEventAt, kind: "CONSUMPTION", state: "ACTUAL", quantity: -actualUsed, source: "가상 MES", reference: `WO-0712-${material.code.slice(-3)}`, description: "제품별 생산실적 × 공정 원단위", affectsInventory: true });
  if (material.remainingReceipt > 0) events.push({ id: `${material.id}-inbound-plan`, materialId: material.id, time: "16:00", kind: "PLAN", state: "CONFIRMED", quantity: material.remainingReceipt, source: "구매계획", reference: `PO-0712-${material.code.slice(-3)}`, description: "금일 확정 입고 예정", affectsInventory: false });
  events.push({ id: `${material.id}-usage-plan`, materialId: material.id, time: "14:00–24:00", kind: "PLAN", state: "CONFIRMED", quantity: -forecastUsage, source: "생산계획", reference: `PP-0712-${material.code.slice(-3)}`, description: "잔여 생산계획 × 제품별 원단위", affectsInventory: false });
  return events;
}

function statusFor(projectedClose: number, available: number, dailyUsage: number, ropDays: number) {
  const doh = projectedClose / dailyUsage;
  if (projectedClose < 0 || doh < 5) return { status: "critical" as const, reason: `마감 DOH ${doh.toFixed(1)}일` };
  if (projectedClose < available || doh < ropDays) return { status: "warning" as const, reason: `안전기준 ${ropDays}일 미만` };
  if (doh < ropDays * 2) return { status: "ok" as const, reason: "계획 범위 내" };
  return { status: "safe" as const, reason: "완충재고 충분" };
}

export function buildDailyControl(scenario: DemoScenario, productionActuals: ProductionActuals = DEFAULT_PRODUCTION_ACTUALS): MaterialControlRow[] {
  return MATERIALS.map((material) => {
    const actualReceipt = material.baseReceipt;
    const usageByProduct = (Object.keys(PRODUCTION_PLAN) as ProductKey[]).map((product) => ({ product, production: productionActuals[product], coefficient: material.usageCoefficients[product], usage: productionActuals[product] * material.usageCoefficients[product] }));
    const actualUsed = usageByProduct.reduce((sum, item) => sum + item.usage, 0);
    let forecastReceipt = material.remainingReceipt;
    const forecastUsage = (Object.keys(PRODUCTION_PLAN) as ProductKey[]).reduce((sum, product) => sum + Math.max(0, PRODUCTION_PLAN[product].plan - productionActuals[product]) * material.usageCoefficients[product], 0);
    let pendingVariance = 0;
    let events = baseEvents(material, actualUsed, forecastUsage);

    if (scenario === "delay" && material.id === "sih4") {
      forecastReceipt = 0;
      events = events.map((event) => event.id === "sih4-inbound-plan" ? { ...event, time: "19:00", description: "공급사 출발 지연 · 금일 마감 후 도착", quantity: 30 } : event);
    }
    if (scenario === "surge" && (material.id === "nf3" || material.id === "euv-pr")) {
      events.push({ id: `${material.id}-surge`, materialId: material.id, time: "13:48", kind: "PLAN", state: "CONFIRMED", quantity: 0, source: "생산계획", reference: "HBM-HOTLOT-07", description: "HBM 긴급 증산 생산실적 반영", affectsInventory: false });
    }
    if (scenario === "variance" && material.id === "nf3") {
      pendingVariance = -6;
      events.push({ id: "nf3-variance", materialId: material.id, time: "13:55", kind: "ADJUSTMENT", state: "PENDING", quantity: -6, source: "실사 점검", reference: "CC-0712-01", description: "장부 135 · 실사 129 · 조정 승인 대기", affectsInventory: false });
    }

    const adjustment = events.filter((event) => event.kind === "ADJUSTMENT" && event.state === "ACTUAL").reduce((sum, event) => sum + event.quantity, 0);
    const current = material.opening + actualReceipt - actualUsed + adjustment;
    const projectedClose = current + forecastReceipt - forecastUsage;
    const previousClose = projectedClose + (scenario === "normal" ? 2 : scenario === "delay" && material.id === "sih4" ? 30 : scenario === "surge" && (material.id === "nf3" || material.id === "euv-pr") ? (material.id === "nf3" ? 13 : 13) : 0);
    const baseStatus = statusFor(projectedClose, material.safetyStock, material.dailyUsage, material.ropDays);
    const isReview = pendingVariance !== 0;

    return {
      ...material,
      actualReceipt,
      actualUsed,
      adjustment,
      current,
      projectedClose,
      closeDoh: projectedClose / material.dailyUsage,
      status: isReview ? "review" : baseStatus.status,
      statusReason: isReview ? `실사 차이 ${pendingVariance}${material.unit}` : scenario === "delay" && material.id === "sih4" ? "입고 6시간 지연" : baseStatus.reason,
      pendingVariance,
      forecastReceipt,
      forecastUsage,
      previousClose,
      events: events.sort((a, b) => a.time.localeCompare(b.time)),
      usageByProduct,
    };
  });
}

export function scenarioBriefing(scenario: DemoScenario, rows: MaterialControlRow[]) {
  const affected = rows.filter((row) => row.status === "critical" || row.status === "warning" || row.status === "review");
  if (scenario === "normal") return `금일 운영은 계획 범위 안입니다. ${affected.length}개 자재를 마감 전 확인하세요.`;
  if (scenario === "delay") return "SiH₄ 확정 입고가 마감 이후로 지연되어 마감 예상과 가용일수가 하락했습니다.";
  if (scenario === "surge") return "HBM 긴급 증산으로 NF₃와 EUV 포토레지스트의 현재고·마감 전망이 함께 감소했습니다.";
  return "NF₃ 실사에서 -6봄베 차이가 발견됐습니다. 승인 전이므로 공식 현재고에는 반영하지 않았습니다.";
}
