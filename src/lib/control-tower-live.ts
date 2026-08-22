// 관제탑 라이브 피드(MVP-1) — 살아있는 Twin이 4개 에이전트를 깨우고, 심박·소모·판단을
// 실시간으로 보여주는 읽기 전용 대시보드의 순수 타입/메타. (DB 접근 없음)
//
// 정직성 원칙: 네 역할 모두 각자의 규칙 엔진(procurement/materials/production/logistics-agent.ts)이
// 계산한 판정을 근거로 LLM이 공개 판단을 만든다(RULE_LLM).
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
    consciousness: "ACTIVE", judgmentMode: "RULE_LLM",
  },
  PRODUCTION: {
    name: "최생산", team: "생산관리팀", color: "#00A86B",
    remit: "생산계획·공정 영향·작업지시",
    consciousness: "ACTIVE", judgmentMode: "RULE_LLM",
  },
  LOGISTICS: {
    name: "박물류", team: "물류/인프라팀", color: "#F59E0B",
    remit: "입고 일정·창고 용량·이동 실행",
    consciousness: "ACTIVE", judgmentMode: "RULE_LLM",
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

// 4역할 공용 규칙엔진 판정 뷰 — voice는 LLM 각색(숫자는 verdictText 그대로), 없으면 verdictText를 그대로 보여준다.
export type RoleJudgmentView = {
  scenarioLabel: string;
  top: {
    code: string;
    name: string;
    verdict: string;
    verdictText: string;
    voice: string;
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
  judgment: RoleJudgmentView | null; // 역할별 규칙 엔진의 현재 판정
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
      pendingApproval: number;
      urgent: number;
      inboundHeld: number;
      topVerdict: string | null;
      topVerdictText: string | null;
    };
    materialsRule: {
      scenarioLabel: string;
      critical: number;
      watch: number;
      dataGap: number;
      topVerdict: string | null;
      topVerdictText: string | null;
    };
    productionRule: {
      scenarioLabel: string;
      materialBlocked: number;
      hold: number;
      topVerdict: string | null;
      topVerdictText: string | null;
    };
    logisticsRule: {
      scenarioLabel: string;
      over: number;
      watch: number;
      openPOs: number;
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
    pendingApprovalPOs: number;
    urgentApprovalPOs: number;
    inboundHoldPOs: number;
    materialBlockedLots: number;
  };
  ai: {
    configured: boolean;
    enabled: boolean;
    model: string;
    episode: ControlTowerAIEpisodeView | null;
  };
  agents: ControlTowerAgentView[];
  events: TwinEventView[];
};
