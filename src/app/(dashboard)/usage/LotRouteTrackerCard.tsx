"use client";

import { useCallback, useEffect, useState } from "react";
import { PROCESSES } from "@/lib/processes";
import type { FabId } from "@/lib/fab-domain";
import type { LiveFoupView } from "@/components/ProcessFlow3D";

type Product = "HBM" | "DRAM" | "NAND";

type RouteMasterNodeView = { id: string; label: string; cycle: string[]; repeatCount: number; stage: string };
type RouteVisitView = { nodeId: string; label: string; processCode: string; stage: string; visitIndex: number; stepIndex: number };
type LotStepEventView = {
  _id: string; nodeId: string; processCode: string; stepIndex: number; visitIndex: number;
  completedAt?: string; triggeredBy: { type: "OPERATOR_CONFIRM" | "MES_TELEMETRY"; actorId: string };
};
type LotRouteStateResponse = {
  lot: { _id: string; foupCode: string; status: "IN_PROGRESS" | "DONE" };
  nodes: RouteMasterNodeView[];
  totalSteps: number;
  currentStepIndex: number;
  currentVisit: RouteVisitView | null;
  nextVisit: RouteVisitView | null;
  isDone: boolean;
  history: LotStepEventView[];
};

function toLiveFoup(state: LotRouteStateResponse): LiveFoupView {
  const visit = state.currentVisit ?? state.history.at(-1);
  const node = visit ? state.nodes.find((n) => n.id === visit.nodeId) : undefined;
  return {
    lotId: state.lot._id,
    foupLabel: state.lot.foupCode,
    processCode: visit?.processCode ?? "-",
    nodeLabel: node?.label ?? visit?.nodeId ?? "-",
    stepIndex: visit?.stepIndex ?? 0,
    totalSteps: state.totalSteps,
    isDone: state.isDone,
  };
}

