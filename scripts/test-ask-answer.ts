import assert from "node:assert/strict";
import type { ControlTowerEvidenceFact } from "../src/lib/control-tower-live";
import { buildAskAnswer } from "../src/lib/control-tower-ask-answer";

// facts에서 답을 조립한다. 핵심 불변식 — facts에 없는 ref는 절대 내보내지 않고,
// 근거가 없으면 지어내지 않고 INSUFFICIENT_EVIDENCE로 떨어진다.
const fact = (over: Partial<ControlTowerEvidenceFact>): ControlTowerEvidenceFact => ({
  ref: "MATERIALS:CHM-002", role: "MATERIALS", label: "과산화수소", value: "DOH 2.0일", state: "CRITICAL", ...over,
});

// ── 근거가 없으면 답하지 않는다 ──
{
  const a = buildAskAnswer({ role: "MATERIALS", intent: { kind: "TOP_PRIORITY" }, facts: [], ruleText: null });
  assert.equal(a.status, "INSUFFICIENT_EVIDENCE");
  assert.deepEqual(a.evidenceRefs, []);
  assert.equal(a.actionSuggestion, null);
  assert.equal(a.advisoryOnly, true);
}

// ── 못 알아들으면 예시로 안내한다 ──
{
  const a = buildAskAnswer({ role: "LOGISTICS", intent: { kind: "UNKNOWN" }, facts: [fact({ role: "LOGISTICS", ref: "LOGISTICS:OPEN_PO" })], ruleText: null });
  assert.equal(a.status, "INSUFFICIENT_EVIDENCE");
  assert.ok(a.recommendation.length > 0, "답할 수 있는 질문 예시를 준다");
  assert.deepEqual(a.evidenceRefs, [], "모르면 근거를 붙이지 않는다");
}

// ── 담당 밖이면 다른 담당자를 가리킨다 ──
{
  const a = buildAskAnswer({ role: "PRODUCTION", intent: { kind: "OUT_OF_SCOPE", suggestedRole: "LOGISTICS" }, facts: [], ruleText: null });
  assert.equal(a.status, "OUT_OF_SCOPE");
  assert.equal(a.suggestedRole, "LOGISTICS");
}

// ── CRITICAL 우선, evidenceRefs는 실제 존재하는 ref만 ──
{
  const facts = [
    fact({ ref: "MATERIALS:GAS-001", label: "질소", value: "DOH 0일", state: "CRITICAL" }),
    fact({ ref: "MATERIALS:CHM-013", label: "세정액", value: "DOH 9.5일", state: "NORMAL" }),
  ];
  const a = buildAskAnswer({ role: "MATERIALS", intent: { kind: "TOP_PRIORITY" }, facts, ruleText: null });
  assert.equal(a.status, "ANSWERED");
  assert.ok(a.evidenceRefs.includes("MATERIALS:GAS-001"), "CRITICAL 자재를 근거로 든다");
  for (const ref of a.evidenceRefs) assert.ok(facts.some((f) => f.ref === ref), `${ref}는 실제 fact여야 한다`);
  assert.ok(a.answer.includes("질소"), "facts의 label을 쓴다");
}

// ── evidenceRefs 상한 4개 (기존 스키마 제약) ──
{
  const many = Array.from({ length: 9 }, (_, i) =>
    fact({ ref: `MATERIALS:M-${i}`, label: `자재${i}`, state: "CRITICAL" }));
  const a = buildAskAnswer({ role: "MATERIALS", intent: { kind: "TOP_PRIORITY" }, facts: many, ruleText: null });
  assert.ok(a.evidenceRefs.length <= 4, "근거는 4개를 넘지 않는다");
}

// ── 특정 자재 질문: 있으면 답하고, 없으면 지어내지 않는다 ──
{
  const facts = [fact({ ref: "MATERIALS:CHM-002" })];
  const hit = buildAskAnswer({ role: "MATERIALS", intent: { kind: "MATERIAL", code: "CHM-002" }, facts, ruleText: null });
  assert.equal(hit.status, "ANSWERED");
  assert.deepEqual(hit.evidenceRefs, ["MATERIALS:CHM-002"]);

  const miss = buildAskAnswer({ role: "MATERIALS", intent: { kind: "MATERIAL", code: "GAS-999" }, facts, ruleText: null });
  assert.equal(miss.status, "INSUFFICIENT_EVIDENCE", "모르는 자재는 지어내지 않는다");
  assert.deepEqual(miss.evidenceRefs, []);
}

// ── 행동 제안 게이트 ──
{
  // 자재를 다루는 역할 + CRITICAL이면 제안한다
  const ok = buildAskAnswer({ role: "MATERIALS", intent: { kind: "MATERIAL", code: "CHM-002" }, facts: [fact({})], ruleText: null });
  assert.equal(ok.actionSuggestion?.actionType, "CREATE_INBOUND_PLAN_DRAFT");
  assert.equal(ok.actionSuggestion?.targetRef, "MATERIALS:CHM-002");
  assert.ok(ok.evidenceRefs.includes(ok.actionSuggestion!.targetRef), "targetRef는 근거에 포함돼야 한다");

  // CRITICAL이 아니면 제안하지 않는다
  const normal = buildAskAnswer({ role: "MATERIALS", intent: { kind: "MATERIAL", code: "CHM-002" }, facts: [fact({ state: "NORMAL" })], ruleText: null });
  assert.equal(normal.actionSuggestion, null);

  // 담당 역할이 아니면 제안하지 않는다
  const wrongRole = buildAskAnswer({
    role: "LOGISTICS", intent: { kind: "CAPACITY" },
    facts: [fact({ role: "LOGISTICS", ref: "LOGISTICS:WH:MWH-01", label: "MWH-01", value: "점유 79%", state: "CRITICAL" })],
    ruleText: null,
  });
  assert.equal(wrongRole.actionSuggestion, null, "박물류는 입고계획 초안을 제안하지 않는다");
}

// ── 규칙 질문 ──
{
  const a = buildAskAnswer({
    role: "PROCUREMENT", intent: { kind: "RULE" },
    facts: [fact({ role: "PROCUREMENT", ref: "PROCUREMENT:RULE:LEAD_TIME", label: "리드타임 규칙", value: "승인 주공급사 기준", state: "NORMAL" })],
    ruleText: "승인 주공급사 리드타임을 기준으로 발주한다",
  });
  assert.equal(a.status, "ANSWERED");
  assert.ok(a.evidenceRefs.includes("PROCUREMENT:RULE:LEAD_TIME"));
}

console.log("✅ ask answer passed");
