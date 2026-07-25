// 오늘의 입고 실적 셰이핑 — 순수 로직 (DB 접근 없음, 테스트 가능)
// 제약(패브 검증):
// - 자재 단위가 L/kg/EA/봄베 등으로 섞여 있어 총량을 하나로 합산하지 않는다. 카테고리별·단위별로만 집계.
// - 계획 달성률은 수량 합이 아니라 "건수" 기반: 분모=오늘 도착예정 CONFIRMED 계획 수, 분자=그중 다 채워진 계획 수.
// - plannedDate가 날짜 단위라 시각 기준 지연 판정 불가 → 지연은 날짜 단위(예정일이 오늘 이전인데 미완료).
// - 계획 없이 들어온 애드혹 입고는 별도 레인으로 분리(달성률 분모 오염 방지).

export type InboundCategory = "GAS" | "CHM" | "CSM" | "UTL" | "PKG";

export const CATEGORY_ORDER: InboundCategory[] = ["GAS", "CHM", "CSM", "UTL", "PKG"];
export const CATEGORY_LABEL: Record<InboundCategory, string> = {
  GAS: "특수가스",
  CHM: "케미컬",
  CSM: "소모품",
  UTL: "유틸리티",
  PKG: "패키징",
};
// 카테고리 리본색: 상태색(빨강/앰버/초록/파랑)과 겹치지 않는 식별색 (엑스 설계)
export const CATEGORY_COLOR: Record<InboundCategory, string> = {
  GAS: "#0E7C7B",
  CHM: "#6B4EAA",
  CSM: "#B08900",
  UTL: "#5E7A90",
  PKG: "#2E7D32",
};

// 스파크라인 시간창 (근무 시간대 고정 축)
export const HOUR_START = 6;
export const HOUR_END = 20;

export type InboundReceiptInput = {
  materialId: string;
  quantity: number;
  createdAt: string; // ISO
  inboundPlanId?: string | null;
};

export type InboundPlanInput = {
  id: string;
  planNo: string;
  materialId: string;
  unit: string;
  plannedDate: string; // ISO
  plannedQuantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
};

export type MaterialMeta = {
  code: string;
  name: string;
  category: InboundCategory;
  unit: string;
};

export type InboundTodayInput = {
  now: string; // ISO — 오늘 기준·상대시간·지연 판정
  receipts: InboundReceiptInput[]; // 오늘(now의 날짜) RECEIPT만 전달
  plans: InboundPlanInput[]; // 오늘 예정 + 지연(과거 예정 미완료) CONFIRMED 계획
  materials: Record<string, MaterialMeta>;
};

export type UnitTotal = { unit: string; quantity: number };
export type CategoryTotal = {
  category: InboundCategory;
  label: string;
  color: string;
  receiptCount: number;
  totalsByUnit: UnitTotal[];
};
export type HourBucket = { hour: number; count: number };
export type PlanAchievement = {
  plannedCount: number; // 오늘 도착예정 CONFIRMED 계획 수 (분모)
  completedCount: number; // 그중 다 채워진 계획 수 (분자)
  delayedCount: number; // 과거 예정인데 미완료
  pct: number;
};
export type RaceRowStatus = "COMPLETED" | "DELAYED" | "IN_PROGRESS" | "GHOST";
export type RaceRow = {
  planId: string;
  planNo: string;
  materialCode: string;
  materialName: string;
  category: InboundCategory;
  categoryColor: string;
  unit: string;
  plannedDate: string; // YYYY-MM-DD
  plannedQuantity: number;
  receivedQuantity: number;
  progressPct: number;
  status: RaceRowStatus;
};
export type AdhocRow = {
  materialCode: string;
  materialName: string;
  category: InboundCategory;
  categoryColor: string;
  quantity: number;
  unit: string;
  receivedAt: string; // ISO
};
export type InboundTodaySummary = {
  generatedAt: string;
  totalReceiptCount: number;
  lastReceiptAt: string | null;
  categoryTotals: CategoryTotal[];
  hourBuckets: HourBucket[];
  achievement: PlanAchievement;
  raceRows: RaceRow[];
  adhocRows: AdhocRow[];
};

const UNKNOWN_MATERIAL: MaterialMeta = { code: "?", name: "미등록 자재", category: "CSM", unit: "" };

// 런타임 로컬 타임존 기준 날짜 키 (앱은 KST 표기). 오늘/지연 판정은 날짜 단위로만.
function localDayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function round(n: number): number {
  return Math.round(n);
}

function clampPct(n: number): number {
  if (n < 0) return 0;
  if (n > 100) return 100;
  return round(n);
}

