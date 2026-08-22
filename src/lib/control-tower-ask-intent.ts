import type { ControlTowerRole } from "@/lib/control-tower-live";

// 자유 문장을 담당자별 의도로 매핑하는 순수 함수.
//
// 왜 필요했나 — "담당자에게 묻기"가 질문마다 OpenAI를 호출했다. 그런데 그 AI는 새 정보를
// 만들지 않는다: 프롬프트가 "고정된 Snapshot의 facts와 rule만 근거로 쓰고 없는 수치를 만들지
// 말라"고 못박고 있어서, 판단·수치·상태는 전부 서버가 결정론적으로 계산해 넘긴 값이다.
// AI가 하던 일은 (1) 자유 문장 해석과 (2) 문장 엮기 둘뿐이다. 이 파일이 (1)을 대신한다.
//
// 못 알아들으면 UNKNOWN으로 떨어뜨린다 — 지어내지 않는 것이 이 방식의 핵심 이점이다.

export type AskIntent =
  | { kind: "TOP_PRIORITY" }
  | { kind: "WHY_BLOCKED" }
  | { kind: "MATERIAL"; code: string }
  | { kind: "RULE" }
  | { kind: "CAPACITY" }
  | { kind: "OPEN_ORDERS" }
  | { kind: "OUT_OF_SCOPE"; suggestedRole: ControlTowerRole }
  | { kind: "UNKNOWN" };

/** 자재 코드 표기 — CHM-002, GAS-001, PKG-LBD-001 처럼 접두 3글자 + 하이픈 구간. */
const MATERIAL_CODE = /\b([A-Z]{3}(?:-[A-Z0-9]+)+)\b/;

type Topic = "TOP_PRIORITY" | "WHY_BLOCKED" | "RULE" | "CAPACITY" | "OPEN_ORDERS";

// 주제별 키워드. 한 문장에 여러 주제가 걸리면 아래 ORDER의 앞선 것이 이긴다.
const KEYWORDS: Record<Topic, string[]> = {
  WHY_BLOCKED: ["왜 멈", "왜멈", "멈췄", "멈춘", "정지", "중단", "블록", "차단", "안 돌", "안돌"],
  CAPACITY: ["창고", "점유", "적재", "포화", "용량", "capacity"],
  OPEN_ORDERS: ["미착", "미도착", "발주 현황", "오는 중", "입고 예정", "언제 와", "언제와", "도착"],
  RULE: ["규칙", "기준", "리드타임", "정책", "rule"],
  TOP_PRIORITY: ["급한", "우선", "먼저", "가장", "제일", "위험", "critical", "wip", "상태"],
};

// 구체적인 주제를 먼저 본다 — "창고 점유율이 가장 높은 곳"은 CAPACITY이지 TOP_PRIORITY가 아니다.
const ORDER: Topic[] = ["WHY_BLOCKED", "CAPACITY", "OPEN_ORDERS", "RULE", "TOP_PRIORITY"];

/** 각 담당자가 실제로 답할 수 있는 주제. snapshot이 그 역할로 계산하는 facts가 정한다. */
const ROLE_TOPICS: Record<ControlTowerRole, Topic[]> = {
  PROCUREMENT: ["TOP_PRIORITY", "RULE", "OPEN_ORDERS"],
  MATERIALS: ["TOP_PRIORITY", "WHY_BLOCKED"],
  PRODUCTION: ["TOP_PRIORITY", "WHY_BLOCKED"],
  LOGISTICS: ["CAPACITY", "OPEN_ORDERS"],
};

/** 그 주제를 맡는 담당자 — 담당 밖 질문을 넘겨줄 곳. */
const TOPIC_OWNER: Record<Topic, ControlTowerRole> = {
  TOP_PRIORITY: "MATERIALS",
  WHY_BLOCKED: "PRODUCTION",
  RULE: "PROCUREMENT",
  CAPACITY: "LOGISTICS",
  OPEN_ORDERS: "LOGISTICS",
};

export function matchAskIntent(role: ControlTowerRole, question: string): AskIntent {
  const text = question.trim().toUpperCase();
  if (!text) return { kind: "UNKNOWN" };

  // 자재 코드가 박혀 있으면 그게 가장 구체적인 질문이다. 자재를 다루는 역할에서만 받는다.
  const code = MATERIAL_CODE.exec(text)?.[1];
  if (code) {
    if (role === "MATERIALS" || role === "PROCUREMENT") return { kind: "MATERIAL", code };
    return { kind: "OUT_OF_SCOPE", suggestedRole: "MATERIALS" };
  }

  const lower = question.trim().toLowerCase();
  const hit = ORDER.find((topic) => KEYWORDS[topic].some((kw) => lower.includes(kw)));
  if (!hit) return { kind: "UNKNOWN" };

  if (!ROLE_TOPICS[role].includes(hit)) {
    return { kind: "OUT_OF_SCOPE", suggestedRole: TOPIC_OWNER[hit] };
  }
  return { kind: hit } as AskIntent;
}

/** 그 담당자가 답할 수 있는 질문 예시 — 못 알아들었을 때 지어내는 대신 안내한다. */
export const ASK_EXAMPLES: Record<ControlTowerRole, string[]> = {
  PROCUREMENT: ["지금 가장 먼저 발주를 검토할 자재는?", "어떤 조달 규칙이 적용됐어?", "CHM-002 발주 상태는?"],
  MATERIALS: ["지금 가장 급한 자재는?", "CHM-002 재고 상태 어때?", "왜 자재가 부족해?"],
  PRODUCTION: ["라인이 왜 멈췄어?", "지금 WIP 상태는?"],
  LOGISTICS: ["창고 점유율 어때?", "미착 발주 얼마나 있어?"],
};
