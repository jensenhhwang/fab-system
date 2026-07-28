// 관제탑 라이브 피드(MVP-1) — 살아있는 Twin이 4개 에이전트를 깨우고, 심박·소모·판단을
// 실시간으로 보여주는 읽기 전용 대시보드의 순수 타입/메타. (DB 접근 없음)
//
// 정직성 원칙(엑스 설계): 4개를 동등한 척 위장하지 않는다. 지금 실제 판단 로직이 있는 건
// PROCUREMENT(김구매) 하나뿐이고, 나머지 셋은 자기 도메인 신호를 "관측만" 한다.
//
// 페르소나 4명은 병렬로 구축 중인 에이전트 회의(agent-meeting) 레이어와 동일한 캐스트다.
// 미커밋 파일에 의존하지 않도록 여기 자체 정의하되, 이름·팀·색을 일치시킨다.

export type ControlTowerRole = "PROCUREMENT" | "MATERIALS" | "PRODUCTION" | "LOGISTICS";
export type AgentConsciousness = "ACTIVE" | "OBSERVING";

export const CONTROL_TOWER_PERSONAS: Record<
  ControlTowerRole,
  { name: string; team: string; color: string; remit: string; consciousness: AgentConsciousness; roadmapNote?: string }
> = {
  PROCUREMENT: {
    name: "김구매", team: "구매본부", color: "#EA002C",
    remit: "공급 안정성·리드타임·발주 판단",
    consciousness: "ACTIVE",
  },
  MATERIALS: {
    name: "이자재", team: "자재관리팀", color: "#0078D4",
    remit: "재고 정확도·보관일수·자재 가용성",
    consciousness: "OBSERVING", roadmapNote: "판단 로직 준비 중 · 지금은 재고 신호만 관측",
  },
  PRODUCTION: {
    name: "최생산", team: "생산관리팀", color: "#00A86B",
    remit: "생산계획·공정 영향·작업지시",
    consciousness: "OBSERVING", roadmapNote: "판단 로직 준비 중 · 지금은 생산 신호만 관측",
  },
  LOGISTICS: {
    name: "박물류", team: "물류/인프라팀", color: "#F59E0B",
    remit: "입고 일정·창고 용량·이동 실행",
    consciousness: "OBSERVING", roadmapNote: "판단 로직 준비 중 · 지금은 입고 신호만 관측",
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
  roadmapNote?: string;
  watching: AgentWatchMetric[];
  judgment: ProcurementJudgmentView | null; // ACTIVE(PROCUREMENT)만 채워짐
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
  agents: ControlTowerAgentView[];
  events: TwinEventView[];
};
