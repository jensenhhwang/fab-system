import "server-only";

import { createHash } from "crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  CONTROL_TOWER_PERSONAS,
  type ControlTowerAIConclusion,
  type ControlTowerAIJudgment,
  type ControlTowerAIReply,
  type ControlTowerAIUsage,
  type ControlTowerJudgmentMode,
  type ControlTowerRole,
} from "@/lib/control-tower-live";
import type { ControlTowerAISnapshot } from "@/lib/control-tower-snapshot-server";
import {
  ControlTowerAIBudgetError,
  runBudgetedControlTowerCall,
} from "@/lib/control-tower-ai-budget-server";

export const CONTROL_TOWER_AI_MODEL =
  process.env.OPENAI_CONTROL_TOWER_MODEL?.trim() || "gpt-5.6-luna";
export const CONTROL_TOWER_AI_PROMPT_VERSION = "CONTROL_TOWER_PUBLIC_V2";

const JUDGMENT_MAX_OUTPUT_TOKENS = 650;
const REPLY_MAX_OUTPUT_TOKENS = 450;
const CONCLUSION_MAX_OUTPUT_TOKENS = 750;

const NoDigits = z.string().regex(/^[^0-9]*$/);

const JudgmentSchema = z.object({
  verdict: z.enum(["OBSERVE", "CHECK", "ESCALATE", "HOLD"]),
  severity: z.enum(["NORMAL", "ATTENTION", "CRITICAL"]),
  summary: NoDigits.max(120),
  proposedDecision: NoDigits.max(160),
  evidenceRefs: z.array(z.string().max(40)).min(1).max(3),
  assumptions: z.array(NoDigits.max(120)).max(2),
  questionForRole: z.enum(["PROCUREMENT", "MATERIALS", "PRODUCTION", "LOGISTICS"]).nullable(),
  question: NoDigits.max(140).nullable(),
});

const ReplySchema = z.object({
  stance: z.enum(["AGREE", "QUALIFY", "DISAGREE"]),
  message: NoDigits.max(140),
  revisedDecision: NoDigits.max(160),
  evidenceRefs: z.array(z.string().max(40)).min(1).max(3),
});

const ConclusionSchema = z.object({
  alignment: z.enum(["ALIGNED", "CONDITIONAL", "DISAGREEMENT"]),
  summary: NoDigits.max(220),
  decisions: z.array(NoDigits.max(160)).max(3),
  openIssues: z.array(NoDigits.max(160)).max(3),
  evidenceRefs: z.array(z.string().max(40)).min(1).max(6),
  advisoryOnly: z.literal(true),
});

const BASE_INSTRUCTIONS = `당신은 반도체 Fab 관제탑의 운영 담당자입니다.
고정 Snapshot의 공개 근거만 사용해 담당 영역의 판단과 권고를 작성하세요.
내부 사고과정은 쓰지 말고 화면과 감사기록에 남겨도 되는 결론, 근거, 가정, 질문만 작성하세요.
숫자는 evidence 카드가 별도로 표시하므로 문장에 숫자를 쓰지 마세요.
운영 데이터를 직접 변경하거나 실행했다고 말하지 마세요. 모든 결과는 읽기 전용 검토 의견입니다.
근거가 부족하면 추측하지 말고 HOLD 또는 CHECK를 선택하세요.
한국어로 짧고 자연스럽게 작성하세요.`;

export class ControlTowerOpenAIError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ControlTowerOpenAIError";
  }
}

function openaiClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new ControlTowerOpenAIError(
      "OPENAI_API_KEY_MISSING",
      "OpenAI API 키가 서버에 설정되지 않았습니다.",
    );
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    logLevel: "error",
    maxRetries: 0,
  });
}

function safetyIdentifier() {
  return createHash("sha256").update("fab-control-tower-live").digest("hex").slice(0, 64);
}

function usageOf(response: {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    output_tokens_details?: { reasoning_tokens?: number };
  } | null;
}): ControlTowerAIUsage {
  return {
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
  };
}

function normalizeError(error: unknown) {
  if (error instanceof ControlTowerOpenAIError) return error;
  if (error instanceof ControlTowerAIBudgetError) {
    return new ControlTowerOpenAIError(error.code, error.message);
  }
  if (error instanceof OpenAI.APIError) {
    if (error.code === "insufficient_quota") {
      return new ControlTowerOpenAIError(
        "OPENAI_INSUFFICIENT_QUOTA",
        "OpenAI API 크레딧 또는 결제 한도가 없어 자동 판단을 생성하지 못했습니다.",
      );
    }
    if (error.status === 401 || error.status === 403) {
      return new ControlTowerOpenAIError(
        "OPENAI_AUTH_FAILED",
        "OpenAI API 키 인증에 실패했습니다.",
      );
    }
    if (error.status === 429) {
      return new ControlTowerOpenAIError(
        "OPENAI_RATE_LIMIT",
        "OpenAI API 요청 한도에 도달했습니다.",
      );
    }
    return new ControlTowerOpenAIError(
      "OPENAI_API_ERROR",
      `OpenAI API 호출에 실패했습니다${error.status ? ` (${error.status})` : ""}.`,
    );
  }
  return new ControlTowerOpenAIError(
    "OPENAI_RESPONSE_INVALID",
    error instanceof Error ? error.message : "OpenAI 응답을 처리하지 못했습니다.",
  );
}

