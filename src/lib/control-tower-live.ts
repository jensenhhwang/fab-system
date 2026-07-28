// 관제탑 라이브 피드(MVP-1) — 살아있는 Twin이 4개 에이전트를 깨우고, 심박·소모·판단을
// 실시간으로 보여주는 읽기 전용 대시보드의 순수 타입/메타. (DB 접근 없음)
//
// 정직성 원칙: PROCUREMENT(김구매)는 기존 규칙 엔진을 근거로 LLM이 공개 판단을 만들고,
// 나머지 셋은 도메인 규칙 엔진이 완성되기 전까지 LLM_ONLY로 판단한다.
// 모든 결과는 읽기 전용 의견이며 운영 데이터를 실행하거나 변경하지 않는다.

export type ControlTowerRole = "PROCUREMENT" | "MATERIALS" | "PRODUCTION" | "LOGISTICS";
export type AgentConsciousness = "ACTIVE" | "OBSERVING";
export type ControlTowerJudgmentMode = "RULE_LLM" | "LLM_ONLY";

export const CONTROL_TOWER_PERSONAS: Record<
  ControlTowerRole,
  { name: string; team: string; color: string; remit: string; consciousness: AgentConsciousness; judgmentMode: ControlTowerJudgmentMode; roadmapNote?: string }
> = {
  PROCUREMENT: {
    name: "김구매", team: "구매본부", color: "#EA002C",
    remit: "공급 안정성·리드타임·발주 판단",
    consciousness: "ACTIVE", judgmentMode: "RULE_LLM",
  },
  MATERIALS: {
    name: "이자재", team: "자재관리팀", color: "#0078D4",
    remit: "재고 정확도·보관일수·자재 가용성",
    consciousness: "ACTIVE", judgmentMode: "LLM_ONLY", roadmapNote: "LLM 판단 · 규칙 엔진 준비 중",
  },
  PRODUCTION: {
    name: "최생산", team: "생산관리팀", color: "#00A86B",
    remit: "생산계획·공정 영향·작업지시",
    consciousness: "ACTIVE", judgmentMode: "LLM_ONLY", roadmapNote: "LLM 판단 · 규칙 엔진 준비 중",
  },
  LOGISTICS: {
    name: "박물류", team: "물류/인프라팀", color: "#F59E0B",
    remit: "입고 일정·창고 용량·이동 실행",
    consciousness: "ACTIVE", judgmentMode: "LLM_ONLY", roadmapNote: "LLM 판단 · 규칙 엔진 준비 중",
  },
};

export const CONTROL_TOWER_ROLE_ORDER: ControlTowerRole[] = ["PROCUREMENT", "MATERIALS", "PRODUCTION", "LOGISTICS"];

export type TwinEventType = "BURN" | "SHORTAGE" | "PO_ORDERED" | "PO_RECEIVED";
export type TwinEventView = {
  id: string;
  at: string;
  type: TwinEventType;
  materialCode: string;
  materialName: string;
  text: string;
  reactedBy: ControlTowerRole | null; // 이 신호에 반응(판단)한 에이전트
};

export type AgentWatchMetric = { label: string; value: string; tone?: "normal" | "warn" | "critical" };

export type ProcurementJudgmentView = {
  scenarioLabel: string;
  actionable: number;
  wouldAutoReceive: number;
  wouldPropose: number;
  blocked: number;
  top: {
    materialCode: string;
    materialName: string;
    verdict: string;
    verdictText: string;
    voice: string; // 김구매 목소리(LLM 각색). 숫자는 verdictText 그대로.
    voiceSource: "AI" | "FALLBACK" | "GUARD_FALLBACK";
  } | null;
};

export type ControlTowerAgentView = {
  role: ControlTowerRole;
  name: string;
  team: string;
  color: string;
  remit: string;
  consciousness: AgentConsciousness;
  judgmentMode: ControlTowerJudgmentMode;
  roadmapNote?: string;
  watching: AgentWatchMetric[];
  judgment: ProcurementJudgmentView | null; // 기존 PROCUREMENT 규칙 엔진의 현재 판정
};

export type ControlTowerEvidenceFact = {
  ref: string;
  role: ControlTowerRole;
  label: string;
  value: string;
  state: "NORMAL" | "ATTENTION" | "CRITICAL";
};

export type ControlTowerAIUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export type ControlTowerAIJudgment = {
  role: ControlTowerRole;
  mode: ControlTowerJudgmentMode;
  verdict: "OBSERVE" | "CHECK" | "ESCALATE" | "HOLD";
  severity: "NORMAL" | "ATTENTION" | "CRITICAL";
  summary: string;
  proposedDecision: string;
  evidenceRefs: string[];
  assumptions: string[];
  questionForRole: ControlTowerRole | null;
  question: string | null;
  usage: ControlTowerAIUsage;
  latencyMs: number;
};

export type ControlTowerAIReply = {
  speakerRole: ControlTowerRole;
  replyToRole: ControlTowerRole;
  stance: "AGREE" | "QUALIFY" | "DISAGREE";
  message: string;
  revisedDecision: string;
  evidenceRefs: string[];
  usage: ControlTowerAIUsage;
  latencyMs: number;
};

export type ControlTowerAIConclusion = {
  alignment: "ALIGNED" | "CONDITIONAL" | "DISAGREEMENT";
  summary: string;
  decisions: string[];
  openIssues: string[];
  evidenceRefs: string[];
  advisoryOnly: true;
  usage: ControlTowerAIUsage;
  latencyMs: number;
};

export type ControlTowerAIEpisodeStatus =
  | "RUNNING"
  | "COMPLETE"
  | "PARTIAL"
  | "FAILED";

export interface ControlTowerAIEpisodeDoc {
  _id: string;
  semanticHash: string;
  snapshotHash: string;
  status: ControlTowerAIEpisodeStatus;
  model: string;
  promptVersion: string;
  snapshot: {
    capturedAt: string;
    facts: ControlTowerEvidenceFact[];
    procurementRule: {
      scenarioLabel: string;
      actionable: number;
      wouldAutoReceive: number;
      wouldPropose: number;
      blocked: number;
      topVerdict: string | null;
      topVerdictText: string | null;
    };
  };
  judgments: ControlTowerAIJudgment[];
  replies: ControlTowerAIReply[];
  conclusion: ControlTowerAIConclusion | null;
  usage: ControlTowerAIUsage;
  attempts: number;
  leaseUntil: Date | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
  nextRetryAt?: Date | null;
}

export type ControlTowerAIEpisodeView = Omit<
  ControlTowerAIEpisodeDoc,
  "createdAt" | "updatedAt" | "completedAt" | "leaseUntil" | "nextRetryAt"
> & {
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type ControlTowerView = {
  generatedAt: string;
  heartbeat: {
    status: "RUNNING" | "PAUSED";
    lastTickAt: string | null;
    tickIntervalMs: number;
    totalBurnEvents: number;
    openPOs: number;
  };
  ai: {
    configured: boolean;
    model: string;
    episode: ControlTowerAIEpisodeView | null;
  };
  agents: ControlTowerAgentView[];
  events: TwinEventView[];
};
