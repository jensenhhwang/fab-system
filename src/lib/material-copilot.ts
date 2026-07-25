import type { ProductDemand, ProductionPlanEvent } from "@/lib/scenario-engine";

export type CopilotIntent = "PRODUCTION_CHANGE" | "RISK_REVIEW";
export type CopilotFab = "M20" | "M21" | "M22";

export type MaterialScenarioInterpretation = {
  intent: CopilotIntent;
  fabId: CopilotFab | null;
  events: ProductionPlanEvent[];
  horizonDays: number;
  coverageDays: number;
  missingFields: string[];
  assumptions: string[];
  parsedBy: "AI" | "RULES" | "RULES_FALLBACK";
};

const PRODUCT_CODES = ["HBM", "DRAM", "NAND"] as const;

function daysBetween(snapshotAt: string, year: number, month: number, day: number) {
  const base = new Date(snapshotAt);
  const baseUtc = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate());
  const targetUtc = Date.UTC(year, month - 1, day);
  return Math.round((targetUtc - baseUtc) / 86_400_000);
}

function parseStartDay(text: string, snapshotAt: string, assumptions: string[]) {
  const base = new Date(snapshotAt);
  const iso = text.match(/(20\d{2})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})일?/);
  if (iso) return daysBetween(snapshotAt, Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const relative = text.match(/(\d+)\s*일\s*(?:뒤|후)/);
  if (relative) return Number(relative[1]);
  if (/오늘부터|오늘\s*시작/.test(text)) return 0;
  if (/내일부터|내일\s*시작/.test(text)) return 1;

  const nextMonth = text.match(/다음\s*달(?:\s*(\d{1,2})일)?(?:부터|에|\s)/);
  if (nextMonth) {
    const targetMonth = base.getUTCMonth() + 2;
    const year = base.getUTCFullYear() + Math.floor((targetMonth - 1) / 12);
    const month = ((targetMonth - 1) % 12) + 1;
    const day = Number(nextMonth[1] ?? 1);
    if (!nextMonth[1]) assumptions.push("'다음 달부터'를 다음 달 1일 시작으로 해석했습니다.");
    return daysBetween(snapshotAt, year, month, day);
  }

  const monthDay = text.match(/(?<!\d)(\d{1,2})월(?:\s*(\d{1,2})일)?(?:부터|에|\s)/);
  if (monthDay) {
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2] ?? 1);
    let year = base.getUTCFullYear();
    if (daysBetween(snapshotAt, year, month, day) < 0) year += 1;
    if (!monthDay[2]) assumptions.push(`'${month}월부터'를 ${month}월 1일 시작으로 해석했습니다.`);
    return daysBetween(snapshotAt, year, month, day);
  }
  return null;
}

function parseDurationDays(text: string) {
  const weeks = text.match(/(\d+)\s*주(?:간)?/);
  if (weeks) return Number(weeks[1]) * 7;
  const months = text.match(/(\d+)\s*(?:개월|달)(?:간)?/);
  if (months) return Number(months[1]) * 30;
  const days = text.match(/(\d+)\s*일(?:간|동안|유지)/);
  if (days) return Number(days[1]);
  return null;
}

