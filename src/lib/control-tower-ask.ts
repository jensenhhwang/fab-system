import type { ControlTowerAIUsage, ControlTowerEvidenceFact, ControlTowerRole } from "@/lib/control-tower-live";

export const CONTROL_TOWER_ASK_MAX_QUESTION_CHARS = 300;

export type ControlTowerAskActionSuggestion = {
  actionType: "CREATE_INBOUND_PLAN_DRAFT";
  targetRef: string;
  reason: string;
};

export type ControlTowerAskActionResult = {
  proposalId: string;
  status: "EXECUTED";
  inboundPlanId: string;
  planNo: string;
  executedAt: string;
};

export type ControlTowerAskActionPreview = {
  proposalId: string;
  previewToken: string;
  expiresAt: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  supplierName: string;
  unit: string;
  currentQuantity: number;
  activeInboundQuantity: number;
  targetQuantity: number;
  plannedQuantity: number;
  plannedDate: string;
  reviewStatus: "READY";
  reason: string;
};

export const CONTROL_TOWER_ASK_ROLE_META: Record<
  ControlTowerRole,
  { name: string; team: string; color: string; example: string }
> = {
  PROCUREMENT: {
    name: "김구매",
    team: "구매본부",
    color: "#EA002C",
    example: "지금 가장 먼저 발주를 검토할 자재가 뭐야?",
  },
  MATERIALS: {
    name: "이자재",
    team: "자재관리팀",
    color: "#0078D4",
    example: "현재 가용재고에서 가장 주의할 자재가 뭐야?",
  },
  PRODUCTION: {
    name: "최생산",
    team: "생산관리팀",
    color: "#00A86B",
    example: "자재 상태가 생산에 주는 영향을 알려줘.",
  },
  LOGISTICS: {
    name: "박물류",
    team: "물류/인프라팀",
    color: "#F59E0B",
    example: "현재 입고와 창고 용량에서 주의할 점이 뭐야?",
  },
};

export type ControlTowerAskAnswer = {
  status: "ANSWERED" | "INSUFFICIENT_EVIDENCE" | "OUT_OF_SCOPE";
  answer: string;
  recommendation: string;
  assumptions: string[];
  evidenceRefs: string[];
  suggestedRole: ControlTowerRole | null;
  actionSuggestion: ControlTowerAskActionSuggestion | null;
  advisoryOnly: true;
};

export type ControlTowerAskMessageView = {
  id: string;
  threadId: string;
  role: ControlTowerRole;
  question: string;
  status: "PROCESSING" | "ANSWERED" | "FAILED";
  answer: ControlTowerAskAnswer | null;
  evidence: ControlTowerEvidenceFact[];
  usage: ControlTowerAIUsage | null;
  costUsd: number | null;
  model: string | null;
  latencyMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  action: ControlTowerAskActionResult | null;
};

export type ControlTowerAskThreadSummary = {
  id: string;
  role: ControlTowerRole;
  snapshotCapturedAt: string;
  createdAt: string;
  expiresAt: string;
};

export type ControlTowerAskHistory = {
  thread: ControlTowerAskThreadSummary | null;
  messages: ControlTowerAskMessageView[];
  recentThreads: ControlTowerAskThreadSummary[];
  capabilities?: { createInboundPlan: boolean };
};