const STATUS_ORDER: Record<RaceRowStatus, number> = {
  DELAYED: 0,
  IN_PROGRESS: 1,
  GHOST: 2,
  COMPLETED: 3,
};

export function buildInboundToday(input: InboundTodayInput): InboundTodaySummary {
  const { now, receipts, plans, materials } = input;
  const todayKey = localDayKey(now);
  const meta = (id: string): MaterialMeta => materials[id] ?? UNKNOWN_MATERIAL;

  // ── 카테고리별 · 단위별 총량 (합산 금지) ──
  const catAgg = new Map<InboundCategory, { count: number; units: Map<string, number> }>();
  for (const r of receipts) {
    const m = meta(r.materialId);
    const entry = catAgg.get(m.category) ?? { count: 0, units: new Map<string, number>() };
    entry.count += 1;
    entry.units.set(m.unit, (entry.units.get(m.unit) ?? 0) + r.quantity);
    catAgg.set(m.category, entry);
  }
  const categoryTotals: CategoryTotal[] = CATEGORY_ORDER.filter((c) => catAgg.has(c)).map((c) => {
    const entry = catAgg.get(c)!;
    return {
      category: c,
      label: CATEGORY_LABEL[c],
      color: CATEGORY_COLOR[c],
      receiptCount: entry.count,
      totalsByUnit: [...entry.units.entries()]
        .map(([unit, quantity]) => ({ unit, quantity }))
        .sort((a, b) => b.quantity - a.quantity),
    };
  });

  // ── 시간대별 건수 (고정 축) ──
  const hourCount = new Map<number, number>();
  for (const r of receipts) {
    const h = new Date(r.createdAt).getHours();
    hourCount.set(h, (hourCount.get(h) ?? 0) + 1);
  }
  const hourBuckets: HourBucket[] = [];
  for (let h = HOUR_START; h <= HOUR_END; h += 1) {
    hourBuckets.push({ hour: h, count: hourCount.get(h) ?? 0 });
  }

  // ── 마지막 입고 시각 ──
  let lastReceiptAt: string | null = null;
  for (const r of receipts) {
    if (!lastReceiptAt || new Date(r.createdAt) > new Date(lastReceiptAt)) lastReceiptAt = r.createdAt;
  }

  // ── 레이스 트랙 행 (계획 기반) ──
  const raceRows: RaceRow[] = plans.map((p) => {
    const m = meta(p.materialId);
    const planKey = localDayKey(p.plannedDate);
    let status: RaceRowStatus;
    if (p.remainingQuantity <= 0) status = "COMPLETED";
    else if (planKey < todayKey) status = "DELAYED";
    else if (p.receivedQuantity > 0) status = "IN_PROGRESS";
    else status = "GHOST";
    return {
      planId: p.id,
      planNo: p.planNo,
      materialCode: m.code,
      materialName: m.name,
      category: m.category,
      categoryColor: CATEGORY_COLOR[m.category],
      unit: p.unit || m.unit,
      plannedDate: planKey,
      plannedQuantity: p.plannedQuantity,
      receivedQuantity: p.receivedQuantity,
      progressPct: p.plannedQuantity > 0 ? clampPct((p.receivedQuantity / p.plannedQuantity) * 100) : 0,
      status,
    };
  });
  raceRows.sort((a, b) => {
    if (STATUS_ORDER[a.status] !== STATUS_ORDER[b.status]) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    return a.plannedDate.localeCompare(b.plannedDate);
  });

  // ── 계획 달성률 (건수 기반) ──
  const todayPlans = plans.filter((p) => localDayKey(p.plannedDate) === todayKey);
  const plannedCount = todayPlans.length;
  const completedCount = todayPlans.filter((p) => p.remainingQuantity <= 0).length;
  const delayedCount = plans.filter((p) => localDayKey(p.plannedDate) < todayKey && p.remainingQuantity > 0).length;
  const achievement: PlanAchievement = {
    plannedCount,
    completedCount,
    delayedCount,
    pct: plannedCount > 0 ? clampPct((completedCount / plannedCount) * 100) : 0,
  };

  // ── 계획 외(애드혹) 입고 ──
  const adhocRows: AdhocRow[] = receipts
    .filter((r) => !r.inboundPlanId)
    .map((r) => {
      const m = meta(r.materialId);
      return {
        materialCode: m.code,
        materialName: m.name,
        category: m.category,
        categoryColor: CATEGORY_COLOR[m.category],
        quantity: r.quantity,
        unit: m.unit,
        receivedAt: r.createdAt,
      };
    })
    .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

  return {
    generatedAt: now,
    totalReceiptCount: receipts.length,
    lastReceiptAt,
    categoryTotals,
    hourBuckets,
    achievement,
    raceRows,
    adhocRows,
  };
}