export function parseMaterialScenarioPrompt(
  rawPrompt: string,
  snapshotAt: string,
  parsedBy: MaterialScenarioInterpretation["parsedBy"] = "RULES",
): MaterialScenarioInterpretation {
  const prompt = rawPrompt.trim();
  const upper = prompt.toUpperCase();
  const assumptions: string[] = [];
  const fabId = (upper.match(/\bM(?:20|21|22)\b/)?.[0] as CopilotFab | undefined) ?? null;
  const product = PRODUCT_CODES.find(code => upper.includes(code)) ?? null;
  const pctMatch = prompt.match(/([+-]?\d+(?:\.\d+)?)\s*(?:%|퍼센트)/);
  let changePct = pctMatch ? Number(pctMatch[1]) : null;
  if (changePct !== null && changePct >= 0 && /감소|감산|줄(?:여|이|여줘)|낮춰|내려/.test(prompt)) changePct *= -1;
  const startDay = parseStartDay(prompt, snapshotAt, assumptions);
  const durationDays = parseDurationDays(prompt);
  const hasProductionSignal = Boolean(product || pctMatch || /생산|증산|감산/.test(prompt));
  const intent: CopilotIntent = hasProductionSignal ? "PRODUCTION_CHANGE" : "RISK_REVIEW";
  const missingFields: string[] = [];
  const events: ProductionPlanEvent[] = [];

  if (intent === "PRODUCTION_CHANGE") {
    if (!fabId) missingFields.push("FAB");
    if (!product) missingFields.push("제품");
    if (changePct === null) missingFields.push("증감률");
    if (startDay === null) missingFields.push("시작일");
    if (durationDays === null) missingFields.push("유지 기간");
    if (product && changePct !== null && startDay !== null && durationDays !== null) {
      events.push({
        id: "copilot-event-1",
        product: product as keyof ProductDemand,
        changePct: Math.max(-100, Math.min(300, changePct)),
        startDay: Math.max(0, startDay),
        durationDays: Math.max(1, durationDays),
      });
    }
  }

  const eventEnd = events.reduce((max, event) => Math.max(max, event.startDay + event.durationDays), 0);
  return {
    intent,
    fabId,
    events,
    horizonDays: Math.max(90, eventEnd + 30),
    coverageDays: 30,
    missingFields,
    assumptions,
    parsedBy,
  };
}

export function normalizeAIInterpretation(
  value: unknown,
  prompt: string,
  snapshotAt: string,
): MaterialScenarioInterpretation | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const intent = raw.intent === "RISK_REVIEW" ? "RISK_REVIEW" : "PRODUCTION_CHANGE";
  if (intent === "RISK_REVIEW") {
    const fallback = parseMaterialScenarioPrompt(prompt, snapshotAt, "AI");
    return { ...fallback, intent, events: [], missingFields: [] };
  }
  const fabId = typeof raw.fabId === "string" && ["M20", "M21", "M22"].includes(raw.fabId)
    ? raw.fabId as CopilotFab
    : null;
  const product = typeof raw.product === "string" && PRODUCT_CODES.includes(raw.product as typeof PRODUCT_CODES[number])
    ? raw.product as keyof ProductDemand
    : null;
  const changePct = typeof raw.changePct === "number" && Number.isFinite(raw.changePct) ? raw.changePct : null;
  const startDate = typeof raw.startDate === "string" ? raw.startDate : null;
  const durationDays = typeof raw.durationDays === "number" && Number.isFinite(raw.durationDays) ? Math.round(raw.durationDays) : null;
  const startMatch = startDate?.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  const startDay = startMatch ? daysBetween(snapshotAt, Number(startMatch[1]), Number(startMatch[2]), Number(startMatch[3])) : null;
  const missingFields: string[] = [];
  if (!fabId) missingFields.push("FAB");
  if (!product) missingFields.push("제품");
  if (changePct === null) missingFields.push("증감률");
  if (startDay === null || startDay < 0) missingFields.push("시작일");
  if (durationDays === null || durationDays < 1) missingFields.push("유지 기간");
  const events = missingFields.length === 0 && product && changePct !== null && startDay !== null && durationDays !== null
    ? [{ id: "copilot-event-1", product, changePct: Math.max(-100, Math.min(300, changePct)), startDay, durationDays }]
    : [];
  const eventEnd = events.reduce((max, event) => Math.max(max, event.startDay + event.durationDays), 0);
  return {
    intent,
    fabId,
    events,
    horizonDays: Math.max(90, eventEnd + 30),
    coverageDays: 30,
    missingFields,
    assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.filter((item): item is string => typeof item === "string").slice(0, 4) : [],
    parsedBy: "AI",
  };
}
