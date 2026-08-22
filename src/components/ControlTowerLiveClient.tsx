"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  AgentWatchMetric,
  ControlTowerAIEpisodeView,
  ControlTowerAgentView,
  ControlTowerRole,
  ControlTowerView,
  TwinEventView,
} from "@/lib/control-tower-live";

const EVENT_STYLE: Record<TwinEventView["type"], { color: string; bg: string; label: string }> = {
  BURN: { color: "#777", bg: "#F1F1F0", label: "소모" },
  SHORTAGE: { color: "#EA002C", bg: "#FFF0F2", label: "부족" },
  PO_ORDERED: { color: "#0078D4", bg: "#EAF4FF", label: "발주" },
  PO_RECEIVED: { color: "#00875A", bg: "#E6FAF1", label: "입고" },
};

const TONE_COLOR: Record<NonNullable<AgentWatchMetric["tone"]>, string> = {
  normal: "#141413", warn: "#B97500", critical: "#EA002C",
};

function relTime(iso: string | null, now: number): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}초 전`;
  return `${Math.floor(s / 60)}분 ${s % 60}초 전`;
}

function HeartbeatStrip({ view, now, pulse }: { view: ControlTowerView; now: number; pulse: boolean }) {
  const hb = view.heartbeat;
  const ai = view.ai ?? { configured: false, model: "—", episode: null };
  const running = hb.status === "RUNNING";
  const sinceTick = hb.lastTickAt ? (now - new Date(hb.lastTickAt).getTime()) : 0;
  const nextIn = Math.max(0, Math.ceil((hb.tickIntervalMs - (sinceTick % hb.tickIntervalMs)) / 1000));
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border bg-white px-5 py-3" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
      <style>{`@keyframes ct-pulse{0%{transform:scale(1);opacity:1}50%{transform:scale(1.6);opacity:.4}100%{transform:scale(1);opacity:1}}`}</style>
      <span className="flex items-center gap-2 text-sm font-extrabold" style={{ color: running ? "#00875A" : "#B97500" }}>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: running ? "#00875A" : "#B97500", animation: pulse ? "ct-pulse .6s ease-out" : undefined }} />
        Twin {running ? "RUNNING" : "PAUSED"}
      </span>
      <span className="text-xs text-[#888]">마지막 tick <b className="text-[#141413]">{relTime(hb.lastTickAt, now)}</b></span>
      {running && <span className="text-xs text-[#888]">다음 tick <b className="text-[#EA002C]">{nextIn}초</b></span>}
      <span className="text-xs text-[#888]">누적 소모 <b className="text-[#141413]">{hb.totalBurnEvents.toLocaleString("ko-KR")}</b></span>
      <span className="text-xs text-[#888]">입고 중 PO <b className="text-[#141413]">{hb.openPOs}</b></span>
      {hb.pendingApprovalPOs > 0 && (
        <Link
          href="/procurement-cockpit"
          className={`rounded-full px-2 py-1 text-[10px] font-extrabold ${hb.urgentApprovalPOs > 0 ? "animate-pulse" : ""}`}
          style={hb.urgentApprovalPOs > 0 ? { background: "#FFF1F3", color: "#C01048" } : { background: "#FFFAEB", color: "#B54708" }}
          title={hb.urgentApprovalPOs > 0 ? "60분 이상 방치된 승인대기 발주가 있습니다 — 지금 확인하세요" : "김구매 자율등급 L2(위험물·단일소싱) — 사람 승인 대기 중"}
        >
          김구매 발주 신호 · 승인대기 {hb.pendingApprovalPOs}건{hb.urgentApprovalPOs > 0 ? ` (긴급 ${hb.urgentApprovalPOs})` : ""}
        </Link>
      )}
      {hb.inboundHoldPOs > 0 && (
        <Link href="/warehouse" className="rounded-full px-2 py-1 text-[10px] font-extrabold" style={{ background: "#FFF1F3", color: "#C01048" }} title="창고 용량초과로 실제 입고가 보류된 화물 — 사람이 확인해야 재고 반영">
          박물류 입고보류 · {hb.inboundHoldPOs}건
        </Link>
      )}
      {hb.materialBlockedLots > 0 && (
        <Link href="/usage" className="rounded-full px-2 py-1 text-[10px] font-extrabold" style={{ background: "#EAF4FF", color: "#0956B0" }} title="이자재 COVERAGE_CRITICAL 자재를 다음 공정에 쓰는 로트 — 재고가 회복되면 자동으로 다시 진행">
          이자재·최생산 자재차단 · {hb.materialBlockedLots}로트
        </Link>
      )}
      <span
        className="rounded-full px-2 py-1 text-[10px] font-extrabold"
        style={ai.configured
          ? { background: "#EEF4FF", color: "#3538CD" }
          : { background: "#FFF0F2", color: "#C01048" }}
      >
        OpenAI {ai.configured ? `연결 · ${ai.model}` : "미연결"}
      </span>
      <span className="ml-auto flex items-center gap-1.5 text-[11px] font-bold text-[#00875A]">
        <span className="h-2 w-2 rounded-full bg-[#00875A]" /> LIVE · 3초 갱신
      </span>
    </div>
  );
}

const SEVERITY_STYLE = {
  NORMAL: { label: "정상 관찰", color: "#00875A", background: "#E6FAF1" },
  ATTENTION: { label: "주의 판단", color: "#B54708", background: "#FFFAEB" },
  CRITICAL: { label: "중요 판단", color: "#C01048", background: "#FFF1F3" },
};

const ROLE_NAMES: Record<ControlTowerRole, string> = {
  PROCUREMENT: "김구매",
  MATERIALS: "이자재",
  PRODUCTION: "최생산",
  LOGISTICS: "박물류",
};

const ROLE_DEEP_LINK: Record<ControlTowerRole, (code: string) => { href: string; label: string }> = {
  PROCUREMENT: () => ({ href: "/procurement-cockpit", label: "추론 사슬 전체 보기 →" }),
  MATERIALS: (code) => ({ href: `/inventory?material=${encodeURIComponent(code)}`, label: "재고 원장에서 보기 →" }),
  PRODUCTION: (code) => ({ href: `/usage?process=${encodeURIComponent(code)}`, label: "작업지시 현황 보기 →" }),
  LOGISTICS: (code) => ({ href: `/warehouse?code=${encodeURIComponent(code)}`, label: "창고 현황 보기 →" }),
};

function AgentCard({
  agent,
  episode,
  aiEnabled,
}: {
  agent: ControlTowerAgentView;
  episode: ControlTowerAIEpisodeView | null;
  aiEnabled: boolean;
}) {
  const active = agent.consciousness === "ACTIVE";
  const aiJudgment = aiEnabled ? episode?.judgments.find((judgment) => judgment.role === agent.role) ?? null : null;
  return (
    <div className="rounded-2xl border bg-white p-4" style={{ borderColor: active ? agent.color : "var(--border)", boxShadow: "var(--shadow-1)" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-black text-white" style={{ background: active ? agent.color : "#C9C6C2" }}>
            {agent.name.slice(0, 1)}
          </span>
          <div>
            <div className="text-sm font-black text-[#141413]">{agent.name}</div>
            <div className="text-[10px] text-[#999]">{agent.team} · {agent.role}</div>
          </div>
        </div>
        <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold"
          style={active ? { background: "#E6FAF1", color: "#00875A" } : { background: "#F3F0EE", color: "#999" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: active ? "#00875A" : "#BBB", animation: active ? "ct-pulse 1.4s infinite" : undefined }} />
          {active ? (agent.judgmentMode === "RULE_LLM" ? "RULE + LLM" : "LLM 판단") : "관측 전용"}
        </span>
      </div>
      <div className="mt-1.5 text-[11px] text-[#888]">{agent.remit}</div>

      {/* 관측 지표 */}
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
        {agent.watching.map((m) => (
          <div key={m.label} className="text-[11px]">
            <span className="text-[#999]">{m.label}</span>
            <div className="font-bold" style={{ color: TONE_COLOR[m.tone ?? "normal"] }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* OpenAI 공개 판단 */}
      {aiJudgment ? (
        <div className="mt-3 rounded-xl border border-dashed p-2.5" style={{ borderColor: agent.color, background: "#FAFAFF" }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold text-[#667085]">
              자동 판단 · {aiJudgment.mode === "RULE_LLM" ? "규칙 근거 포함" : "규칙 엔진 준비 중"}
            </span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] font-extrabold"
              style={SEVERITY_STYLE[aiJudgment.severity]}
            >
              {SEVERITY_STYLE[aiJudgment.severity].label}
            </span>
          </div>
          <div className="mt-1.5 text-xs font-bold leading-5 text-[#141413]">「{aiJudgment.summary}」</div>
          <div className="mt-1.5 text-[10px] leading-4 text-[#667085]">{aiJudgment.proposedDecision}</div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {aiJudgment.evidenceRefs.map((ref) => (
              <span key={ref} className="rounded bg-[#EEF4FF] px-1.5 py-0.5 font-mono text-[8px] text-[#3538CD]">{ref}</span>
            ))}
            <span className="ml-auto text-[8px] text-[#98A2B3]">{aiJudgment.usage.totalTokens.toLocaleString("ko-KR")} tokens</span>
          </div>
        </div>
      ) : agent.judgment ? (
        <div className="mt-3 rounded-xl border border-dashed p-2.5" style={{ borderColor: agent.color, background: "#FFF7F8" }}>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-[#999]">방금 판단 · {agent.judgment.scenarioLabel}</span>
            {agent.judgment.top && (
              <span className="rounded-full px-1.5 py-0.5 text-[9px] font-extrabold"
                style={agent.judgment.top.voiceSource === "AI" ? { background: "#EEF0FF", color: "#4F46E5" } : { background: "#F1F1F0", color: "#999" }}
                title={agent.judgment.top.voiceSource === "AI" ? "AI 각색 · 숫자는 엔진 그대로" : "AI 미연결/숫자검증 실패 — 엔진 원문 표시"}>
                {agent.judgment.top.voiceSource === "AI" ? "🗣 AI 음성" : "엔진 원문"}
              </span>
            )}
          </div>
          {agent.judgment.top ? (
            <>
              <div className="mt-1 text-xs font-bold text-[#141413]">「{agent.judgment.top.voice}」</div>
              {agent.judgment.top.voiceSource === "AI" && (
                <div className="mt-1 text-[10px] text-[#aaa]">근거 판정: {agent.judgment.top.verdictText}</div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <span className="rounded bg-[#EEF4FF] px-1.5 py-0.5 font-mono text-[8px] text-[#3538CD]">
                  {agent.role}:{agent.judgment.top.code}
                </span>
              </div>
            </>
          ) : (
            <div className="mt-1 text-xs text-[#888]">지금 조치가 필요한 항목 없음</div>
          )}
          {(() => {
            const link = ROLE_DEEP_LINK[agent.role](agent.judgment.top?.code ?? "");
            return <a href={link.href} className="mt-1.5 inline-block text-[11px] font-bold text-[#0078D4]">{link.label}</a>;
          })()}
        </div>
      ) : aiEnabled && episode?.status === "RUNNING" ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-dashed p-2.5 text-[11px] text-[#667085]" style={{ borderColor: agent.color }}>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: agent.color }} />
          운영 신호를 읽고 판단 중
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-dashed p-2.5 text-[11px] text-[#aaa]" style={{ borderColor: "var(--border)" }}>
          {agent.roadmapNote ?? "첫 자동 판단을 기다리는 중"}
        </div>
      )}
    </div>
  );
}

function AIConversation({ view }: { view: ControlTowerView }) {
  const ai = view.ai ?? { configured: false, enabled: false, model: "—", episode: null };
  const episode = ai.episode;
  return (
    <section className="overflow-hidden rounded-2xl border bg-white" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
        <div>
          <div className="text-sm font-extrabold text-[#141413]">에이전트 공개 판단 · 대화</div>
          <div className="mt-0.5 text-[10px] text-[#999]">숨은 사고과정이 아닌 결론·근거·질문·답변만 기록됩니다.</div>
        </div>
        {episode && (
          <div className="text-right text-[10px] text-[#999]">
            <div>{new Date(episode.snapshot.capturedAt).toLocaleString("ko-KR")} Snapshot</div>
            <div className="mt-0.5">{episode.usage.totalTokens.toLocaleString("ko-KR")} tokens · {episode.model}</div>
          </div>
        )}
      </div>

      {!ai.configured && (
        <div className="px-5 py-8 text-center text-xs text-[#C01048]">서버에 OPENAI_API_KEY를 연결하면 Twin이 자동 판단을 시작합니다.</div>
      )}
      {ai.configured && !ai.enabled && (
        <div className="px-5 py-2.5 text-center text-[10px] font-bold text-[#B54708]" style={{ background: "#FFFAEB" }}>
          AI 판단이 꺼져 있습니다 — 새 판단은 생성되지 않고, 아래는 마지막으로 기록된 판단입니다.
        </div>
      )}
      {ai.configured && !episode && (
        <div className="px-5 py-8 text-center text-xs text-[#667085]">
          Twin의 다음 점검에서 첫 운영 Snapshot을 만들고 네 담당자를 자동으로 깨웁니다.
        </div>
      )}
      {ai.enabled && episode?.status === "RUNNING" && (
        <div className="flex items-center justify-center gap-2 px-5 py-8 text-xs font-bold text-[#3538CD]">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#4F46E5]" />
          네 담당자가 독립적으로 판단하고 있습니다.
        </div>
      )}
      {episode && (episode.status === "FAILED" || episode.status === "PARTIAL") && (
        <div className="mx-5 mt-4 rounded-xl border border-[#FDA29B] bg-[#FFF5F4] px-4 py-3 text-xs text-[#B42318]">
          <b>{episode.status === "FAILED" ? "자동 판단 실패" : "일부 판단만 완료"}</b>
          <span className="ml-2">{episode.errorMessage ?? "OpenAI 응답을 완성하지 못했습니다."}</span>
        </div>
      )}

      {episode && episode.judgments.length > 0 && (
        <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-4">
          {episode.judgments.map((judgment) => (
            <div key={judgment.role} className="rounded-xl border border-[#E4E7EC] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-[#344054]">{ROLE_NAMES[judgment.role]}</span>
                <span className="rounded-full px-1.5 py-0.5 text-[8px] font-extrabold" style={SEVERITY_STYLE[judgment.severity]}>
                  {SEVERITY_STYLE[judgment.severity].label}
                </span>
              </div>
              <p className="mt-2 text-xs font-bold leading-5 text-[#141413]">{judgment.summary}</p>
              <p className="mt-2 text-[10px] leading-4 text-[#667085]">{judgment.proposedDecision}</p>
              {judgment.questionForRole && judgment.question && (
                <div className="mt-2 rounded-lg bg-[#F8F9FC] px-2 py-1.5 text-[10px] leading-4 text-[#475467]">
                  <b>→ {ROLE_NAMES[judgment.questionForRole]}</b> {judgment.question}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {episode && episode.replies.length > 0 && (
        <div className="border-t px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[#98A2B3]">Public replies</div>
          <div className="space-y-2">
            {episode.replies.map((reply, index) => (
              <div key={`${reply.speakerRole}-${reply.replyToRole}-${index}`} className="flex items-start gap-3 rounded-xl bg-[#F9FAFB] px-3 py-2.5">
                <span className="shrink-0 text-[10px] font-extrabold text-[#344054]">
                  {ROLE_NAMES[reply.speakerRole]} → {ROLE_NAMES[reply.replyToRole]}
                </span>
                <div className="min-w-0">
                  <p className="text-xs leading-5 text-[#475467]">{reply.message}</p>
                  <p className="mt-1 text-[10px] font-semibold text-[#667085]">수정 결정 · {reply.revisedDecision}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {episode?.conclusion && (
        <div className="border-t bg-[#FCFCFD] px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#F2F4F7] px-2 py-1 text-[9px] font-extrabold text-[#475467]">
              {episode.conclusion.alignment === "ALIGNED" ? "의견 정렬" : episode.conclusion.alignment === "CONDITIONAL" ? "조건부 정렬" : "이견 유지"}
            </span>
            <span className="rounded-full bg-[#FFF0F2] px-2 py-1 text-[9px] font-extrabold text-[#C01048]">READ ONLY</span>
          </div>
          <p className="mt-2 text-sm font-bold leading-6 text-[#141413]">{episode.conclusion.summary}</p>
          {episode.conclusion.openIssues.length > 0 && (
            <p className="mt-2 text-[10px] leading-4 text-[#B54708]">남은 확인 · {episode.conclusion.openIssues.join(" · ")}</p>
          )}
        </div>
      )}
    </section>
  );
}

function EventFeed({ events, now }: { events: TwinEventView[]; now: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-white" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
      <div className="border-b px-4 py-2.5 text-sm font-bold text-[#333]" style={{ borderColor: "var(--border)" }}>이벤트 스트림</div>
      <div className="max-h-[560px] divide-y overflow-y-auto" style={{ borderColor: "var(--border)" }}>
        {events.length === 0 && <div className="px-4 py-8 text-center text-xs text-[#999]">아직 이벤트가 없습니다. Twin이 tick하면 여기 흐릅니다.</div>}
        {events.map((e) => {
          const st = EVENT_STYLE[e.type];
          return (
            <div key={e.id} className="flex items-start gap-2.5 px-4 py-2.5">
              <span className="mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold" style={{ background: st.bg, color: st.color }}>{st.label}</span>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-[#141413]">{e.text}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[#aaa]">
                  <span>{relTime(e.at, now)}</span>
                  {e.reactedBy && <span className="rounded-full bg-[#F1F1F0] px-1.5 py-0.5 font-bold text-[#777]">↳ {e.reactedBy} 반응</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ControlTowerLiveClient() {
  const [view, setView] = useState<ControlTowerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [pulse, setPulse] = useState(false);
  const [toggling, setToggling] = useState(false);
  const prevTick = useRef<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/twin/control-tower", { cache: "no-store", signal });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 403) throw new Error("관제탑은 운영 담당(자재·생산·물류·관리자) 계정만 볼 수 있어요.");
        throw new Error(payload.error ?? "관제탑 데이터를 불러오지 못했습니다.");
      }
      const next = payload as ControlTowerView;
      if (prevTick.current && next.heartbeat.lastTickAt && next.heartbeat.lastTickAt !== prevTick.current) {
        setPulse(true); setTimeout(() => setPulse(false), 700);
      }
      prevTick.current = next.heartbeat.lastTickAt;
      setView(next); setError(null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const run = async () => { if (running || document.hidden) return; running = true; try { await load(controller.signal); } finally { running = false; } };
    void run();
    const poll = window.setInterval(() => void run(), 3000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const onVis = () => { if (!document.hidden) void run(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { controller.abort(); window.clearInterval(poll); window.clearInterval(clock); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  const toggleAI = useCallback(async () => {
    if (!view || toggling) return;
    const nextEnabled = !view.ai.enabled;
    setToggling(true);
    try {
      const res = await fetch("/api/twin/control-tower/ai-enabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(res.status === 403 ? "관리자만 변경할 수 있어요." : payload.error ?? "전환에 실패했습니다.");
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "전환에 실패했습니다.");
    } finally {
      setToggling(false);
    }
  }, [view, toggling, load]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-[#141413]">관제탑 라이브 <span className="text-sm font-bold text-[#999]">Control Tower Live</span></h1>
          <p className="mt-1 text-sm text-[#888]">살아있는 Twin의 의미 있는 변화가 네 담당자를 자동으로 깨웁니다. 각자 판단하고 질문하며, 공개 대화와 읽기 전용 결론을 남깁니다.</p>
        </div>
        {view && (
          <button
            onClick={() => void toggleAI()}
            disabled={toggling}
            className="shrink-0 flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-extrabold transition-opacity disabled:opacity-50"
            style={view.ai.enabled
              ? { borderColor: "#00875A", background: "#E6FAF1", color: "#00875A" }
              : { borderColor: "var(--border)", background: "#F3F0EE", color: "#777" }}
            title={view.ai.enabled ? "끄면 규칙 엔진(하드코딩) 판정만 표시됩니다" : "켜면 LLM을 포함해 판단합니다"}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: view.ai.enabled ? "#00875A" : "#BBB" }} />
            AI 판단 {view.ai.enabled ? "ON" : "OFF"}
          </button>
        )}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      {loading && !view && <div className="rounded-2xl border bg-white p-8 text-center text-sm text-[#999]" style={{ borderColor: "var(--border)" }}>관제탑을 불러오는 중…</div>}

      {view && (
        <>
          <HeartbeatStrip view={view} now={now} pulse={pulse} />
          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <div className="grid gap-4 sm:grid-cols-2">
              {view.agents.map((a) => <AgentCard key={a.role} agent={a} episode={view.ai?.episode ?? null} aiEnabled={view.ai?.enabled ?? false} />)}
            </div>
            <EventFeed events={view.events} now={now} />
          </div>
          <AIConversation view={view} />
        </>
      )}
    </div>
  );
}
