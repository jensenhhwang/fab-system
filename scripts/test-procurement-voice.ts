import assert from "node:assert/strict";
import { allowedNumberSet, voiceNumbersSafe, buildVoiceMessages, type ProcurementVoiceFacts } from "../src/lib/procurement-voice";

const facts: ProcurementVoiceFacts = {
  materialName: "EMC (에폭시 몰딩 컴파운드)",
  materialCode: "PKG-001",
  verdict: "WOULD_PROPOSE",
  verdictText: "자동모드였다면 → 14,523.6kg 발주 제안했을 것 (단일 승인 공급사 — 자동입고 제한: 사람 승인 필요).",
};

const allowed = allowedNumberSet(facts);
// 콤마 제거 정규화 확인
assert.ok(allowed.has("14523.6"), "판정 문장의 발주량이 허용 집합에 있음");
assert.ok(allowed.has("001"), "자재 코드 숫자도 허용");

// ── 안전: 원문 숫자만 쓴 각색 → 통과 ──
assert.equal(voiceNumbersSafe("EMC 14,523.6kg는 단일 공급사라 제 승인이 필요합니다.", allowed), true, "허용 숫자만 → safe");
assert.equal(voiceNumbersSafe("EMC는 자동입고가 막혀 있어 제가 직접 봐야 합니다.", allowed), true, "숫자 없음 → safe");

// ── 위험: 엔진에 없는 숫자를 지어냄 → 차단 ──
assert.equal(voiceNumbersSafe("EMC 14,523.6kg를 리드타임 21일 안에 발주하겠습니다.", allowed), false, "리드타임 21일은 없는 숫자 → unsafe");
assert.equal(voiceNumbersSafe("EMC 20,000kg 지금 바로 발주합니다.", allowed), false, "20,000은 엔진이 안 낸 발주량 → unsafe");

// 메시지 구조
const msgs = buildVoiceMessages(facts);
assert.equal(msgs.length, 2);
assert.equal(msgs[0].role, "system");
assert.ok(msgs[0].content.includes("김구매"), "페르소나 명시");
assert.ok(msgs[0].content.includes("숫자"), "숫자 조작 금지 규칙 포함");
assert.ok(msgs[1].content.includes("14,523.6"), "엔진 판정 문장이 유저 메시지에 포함");

console.log("✅ procurement-voice 숫자 안전 가드 통과");
