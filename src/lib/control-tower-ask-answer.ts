import type { ControlTowerEvidenceFact, ControlTowerRole } from "@/lib/control-tower-live";
import { CONTROL_TOWER_PERSONAS } from "@/lib/control-tower-live";
import { ASK_EXAMPLES, type AskIntent } from "@/lib/control-tower-ask-intent";

// facts에서 답변을 조립하는 순수 함수.
//
// AI가 하던 "문장 엮기"를 대신한다. 판단·수치·상태는 이미 서버가 계산해 facts로 넘긴 값이고,
// 여기서는 그것을 고르고 문장으로 만들 뿐이다 — 새 수치를 만들지 않는다.
//
// 불변식 두 개:
//   ① evidenceRefs는 넘어온 facts에 실제로 존재하는 ref만 담는다(기존 상한 4개).
//   ② 근거가 없으면 지어내지 않고 INSUFFICIENT_EVIDENCE로 떨어진다.

const MAX_EVIDENCE = 4;

/** 기존 AskAnswerSchema와 같은 모양 — 화면·저장 형식을 바꾸지 않는다. */
export type DeterministicAskAnswer = {
  status: "ANSWERED" | "INSUFFICIENT_EVIDENCE" | "OUT_OF_SCOPE";
  answer: string;
  recommendation: string;
  assumptions: string[];
  evidenceRefs: string[];
  suggestedRole: ControlTowerRole | null;
  actionSuggestion: { actionType: "CREATE_INBOUND_PLAN_DRAFT"; targetRef: string; reason: string } | null;
  advisoryOnly: true;
};

const SEVERITY = { CRITICAL: 0, ATTENTION: 1, NORMAL: 2 } as const;

function bySeverity(a: ControlTowerEvidenceFact, b: ControlTowerEvidenceFact) {
  return SEVERITY[a.state] - SEVERITY[b.state];
}

function base(role: ControlTowerRole): DeterministicAskAnswer {
  return {
    status: "INSUFFICIENT_EVIDENCE",
    answer: `${CONTROL_TOWER_PERSONAS[role].name}가 지금 근거로 확인할 수 있는 값이 없습니다.`,
    recommendation: "",
    assumptions: [],
    evidenceRefs: [],
    suggestedRole: null,
    actionSuggestion: null,
    advisoryOnly: true,
  };
}

/** 자재 ref만 입고계획 초안 대상이다(기존 게이트와 동일). */
function inboundDraftTarget(role: ControlTowerRole, picked: ControlTowerEvidenceFact[]) {
  if (role !== "MATERIALS" && role !== "PROCUREMENT") return null;
  const target = picked.find((f) => /^MATERIALS:[^:]+$/.test(f.ref) && f.state === "CRITICAL");
  if (!target) return null;
  return {
    actionType: "CREATE_INBOUND_PLAN_DRAFT" as const,
    targetRef: target.ref,
    reason: `${target.label} 상태가 ${target.value}로 확인돼 입고계획 검토가 필요합니다.`,
  };
}

export function buildAskAnswer(input: {
  role: ControlTowerRole;
  intent: AskIntent;
  /** 이미 담당 역할로 필터된 facts */
  facts: ControlTowerEvidenceFact[];
  ruleText: string | null;
}): DeterministicAskAnswer {
  const { role, intent, facts, ruleText } = input;
  const persona = CONTROL_TOWER_PERSONAS[role];
  const result = base(role);

  if (intent.kind === "OUT_OF_SCOPE") {
    return {
      ...result,
      status: "OUT_OF_SCOPE",
      answer: `이 질문은 ${persona.name}의 담당 범위(${persona.remit}) 밖입니다.`,
      recommendation: `${CONTROL_TOWER_PERSONAS[intent.suggestedRole].name}에게 물어보세요.`,
      suggestedRole: intent.suggestedRole,
    };
  }

  if (intent.kind === "UNKNOWN") {
    // 지어내지 않는다 — 답할 수 있는 것을 알려준다.
    return {
      ...result,
      answer: `질문의 의도를 확인하지 못했습니다.`,
      recommendation: `이렇게 물어보세요 — ${ASK_EXAMPLES[role].join(" / ")}`,
    };
  }

  if (facts.length === 0) return result;

  // 의도별로 볼 facts를 좁힌다. 좁힌 결과가 비면 근거 없음으로 떨어진다.
  let picked: ControlTowerEvidenceFact[];
  let lead: string;

  if (intent.kind === "MATERIAL") {
    picked = facts.filter((f) => f.ref === `MATERIALS:${intent.code}`);
    lead = `${intent.code}`;
  } else if (intent.kind === "RULE") {
    picked = facts.filter((f) => f.ref.includes(":RULE:"));
    lead = "적용 중인 규칙";
  } else if (intent.kind === "CAPACITY") {
    picked = facts.filter((f) => f.ref.startsWith("LOGISTICS:WH:")).sort(bySeverity);
    lead = "창고 점유";
  } else if (intent.kind === "OPEN_ORDERS") {
    picked = facts.filter((f) => f.ref.includes("OPEN_PO")).sort(bySeverity);
    lead = "미착 발주";
  } else if (intent.kind === "WHY_BLOCKED") {
    picked = facts.filter((f) => f.state !== "NORMAL").sort(bySeverity);
    lead = "지금 라인을 막고 있는 것";
  } else {
    picked = [...facts].sort(bySeverity);
    lead = "지금 가장 주의할 것";
  }

  picked = picked.slice(0, MAX_EVIDENCE);
  if (picked.length === 0) {
    return {
      ...result,
      answer:
        intent.kind === "MATERIAL"
          ? `${intent.code}는 지금 ${persona.name}의 근거 카드에 없습니다.`
          : `${lead}에 해당하는 근거가 지금은 없습니다.`,
      recommendation: `이렇게 물어보세요 — ${ASK_EXAMPLES[role].join(" / ")}`,
    };
  }

  const detail = picked.map((f) => `${f.label} ${f.value}`).join(", ");
  const worst = picked[0];
  const answer =
    intent.kind === "RULE" && ruleText
      ? `${ruleText}. 근거: ${detail}.`
      : `${lead}은 ${detail} 입니다.`;

  return {
    ...result,
    status: "ANSWERED",
    answer,
    recommendation:
      worst.state === "CRITICAL"
        ? `${worst.label}부터 확인하세요.`
        : "지금 즉시 조치가 필요한 항목은 없습니다.",
    evidenceRefs: picked.map((f) => f.ref),
    actionSuggestion: inboundDraftTarget(role, picked),
  };
}
