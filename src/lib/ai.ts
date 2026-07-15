import Groq from "groq-sdk";
import {
  getInventoryRows, getWarehouseCapacity,
  getActiveRisks, getInfra, getRecentTransactions,
} from "@/lib/queries";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const ROLE_CONTEXT: Record<string, string> = {
  ADMIN:      "전체 자재관리 총괄 담당자 (구매본부 자재관리팀 리더)",
  MATERIALS:  "자재 입고·재고·발주 담당자 (구매본부 자재관리팀)",
  PRODUCTION: "공정별 자재 소비·출고 담당자 (생산관리팀)",
  LOGISTICS:  "창고 운영·인프라 교체·공급망 담당자 (물류/인프라팀)",
};

export type AIPriority = {
  level: "urgent" | "warning" | "info";
  category: string;
  title: string;
  detail: string;
  action: string;
};

export type AIBriefing = {
  greeting: string;
  summary: string;
  priorities: AIPriority[];
  generatedAt: string;
};

async function getContextData() {
  // 재고 경보 (DOH 기준 — 일사용량은 ProcessUsage 마스터에서 유도)
  const inventories = await getInventoryRows();
  const dohAlerts = inventories
    .filter((inv) => inv.doh !== null)
    .map((inv) => ({ ...inv, doh: inv.doh as number }))
    .filter((inv) => inv.doh < inv.material.ropDays)
    .sort((a, b) => a.doh - b.doh)
    .slice(0, 8)
    .map((inv) => ({
      code: inv.material.code,
      name: inv.material.name,
      doh: Math.round(inv.doh * 10) / 10,
      ropDays: inv.material.ropDays,
      qty: inv.quantity,
      unit: inv.material.unit,
    }));

  // 창고 현황 — 실제 공간환산 Capacity
  const warehouseStatus = (await getWarehouseCapacity()).map((wh) => ({
    name: wh.name, pct: Math.min(wh.utilization, 100),
  }));

  // 활성 리스크
  const risks = await getActiveRisks();

  // 인프라 교체 임박
  const infraAlerts = (await getInfra())
    .filter((i) => i.currentUsage / i.replacementCriteria >= 0.75)
    .map((i) => ({
      name: i.name,
      pct: Math.round((i.currentUsage / i.replacementCriteria) * 100),
      unit: i.unit,
      remaining: Math.round(i.replacementCriteria - i.currentUsage),
    }));

  // 최근 트랜잭션 (없으면 빈 배열)
  const recentTx = await getRecentTransactions(5, false);

  return { dohAlerts, warehouseStatus, risks, infraAlerts, recentTx };
}

export async function generateAIBriefing(
  userName: string,
  role: string
): Promise<AIBriefing> {
  const now = new Date();
  const dateStr = now.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" });
  const data = await getContextData();
  const roleDesc = ROLE_CONTEXT[role] ?? "담당자";

  const systemPrompt = `당신은 SK하이닉스 이천 FAB 자재관리 시스템의 AI 브리핑 어시스턴트입니다.
담당자의 역할과 실시간 데이터를 분석해서 오늘의 업무 우선순위를 간결하고 실용적으로 제공하세요.
응답은 반드시 JSON 형식으로만 하세요. 순수한 한국어(한글)로만 작성하세요.
절대 한자, 일본어 가나·한자(目·品·의·등 한자 포함)를 사용하지 마세요. 한글·영어·숫자·일반 특수문자만 허용됩니다.`;

  const userPrompt = `오늘 날짜: ${dateStr}
담당자: ${userName} (${roleDesc})

=== 현재 데이터 ===

[재고 경보 - DOH가 ROP 이하인 품목]
${data.dohAlerts.length === 0 ? "없음" : data.dohAlerts.map((a) => `- ${a.name}(${a.code}): 보관일수 ${a.doh}일 (기준 ${a.ropDays}일), 재고 ${a.qty}${a.unit}`).join("\n")}

[창고 Capacity]
${data.warehouseStatus.map((w) => `- ${w.name}: ${w.pct}%`).join("\n")}

[활성 리스크]
${data.risks.map((r) => `- [${r.level}] ${r.title} (담당: ${r.owner})`).join("\n")}

[인프라 교체 임박 (75% 이상 사용)]
${data.infraAlerts.length === 0 ? "없음" : data.infraAlerts.map((i) => `- ${i.name}: ${i.pct}% 사용, 잔여 ${i.remaining}${i.unit}`).join("\n")}

위 데이터를 분석해서 ${userName}의 역할(${roleDesc})에 맞는 오늘의 브리핑을 아래 JSON 형식으로 생성하세요.
우선순위는 역할에 관련된 것만 최대 4개, 가장 중요한 것 순으로 정렬하세요.

{
  "greeting": "짧은 인사 (이름 포함, 1문장)",
  "summary": "오늘 상황 전체 요약 (2~3문장, 핵심만)",
  "priorities": [
    {
      "level": "urgent | warning | info",
      "category": "재고 | 창고 | 리스크 | 인프라 | 공급망",
      "title": "우선순위 제목 (짧게)",
      "detail": "구체적인 수치 포함한 설명 (1~2문장)",
      "action": "오늘 해야 할 액션 (동사로 시작, 짧게)"
    }
  ],
  "generatedAt": "${now.toISOString()}"
}`;

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  // 한자·일본어 문자 제거 (CJK Unified: U+4E00-9FFF, 가타카나·히라가나 제외 한글만 유지)
  const content = raw.replace(/[぀-ヿ㐀-䶿一-鿿豈-﫿]/g, "");
  return JSON.parse(content) as AIBriefing;
}
