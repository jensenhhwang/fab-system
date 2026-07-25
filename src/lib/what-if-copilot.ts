import type { Role, WhatIfCopilotActionStatus } from "@/lib/db";
import type {
  MaterialRecommendation,
  MaterialRecommendationPlan,
  ProductionPlanInput,
} from "@/lib/scenario-engine";

export const WHAT_IF_COPILOT_PROMPT_VERSION = "WHAT_IF_ACTIONS_V1";

export type WhatIfFab = "M20" | "M21" | "M22";
export type WhatIfActionCode =
  | "REVIEW_ORDER"
  | "VERIFY_LEAD_TIME"
  | "VERIFY_SUPPLIER"
  | "RECONCILE_INVENTORY"
  | "REVIEW_QUALITY_HOLD"
  | "REVIEW_EXPIRY"
  | "MONITOR";

export type WhatIfCandidate = {
  id: string;
  severity: "URGENT" | "WARNING" | "INFO";
  score: number;
  fabId: WhatIfFab | null;
  material: {
    id: string;
    code: string;
    name: string;
    unit: string;
    supplierName: string | null;
  };
  dueDay: number | null;
  needByDay: number | null;
  availableQuantity: number;
  confirmedInbound: number;
  recommendedQuantity: number;
  scenarioRequirement: number;
  baselineRequirement: number;
  classification: MaterialRecommendation["classification"];
  reasonCodes: string[];
  allowedActions: WhatIfActionCode[];
  primaryAction: WhatIfActionCode;
  evidence: MaterialRecommendation["evidence"] & {
    usageConfidence: NonNullable<MaterialRecommendation["material"]["usageConfidence"]> | "UNKNOWN";
  };
};

export type WhatIfNarrative = {
  candidateId: string;
  actionCode: WhatIfActionCode;
  title: string;
  why: string;
  action: string;
  inactionImpact: string;
};

export type WhatIfActionCard = {
  candidate: WhatIfCandidate;
  narrative: WhatIfNarrative;
  status: WhatIfCopilotActionStatus;
  snoozedUntil: string | null;
};

export type WhatIfCopilotResponse = {
  scopeHash: string;
  candidateHash: string;
  snapshotAt: string;
  generatedAt: string;
  source: "AI" | "CACHE" | "FALLBACK";
  cacheHit: boolean;
  refreshing: boolean;
  cards: WhatIfActionCard[];
  candidateCount: number;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  model: string | null;
  promptVersion: typeof WHAT_IF_COPILOT_PROMPT_VERSION;
};

export type WhatIfCopilotRequest = {
  fabId: WhatIfFab | null;
  input: ProductionPlanInput;
};

const ACTION_PRIORITY: { warning: MaterialRecommendation["warnings"][number]["code"]; action: WhatIfActionCode }[] = [
  { warning: "LEAD_TIME_MISSING", action: "VERIFY_LEAD_TIME" },
  { warning: "SUPPLIER_MISSING", action: "VERIFY_SUPPLIER" },
  { warning: "INVENTORY_LEDGER_MISMATCH", action: "RECONCILE_INVENTORY" },
  { warning: "QUALITY_BLOCKED", action: "REVIEW_QUALITY_HOLD" },
  { warning: "EXPIRY_RISK", action: "REVIEW_EXPIRY" },
];

const ACTION_LABEL: Record<WhatIfActionCode, string> = {
  REVIEW_ORDER: "발주 필요량과 납기를 검토하세요",
  VERIFY_LEAD_TIME: "공급사 리드타임을 확인하세요",
  VERIFY_SUPPLIER: "승인 공급사를 지정하세요",
  RECONCILE_INVENTORY: "집계재고와 로트 원장을 대사하세요",
  REVIEW_QUALITY_HOLD: "품질보류 재고의 해제 가능 여부를 확인하세요",
  REVIEW_EXPIRY: "만료 예정 로트의 사용 계획을 검토하세요",
  MONITOR: "재고 위험 변화를 계속 관찰하세요",
};

function primaryActionFor(row: MaterialRecommendation): WhatIfActionCode {
  for (const item of ACTION_PRIORITY) {
    if (row.warnings.some((warning) => warning.code === item.warning)) return item.action;
  }
  if (row.incrementalOrderQuantity > 0 || row.baseline.recommendedInbound > 0) return "REVIEW_ORDER";
  return "MONITOR";
}

function allowedActionsFor(row: MaterialRecommendation, primaryAction: WhatIfActionCode) {
  const actions: WhatIfActionCode[] = [primaryAction];
  if (row.incrementalOrderQuantity > 0 || row.baseline.recommendedInbound > 0) actions.push("REVIEW_ORDER");
  for (const item of ACTION_PRIORITY) {
    if (row.warnings.some((warning) => warning.code === item.warning)) actions.push(item.action);
  }
  actions.push("MONITOR");
  return [...new Set(actions)];
}

function candidateScore(row: MaterialRecommendation) {
  let score = row.classification === "SCENARIO_CAUSED_SHORTAGE"
    ? 120
    : row.classification === "EXISTING_SHORTAGE" ? 100 : 0;
  if (row.normalOrderByDay !== null) {
    if (row.normalOrderByDay <= 0) score += 80;
    else if (row.normalOrderByDay <= 7) score += 55;
    else if (row.normalOrderByDay <= 30) score += 30;
  } else if (row.scenario.firstNeedDay !== null) {
    score += 45;
  }
  score += row.warnings.reduce((total, warning) => (
    total + (warning.severity === "HIGH" ? 18 : warning.severity === "MEDIUM" ? 8 : 2)
  ), 0);
  if (row.policyAdjustedOrderQuantity > 0) score += 15;
  return score;
}

