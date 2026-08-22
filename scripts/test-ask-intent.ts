import assert from "node:assert/strict";
import { matchAskIntent } from "../src/lib/control-tower-ask-intent";

// 자유 문장을 담당자별 의도로 매핑한다. AI 없이 답하려면 이 매칭이 답할 수 있는 범위를 정한다.
// 못 알아들으면 지어내지 않고 UNKNOWN으로 떨어뜨린다.

// ── 김구매(PROCUREMENT) ──
assert.equal(matchAskIntent("PROCUREMENT", "지금 가장 먼저 발주를 검토할 자재가 뭐야?").kind, "TOP_PRIORITY");
assert.equal(matchAskIntent("PROCUREMENT", "어떤 규칙이 적용됐어?").kind, "RULE");
assert.equal(matchAskIntent("PROCUREMENT", "리드타임 규칙 알려줘").kind, "RULE");

// ── 이자재(MATERIALS) ──
assert.equal(matchAskIntent("MATERIALS", "지금 급한 자재 뭐야").kind, "TOP_PRIORITY");
{
  const i = matchAskIntent("MATERIALS", "CHM-002 상태 어때?");
  assert.equal(i.kind, "MATERIAL");
  assert.equal(i.kind === "MATERIAL" ? i.code : "", "CHM-002", "자재 코드를 질문에서 뽑는다");
}
{
  // 소문자·공백이 섞여도 정규화한다
  const i = matchAskIntent("MATERIALS", "gas-001 재고 얼마나 남았어");
  assert.equal(i.kind === "MATERIAL" ? i.code : "", "GAS-001");
}

// ── 최생산(PRODUCTION) ──
assert.equal(matchAskIntent("PRODUCTION", "라인이 왜 멈췄어?").kind, "WHY_BLOCKED");
assert.equal(matchAskIntent("PRODUCTION", "지금 WIP 어때").kind, "TOP_PRIORITY");

// ── 박물류(LOGISTICS) ──
assert.equal(matchAskIntent("LOGISTICS", "창고 점유율 어때?").kind, "CAPACITY");
assert.equal(matchAskIntent("LOGISTICS", "미착 발주 얼마나 있어").kind, "OPEN_ORDERS");

// ── 담당 밖이면 다른 담당자를 가리킨다 ──
{
  const i = matchAskIntent("PRODUCTION", "창고 점유율 어때?");
  assert.equal(i.kind, "OUT_OF_SCOPE");
  assert.equal(i.kind === "OUT_OF_SCOPE" ? i.suggestedRole : null, "LOGISTICS");
}
{
  const i = matchAskIntent("LOGISTICS", "라인이 왜 멈췄어?");
  assert.equal(i.kind === "OUT_OF_SCOPE" ? i.suggestedRole : null, "PRODUCTION");
}

// ── 못 알아들으면 UNKNOWN ──
assert.equal(matchAskIntent("PROCUREMENT", "오늘 점심 뭐 먹지").kind, "UNKNOWN");
assert.equal(matchAskIntent("MATERIALS", "").kind, "UNKNOWN");

console.log("✅ ask intent passed");