export default function LotRouteTrackerCard({
  fabId, product, onLiveFoupsChange,
}: {
  fabId: FabId; product: Product;
  onLiveFoupsChange?: (liveFoups: LiveFoupView[]) => void;
}) {
  const [states, setStates] = useState<LotRouteStateResponse[] | null>(null);
  const [selectedFoup, setSelectedFoup] = useState<string>("FOUP-01");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/wafer-lots/active-all?fabId=${fabId}&product=${product}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as LotRouteStateResponse[];
    setStates(data);
  }, [fabId, product]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => { if (!document.hidden) void load(); }, 6_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [load]);

  useEffect(() => {
    if (!onLiveFoupsChange) return;
    onLiveFoupsChange((states ?? []).map(toLiveFoup));
  }, [states, onLiveFoupsChange]);

  const state = states?.find((s) => s.lot.foupCode === selectedFoup) ?? null;

  const advance = async () => {
    if (!state || state.isDone) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/wafer-lots/${state.lot._id}/advance`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        setError(payload.error ?? "스텝 완료 확인에 실패했습니다.");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!states) {
    return <aside className="rounded-2xl border border-[#D8DDE2] bg-white p-4 text-[11px] text-[#8A929A]">로트 원장 조회 중…</aside>;
  }

  const currentNodeIndex = state ? state.nodes.findIndex((n) => n.id === (state.currentVisit ?? state.history.at(-1))?.nodeId) : -1;
  const proc = state ? PROCESSES.find((p) => p.code === state.currentVisit?.processCode) : undefined;

  return (
    <aside className="rounded-2xl border border-[#D8DDE2] bg-white p-4">
      <div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#0EA5E9]">LOT 실행 추적 · {fabId} 파일럿 · FOUP×12</div>
      <div className="mt-1 text-[9px] text-[#B0B8BF]">⏱ 5초 = 1스텝 자동 진행 (실제 웨이퍼 투입→패키징 완료는 약 3~4개월 — 약 1.2만~1.6만배 타임랩스, 균등 배분 가정)</div>

      {/* FOUP 선택 탭 */}
      <div className="mt-2 grid grid-cols-6 gap-1">
        {states.map((s) => {
          const pct = s.totalSteps > 0 ? Math.round((s.currentStepIndex / s.totalSteps) * 100) : 0;
          const isSelected = s.lot.foupCode === selectedFoup;
          return (
            <button
              key={s.lot.foupCode}
              type="button"
              onClick={() => setSelectedFoup(s.lot.foupCode)}
              title={`${s.lot.foupCode} · ${pct}%`}
              className="rounded px-1 py-1 text-[8px] font-black transition"
              style={{
                background: isSelected ? "#20262D" : s.isDone ? "#E9F8F2" : "#F2F4F6",
                color: isSelected ? "#fff" : s.isDone ? "#087A55" : "#59636D",
              }}
            >
              <div>{s.lot.foupCode.replace("FOUP-", "F")}</div>
              <div className="mt-0.5 opacity-75">{s.isDone ? "완주" : `${pct}%`}</div>
            </button>
          );
        })}
      </div>

      {!state ? (
        <div className="mt-3 text-[11px] text-[#8A929A]">FOUP를 선택하세요.</div>
      ) : (
        <>
          <div className="mt-3 text-sm font-black text-[#20262D]">{state.lot._id}</div>
          <div className="mt-0.5 text-[10px] text-[#8A929A]">{state.lot.foupCode} · 전체 {state.currentStepIndex}/{state.totalSteps} ({state.totalSteps > 0 ? Math.round(state.currentStepIndex / state.totalSteps * 100) : 0}%)</div>

          {state.isDone ? (
            <div className="mt-3 rounded-lg bg-[#E9F8F2] px-3 py-2 text-[11px] font-black text-[#087A55]">
              라우팅 전체 스텝 완주 — routeMaster 전체를 통과했습니다.
            </div>
          ) : (
            <>
              <div className="mt-3 text-[11px] font-bold text-[#414A52]">
                {state.currentVisit && `${state.currentVisit.stage} 노드 · ${state.currentVisit.label} · ${state.currentVisit.processCode} ${proc?.name ?? ""} (visit ${state.currentVisit.visitIndex + 1}회차)`}
              </div>

              {/* 노드 세그먼트 진행 바 */}
              <div className="mt-3 flex gap-0.5">
                {state.nodes.map((node, index) => {
                  const isCurrent = index === currentNodeIndex;
                  const isPast = index < currentNodeIndex;
                  return (
                    <div key={node.id} title={`${node.label} · ${node.cycle.join("→")} × ${node.repeatCount}`}
                      className="h-2 rounded-sm"
                      style={{
                        flexGrow: Math.max(1, node.repeatCount * node.cycle.length),
                        background: isPast ? "#087A55" : isCurrent ? "#0EA5E9" : "#E5E9ED",
                      }}
                    />
                  );
                })}
              </div>
              <div className="mt-1 text-[9px] text-[#B0B8BF]">9개 노드 · 칸 너비 = 스텝 비중, hover로 반복 구조 확인</div>
            </>
          )}

          {error && <div className="mt-3 rounded bg-red-50 px-2 py-1.5 text-[10px] text-red-700">{error}</div>}

          {!state.isDone && (
            <button
              type="button" disabled={busy} onClick={() => void advance()}
              className="mt-3 w-full rounded-lg bg-[#0EA5E9] px-3 py-2 text-[11px] font-black text-white disabled:opacity-50"
            >
              {busy ? "확인 처리 중…" : `다음 스텝 완료 확인${state.nextVisit ? ` (${state.nextVisit.processCode} ${state.nextVisit.label} 진입)` : ""}`}
            </button>
          )}

          {state.history.length > 0 && (
            <div className="mt-3">
              <button type="button" onClick={() => setShowHistory((prev) => !prev)} className="text-[9px] font-bold text-[#0EA5E9] underline">
                완료 이력 {state.history.length}건 {showHistory ? "▲" : "▼"}
              </button>
              {showHistory && (
                <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto border-t border-[#EEF1F4] pt-1">
                  {[...state.history].reverse().map((event) => (
                    <div key={event._id} className="text-[9px] text-[#8A929A]">
                      {event.completedAt ? new Date(event.completedAt).toLocaleTimeString("ko-KR") : "-"} · {event.processCode} · {event.triggeredBy.type}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