function severityFor(row: MaterialRecommendation, score: number): WhatIfCandidate["severity"] {
  if ((row.normalOrderByDay !== null && row.normalOrderByDay <= 0) || score >= 170) return "URGENT";
  if (row.scenario.firstNeedDay !== null || row.warnings.some((warning) => warning.severity === "HIGH")) return "WARNING";
  return "INFO";
}

export function buildWhatIfCandidates(
  plan: MaterialRecommendationPlan,
  fabId: WhatIfFab | null,
  limit = 10,
): WhatIfCandidate[] {
  return plan.recommendations
    .filter((row) => (
      row.classification !== "NO_INCREMENTAL_ORDER"
      || row.warnings.some((warning) => warning.severity !== "LOW")
    ))
    .map((row) => {
      const score = candidateScore(row);
      const primaryAction = primaryActionFor(row);
      const allowedActions = allowedActionsFor(row, primaryAction);
      return {
        id: `MATERIAL:${fabId ?? "ALL"}:${row.material.id}:${row.classification}:${primaryAction}`,
        severity: severityFor(row, score),
        score,
        fabId,
        material: {
          id: row.material.id,
          code: row.material.code,
          name: row.material.name,
          unit: row.material.unit,
          supplierName: row.material.supplierName ?? null,
        },
        dueDay: row.normalOrderByDay,
        needByDay: row.needByDay,
        availableQuantity: row.netInputs.available,
        confirmedInbound: row.netInputs.confirmedInbound,
        recommendedQuantity: row.policyAdjustedOrderQuantity || row.scenario.recommendedInbound,
        scenarioRequirement: row.scenario.grossRequirement,
        baselineRequirement: row.baseline.grossRequirement,
        classification: row.classification,
        reasonCodes: [
          row.classification,
          ...row.warnings.map((warning) => warning.code),
        ],
        allowedActions,
        primaryAction,
        evidence: {
          ...row.evidence,
          usageConfidence: row.material.usageConfidence ?? "UNKNOWN",
        },
      } satisfies WhatIfCandidate;
    })
    .sort((a, b) => b.score - a.score || a.material.code.localeCompare(b.material.code))
    .slice(0, Math.max(1, limit));
}

export function fallbackNarrative(candidate: WhatIfCandidate): WhatIfNarrative {
  const scenarioCreated = candidate.classification === "SCENARIO_CAUSED_SHORTAGE";
  const why = candidate.needByDay === null
    ? "현재 마스터 데이터와 재고 상태에 확인이 필요한 항목이 있습니다."
    : scenarioCreated
      ? "변경 생산계획에서 기준계획보다 추가 자재 대응이 필요합니다."
      : "현재 기준계획에서도 재고 보충 또는 마스터 확인이 필요합니다.";
  return {
    candidateId: candidate.id,
    actionCode: candidate.primaryAction,
    title: `${candidate.material.name} 대응`,
    why,
    action: ACTION_LABEL[candidate.primaryAction],
    inactionImpact: scenarioCreated
      ? "변경 생산계획에 필요한 자재 대응이 지연될 수 있습니다."
      : "현재 계획의 자재 대응과 공급 일정이 지연될 수 있습니다.",
  };
}

export function isWhatIfFab(value: unknown): value is WhatIfFab {
  return value === "M20" || value === "M21" || value === "M22";
}

export function normalizeWhatIfRequest(value: unknown): WhatIfCopilotRequest | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { fabId?: unknown; input?: unknown };
  if (raw.fabId !== null && !isWhatIfFab(raw.fabId)) return null;
  if (!raw.input || typeof raw.input !== "object") return null;
  const input = raw.input as Partial<ProductionPlanInput>;
  if (!Array.isArray(input.events)) return null;
  const events = input.events.slice(0, 20).map((event) => {
    if (!event || typeof event !== "object") return null;
    const item = event as Record<string, unknown>;
    const product = item.product;
    if (product !== "HBM" && product !== "DRAM" && product !== "NAND") return null;
    if (typeof item.id !== "string" || typeof item.startDay !== "number" || typeof item.changePct !== "number" || typeof item.durationDays !== "number") return null;
    return {
      id: item.id.slice(0, 120),
      product,
      startDay: Math.max(0, Math.round(item.startDay)),
      changePct: Math.max(-100, Math.min(300, item.changePct)),
      durationDays: Math.max(1, Math.round(item.durationDays)),
    };
  });
  if (events.some((event) => event === null)) return null;
  if (typeof input.horizonDays !== "number" || typeof input.coverageDays !== "number") return null;
  if (input.replenishmentMode !== "ROP" && input.replenishmentMode !== "STOCKOUT") return null;
  return {
    fabId: raw.fabId as WhatIfFab | null,
    input: {
      events: events as ProductionPlanInput["events"],
      horizonDays: Math.max(1, Math.min(365, Math.round(input.horizonDays))),
      coverageDays: Math.max(1, Math.min(180, Math.round(input.coverageDays))),
      replenishmentMode: input.replenishmentMode,
    },
  };
}

export function canUseWhatIfCopilot(role: Role) {
  return role === "ADMIN" || role === "MATERIALS";
}
