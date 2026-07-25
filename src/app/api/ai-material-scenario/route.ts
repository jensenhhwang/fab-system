import Groq from "groq-sdk";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  normalizeAIInterpretation,
  parseMaterialScenarioPrompt,
} from "@/lib/material-copilot";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as { prompt?: unknown; snapshotAt?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 1_000) : "";
  const snapshotAt = typeof body?.snapshotAt === "string" && !Number.isNaN(Date.parse(body.snapshotAt))
    ? body.snapshotAt
    : new Date().toISOString();
  if (!prompt) return NextResponse.json({ error: "분석할 문장을 입력해 주세요." }, { status: 400 });

  const fallback = () => NextResponse.json({
    interpretation: parseMaterialScenarioPrompt(prompt, snapshotAt, "RULES_FALLBACK"),
    notice: "AI 연결 없이 안전 규칙으로 해석했습니다. 수량 계산은 동일한 결정론 엔진을 사용합니다.",
  });
  if (!process.env.GROQ_API_KEY) return fallback();

  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const snapshotDate = snapshotAt.slice(0, 10);
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `당신은 반도체 FAB 자재 시나리오 입력 해석기입니다. 오늘은 ${snapshotDate}입니다.
사용자 문장을 계산하지 말고 JSON 조건으로만 변환하세요. 숫자나 날짜를 추측하지 마세요.
허용 FAB는 M20, M21, M22이고 제품은 HBM, DRAM, NAND입니다.
생산 변경이면 intent는 PRODUCTION_CHANGE, 단순 위험 자재 조회면 RISK_REVIEW입니다.
startDate는 YYYY-MM-DD, durationDays는 정수 일수로 반환합니다. 다음 달부터는 다음 달 1일입니다.
반드시 다음 키만 포함한 JSON을 반환하세요:
{"intent":"PRODUCTION_CHANGE|RISK_REVIEW","fabId":"M20|M21|M22|null","product":"HBM|DRAM|NAND|null","changePct":"number|null","startDate":"YYYY-MM-DD|null","durationDays":"number|null","assumptions":["string"]}`,
        },
        { role: "user", content: prompt },
      ],
    });
    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = normalizeAIInterpretation(JSON.parse(raw), prompt, snapshotAt);
    if (!parsed) return fallback();
    return NextResponse.json({ interpretation: parsed });
  } catch {
    return fallback();
  }
}
