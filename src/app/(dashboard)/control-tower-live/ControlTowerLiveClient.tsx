"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ControlTowerView, ControlTowerAgentView, TwinEventView, AgentWatchMetric } from "@/lib/control-tower-live";

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
      <span className="ml-auto flex items-center gap-1.5 text-[11px] font-bold text-[#00875A]">
        <span className="h-2 w-2 rounded-full bg-[#00875A]" /> LIVE · 3초 갱신
      </span>
    </div>
  );
}

function AgentCard({ agent }: { agent: ControlTowerAgentView }) {
  const active = agent.consciousness === "ACTIVE";
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
          {active ? "판단 가동" : "관측 전용"}
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

      {/* 판단 (ACTIVE만) */}
      {agent.judgment ? (
        <div className="mt-3 rounded-xl border border-dashed p-2.5" style={{ borderColor: agent.color, background: "#FFF7F8" }}>
          <div className="text-[10px] font-bold text-[#999]">방금 판단 · {agent.judgment.scenarioLabel}</div>
          {agent.judgment.top ? (
            <div className="mt-1 text-xs font-bold text-[#141413]">{agent.judgment.top.materialName} — {agent.judgment.top.verdictText}</div>
          ) : (
            <div className="mt-1 text-xs text-[#888]">지금 조치가 필요한 자재 없음</div>
          )}
          <a href="/procurement-cockpit" className="mt-1.5 inline-block text-[11px] font-bold text-[#0078D4]">추론 사슬 전체 보기 →</a>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-dashed p-2.5 text-[11px] text-[#aaa]" style={{ borderColor: "var(--border)" }}>
          {agent.roadmapNote ?? "판단 로직 준비 중"}
        </div>
      )}
    </div>
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold text-[#141413]">관제탑 라이브 <span className="text-sm font-bold text-[#999]">Control Tower Live</span></h1>
        <p className="mt-1 text-sm text-[#888]">살아있는 Twin이 재고를 소모·보충하고, 4명의 담당이 자기 신호를 지켜봅니다. 지금 판단하는 건 김구매(발주) 하나뿐 — 나머지는 관측만 합니다.</p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      {loading && !view && <div className="rounded-2xl border bg-white p-8 text-center text-sm text-[#999]" style={{ borderColor: "var(--border)" }}>관제탑을 불러오는 중…</div>}

      {view && (
        <>
          <HeartbeatStrip view={view} now={now} pulse={pulse} />
          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <div className="grid gap-4 sm:grid-cols-2">
              {view.agents.map((a) => <AgentCard key={a.role} agent={a} />)}
            </div>
            <EventFeed events={view.events} now={now} />
          </div>
        </>
      )}
    </div>
  );
}
