// 김구매(PROCUREMENT) 목소리 — 결정론 엔진이 낸 판단을 페르소나 말투로 각색하는 순수 로직.
//
// 안전 원칙(패브 반복 강조): 숫자·판정은 100% 결정론 엔진에서 온다. LLM은 "말투·설명"만.
// LLM이 엔진에 없는 숫자를 지어내면 위험물 하드가드를 우회한 발화가 될 수 있으므로,
// 출력에 등장하는 모든 숫자가 입력(결정론 문장)의 숫자 집합 안에 있는지 검증하고,
// 하나라도 벗어나면 원문(verdictText)으로 폴백한다.

export type ProcurementVoiceFacts = {
  materialName: string;
  materialCode: string;
  verdict: string;
  verdictText: string; // 결정론 엔진이 만든 판정 문장(숫자 포함)
};

export const PROCUREMENT_VOICE_PROMPT_VERSION = "KIMGUMAE_VOICE_V1";

// 숫자 토큰 추출 후 콤마 제거 정규화.
function extractNumbers(text: string): string[] {
  const matches = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches.map((m) => m.replace(/,/g, ""));
}

// 입력에서 허용되는 숫자 집합 (판정 문장 + 자재명/코드).
export function allowedNumberSet(facts: ProcurementVoiceFacts): Set<string> {
  const src = `${facts.verdictText} ${facts.materialName} ${facts.materialCode}`;
  return new Set(extractNumbers(src));
}

// LLM 출력의 모든 숫자가 허용 집합 안에 있으면 true. 새 숫자를 지어내면 false → 폴백.
export function voiceNumbersSafe(voice: string, allowed: Set<string>): boolean {
  for (const n of extractNumbers(voice)) {
    if (!allowed.has(n)) return false;
  }
  return true;
}

export function buildVoiceMessages(facts: ProcurementVoiceFacts): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content:
        "당신은 SK하이닉스 이천 FAB 구매본부의 발주 담당 '김구매'입니다. " +
        "재고·리드타임 판단 엔진이 내린 결정을 팀 동료들에게 구어체로 짧게 전달하는 역할입니다.\n" +
        "규칙:\n" +
        "- 한국어 1문장, 40자~90자.\n" +
        "- 주어진 판정 문장의 숫자만 사용하세요. 새로운 숫자·수량·기간·날짜·퍼센트를 절대 만들지 마세요.\n" +
        "- 발주량이나 리드타임 같은 수치를 추측하지 마세요. 없는 정보는 말하지 마세요.\n" +
        "- 담당자다운 담백하고 실무적인 말투. 이모지·과장 금지.",
    },
    {
      role: "user",
      content:
        `자재: ${facts.materialName} (${facts.materialCode})\n` +
        `판정: ${facts.verdict}\n` +
        `엔진 판정 문장: ${facts.verdictText}\n\n` +
        "위 판정을 김구매의 목소리로 한 문장으로 전달하세요.",
    },
  ];
}