function validateEvidenceRefs(refs: string[], allowedRefs: Set<string>) {
  const valid = [...new Set(refs.filter((ref) => allowedRefs.has(ref)))];
  if (valid.length === 0) {
    throw new ControlTowerOpenAIError(
      "OPENAI_EVIDENCE_INVALID",
      "모델 판단에 유효한 운영 근거가 포함되지 않았습니다.",
    );
  }
  return valid;
}

function ruleForRole(snapshot: ControlTowerAISnapshot, role: ControlTowerRole) {
  if (role === "PROCUREMENT") return snapshot.procurementRule;
  if (role === "MATERIALS") return snapshot.materialsRule;
  if (role === "PRODUCTION") return snapshot.productionRule;
  return snapshot.logisticsRule;
}

function publicJudgments(judgments: ControlTowerAIJudgment[]) {
  return judgments.map((judgment) => ({
    role: judgment.role,
    verdict: judgment.verdict,
    severity: judgment.severity,
    summary: judgment.summary,
    proposedDecision: judgment.proposedDecision,
    evidenceRefs: judgment.evidenceRefs,
    assumptions: judgment.assumptions,
    questionForRole: judgment.questionForRole,
    question: judgment.question,
  }));
}

export async function generateControlTowerJudgment(input: {
  snapshot: ControlTowerAISnapshot;
  role: ControlTowerRole;
  mode: ControlTowerJudgmentMode;
}): Promise<ControlTowerAIJudgment> {
  const persona = CONTROL_TOWER_PERSONAS[input.role];
  const facts = input.snapshot.facts.filter((fact) => fact.role === input.role);
  const allowedRefs = new Set(facts.map((fact) => fact.ref));
  const startedAt = Date.now();
  try {
    const instructions = `${BASE_INSTRUCTIONS}
당신은 ${persona.team}의 ${persona.name}이며 책임 범위는 ${persona.remit}입니다.
판단 방식은 ${input.mode === "RULE_LLM"
  ? "RULE_LLM입니다. 제공된 규칙 엔진 판정은 바꾸지 말고 설명과 확인 질문만 보완하세요."
  : "LLM_ONLY입니다. 규칙 엔진이 아직 없음을 전제로 가정을 명시하고 보수적으로 판단하세요."}
질문이 필요하면 다른 담당자 한 명에게만 질문하고, 아니면 questionForRole과 question을 null로 반환하세요.`;
    const inputText = JSON.stringify({
      capturedAt: input.snapshot.capturedAt,
      facts,
      rule: input.mode === "RULE_LLM" ? ruleForRole(input.snapshot, input.role) : null,
    });
    const response = await runBudgetedControlTowerCall({
      kind: "JUDGMENT",
      model: CONTROL_TOWER_AI_MODEL,
      promptChars: instructions.length + inputText.length,
      maxOutputTokens: JUDGMENT_MAX_OUTPUT_TOKENS,
      call: () => openaiClient().responses.parse({
        model: CONTROL_TOWER_AI_MODEL,
        service_tier: "default",
        store: false,
        safety_identifier: safetyIdentifier(),
        prompt_cache_key: `control-tower:${CONTROL_TOWER_AI_PROMPT_VERSION}:${input.role}`,
        reasoning: { effort: "low" },
        max_output_tokens: JUDGMENT_MAX_OUTPUT_TOKENS,
        instructions,
        input: inputText,
        text: {
          verbosity: "low",
          format: zodTextFormat(JudgmentSchema, "control_tower_judgment"),
        },
      }),
    });
    const parsed = response.output_parsed;
    if (!parsed) {
      throw new ControlTowerOpenAIError(
        "OPENAI_STRUCTURED_OUTPUT_EMPTY",
        `${persona.name}의 구조화된 판단이 비어 있습니다.`,
      );
    }
    if (
      (parsed.questionForRole === null) !== (parsed.question === null)
      || parsed.questionForRole === input.role
    ) {
      throw new ControlTowerOpenAIError(
        "OPENAI_QUESTION_INVALID",
        `${persona.name}의 질문 대상이 올바르지 않습니다.`,
      );
    }
    return {
      role: input.role,
      mode: input.mode,
      ...parsed,
      evidenceRefs: validateEvidenceRefs(parsed.evidenceRefs, allowedRefs),
      usage: usageOf(response),
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function generateControlTowerReply(input: {
  snapshot: ControlTowerAISnapshot;
  judgments: ControlTowerAIJudgment[];
  speakerRole: ControlTowerRole;
  replyToRole: ControlTowerRole;
  question: string;
}): Promise<ControlTowerAIReply> {
  const persona = CONTROL_TOWER_PERSONAS[input.speakerRole];
  const allowedRefs = new Set(input.snapshot.facts.map((fact) => fact.ref));
  const startedAt = Date.now();
  try {
    const instructions = `${BASE_INSTRUCTIONS}
당신은 ${persona.name}입니다. ${CONTROL_TOWER_PERSONAS[input.replyToRole].name}의 공개 질문에 담당 영역 근거로 답하세요.
다른 담당자의 판단을 그대로 반복하지 말고 동의, 조건부 보완, 이견 중 하나를 분명히 하세요.`;
    const inputText = JSON.stringify({
      capturedAt: input.snapshot.capturedAt,
      yourFacts: input.snapshot.facts.filter((fact) => fact.role === input.speakerRole),
      publicJudgments: publicJudgments(input.judgments),
      questionFrom: input.replyToRole,
      question: input.question,
    });
    const response = await runBudgetedControlTowerCall({
      kind: "REPLY",
      model: CONTROL_TOWER_AI_MODEL,
      promptChars: instructions.length + inputText.length,
      maxOutputTokens: REPLY_MAX_OUTPUT_TOKENS,
      call: () => openaiClient().responses.parse({
        model: CONTROL_TOWER_AI_MODEL,
        service_tier: "default",
        store: false,
        safety_identifier: safetyIdentifier(),
        prompt_cache_key: `control-tower:${CONTROL_TOWER_AI_PROMPT_VERSION}:reply`,
        reasoning: { effort: "low" },
        max_output_tokens: REPLY_MAX_OUTPUT_TOKENS,
        instructions,
        input: inputText,
        text: {
          verbosity: "low",
          format: zodTextFormat(ReplySchema, "control_tower_reply"),
        },
      }),
    });
    const parsed = response.output_parsed;
    if (!parsed) {
      throw new ControlTowerOpenAIError(
        "OPENAI_STRUCTURED_OUTPUT_EMPTY",
        `${persona.name}의 공개 답변이 비어 있습니다.`,
      );
    }
    return {
      speakerRole: input.speakerRole,
      replyToRole: input.replyToRole,
      ...parsed,
      evidenceRefs: validateEvidenceRefs(parsed.evidenceRefs, allowedRefs),
      usage: usageOf(response),
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function generateControlTowerConclusion(input: {
  snapshot: ControlTowerAISnapshot;
  judgments: ControlTowerAIJudgment[];
  replies: ControlTowerAIReply[];
}): Promise<ControlTowerAIConclusion> {
  const allowedRefs = new Set(input.snapshot.facts.map((fact) => fact.ref));
  const startedAt = Date.now();
  try {
    const instructions = `${BASE_INSTRUCTIONS}
당신은 읽기 전용 관제탑 조정자입니다. 네 담당자의 공개 판단과 답변만 종합하세요.
합의를 강요하지 말고 이견과 데이터 부족을 openIssues에 남기세요.
운영 실행을 승인하거나 수행하지 말고 advisoryOnly는 반드시 true로 반환하세요.
evidenceRefs에는 스냅샷 근거 카드의 짧은 ref 코드만 나열하세요(예: MATERIALS:CHM-002). 문장·요약·설명을 evidenceRefs에 쓰지 마세요.`;
    const inputText = JSON.stringify({
      capturedAt: input.snapshot.capturedAt,
      publicJudgments: publicJudgments(input.judgments),
      publicReplies: input.replies.map((reply) => ({
        speakerRole: reply.speakerRole,
        replyToRole: reply.replyToRole,
        stance: reply.stance,
        message: reply.message,
        revisedDecision: reply.revisedDecision,
        evidenceRefs: reply.evidenceRefs,
      })),
    });
    const response = await runBudgetedControlTowerCall({
      kind: "CONCLUSION",
      model: CONTROL_TOWER_AI_MODEL,
      promptChars: instructions.length + inputText.length,
      maxOutputTokens: CONCLUSION_MAX_OUTPUT_TOKENS,
      call: () => openaiClient().responses.parse({
        model: CONTROL_TOWER_AI_MODEL,
        service_tier: "default",
        store: false,
        safety_identifier: safetyIdentifier(),
        prompt_cache_key: `control-tower:${CONTROL_TOWER_AI_PROMPT_VERSION}:conclusion`,
        reasoning: { effort: "low" },
        max_output_tokens: CONCLUSION_MAX_OUTPUT_TOKENS,
        instructions,
        input: inputText,
        text: {
          verbosity: "low",
          format: zodTextFormat(ConclusionSchema, "control_tower_conclusion"),
        },
      }),
    });
    const parsed = response.output_parsed;
    if (!parsed) {
      throw new ControlTowerOpenAIError(
        "OPENAI_STRUCTURED_OUTPUT_EMPTY",
        "관제탑 종합 의견이 비어 있습니다.",
      );
    }
    return {
      ...parsed,
      evidenceRefs: validateEvidenceRefs(parsed.evidenceRefs, allowedRefs),
      advisoryOnly: true,
      usage: usageOf(response),
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    throw normalizeError(error);
  }
}
