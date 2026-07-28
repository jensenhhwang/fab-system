import "server-only";
import {
  allowedNumberSet,
  buildVoiceMessages,
  voiceNumbersSafe,
  PROCUREMENT_VOICE_PROMPT_VERSION,
  type ProcurementVoiceFacts,
} from "@/lib/procurement-voice";

export type ProcurementVoice = {
  text: string;
  source: "AI" | "FALLBACK" | "GUARD_FALLBACK";
  model: string | null;
  promptVersion: string;
};

// openai 패키지 없이 REST API 직접 호출 — 의존성/package.json 안 건드림.
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

// 같은 판정(자재+판정+숫자)에 대해선 LLM을 재호출하지 않는다(3초 폴링 대비).
const cache = new Map<string, ProcurementVoice>();
const CACHE_MAX = 200;

function keyOf(f: ProcurementVoiceFacts): string {
  return `${MODEL}::${f.materialCode}::${f.verdict}::${f.verdictText}`;
}

export async function getProcurementVoice(facts: ProcurementVoiceFacts): Promise<ProcurementVoice> {
  const key = keyOf(facts);
  const cached = cache.get(key);
  if (cached) return cached;

  const fallback: ProcurementVoice = { text: facts.verdictText, source: "FALLBACK", model: null, promptVersion: PROCUREMENT_VOICE_PROMPT_VERSION };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    cache.set(key, fallback);
    return fallback;
  }

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        max_tokens: 160,
        messages: buildVoiceMessages(facts),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      cache.set(key, fallback);
      return fallback;
    }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!raw) {
      cache.set(key, fallback);
      return fallback;
    }
    // 안전 가드: LLM이 엔진에 없는 숫자를 지어냈으면 원문으로 폴백.
    if (!voiceNumbersSafe(raw, allowedNumberSet(facts))) {
      const guarded: ProcurementVoice = { text: facts.verdictText, source: "GUARD_FALLBACK", model: MODEL, promptVersion: PROCUREMENT_VOICE_PROMPT_VERSION };
      cache.set(key, guarded);
      return guarded;
    }
    const ok: ProcurementVoice = { text: raw, source: "AI", model: MODEL, promptVersion: PROCUREMENT_VOICE_PROMPT_VERSION };
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, ok);
    return ok;
  } catch {
    cache.set(key, fallback);
    return fallback;
  }
}
