"use client";

import { useCallback, useEffect, useState } from "react";
import { PROCESSES } from "@/lib/processes";
import { normalizeProcessCode } from "@/lib/route-contract";
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

type ExecutionLedgerRow = {
  lotId: string;
  foupCode: string;
  cohort: "WATCHED" | "MODELED_FOUP";
  watched: boolean;
  status: "IN_PROGRESS" | "DONE";
  waferQty: number;
  routeMasterId: string;
  routeVersion: string | null;
  currentStepIndex: number;
  totalSteps: number;
  progressPct: number;
  processCode: string;
  nodeId: string | null;
  nodeLabel: string | null;
  operationCode: string | null;
  stage: string | null;
  carrierState: string | null;
  movementStatus: string | null;
  currentLocationId: string | null;
  assignmentStatus: string | null;
  assignedAt: string | null;
  modeledReleaseAt: string | null;
  nextTransitionAt: string | null;
  lastEventAt: string | null;
  dwellModel: string | null;
  source: "MODELED_BASELINE" | "MES_ACTUAL";
};

type ExecutionLedgerResponse = {
  bootstrapVersion: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  query: string;
  summary: { activeTotal: number; watchedTotal: number; modeledTotal: number };
  rows: ExecutionLedgerRow[];
};

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function toLiveFoup(state: LotRouteStateResponse): LiveFoupView {
  const visit = state.currentVisit ?? state.history.at(-1);
  const node = visit ? state.nodes.find((n) => n.id === visit.nodeId) : undefined;
  return {
    lotId: state.lot._id,
    foupLabel: state.lot.foupCode,
    processCode: visit ? normalizeProcessCode(visit.processCode) : "-",
    nodeLabel: node?.label ?? visit?.nodeId ?? "-",
    stepIndex: visit?.stepIndex ?? 0,
    totalSteps: state.totalSteps,
    isDone: state.isDone,
  };
}

export default function LotRouteTrackerCard({
  fabId, product, occupiedFoup, onLiveFoupsChange,
}: {
  fabId: FabId; product: Product;
  occupiedFoup?: number;
  onLiveFoupsChange?: (liveFoups: LiveFoupView[]) => void;
}) {
  const [states, setStates] = useState<LotRouteStateResponse[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [ledger, setLedger] = useState<ExecutionLedgerResponse | null>(null);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerSearchInput, setLedgerSearchInput] = useState("");
  const [ledgerQuery, setLedgerQuery] = useState("");
  const [selectedLedgerLotId, setSelectedLedgerLotId] = useState<string | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/wafer-lots/active-all?fabId=${fabId}&product=${product}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as LotRouteStateResponse[];
    setStates(data);
  }, [fabId, product]);

  const loadLedger = useCallback(async () => {
    const params = new URLSearchParams({
      fabId,
      product,
      page: String(ledgerPage),
      pageSize: "10",
    });
    if (ledgerQuery) params.set("q", ledgerQuery);
    const response = await fetch(`/api/wafer-lots/execution-ledger?${params}`, { cache: "no-store" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      setLedgerError(payload.error ?? "전체 Lot 실행 원장을 불러오지 못했습니다.");
      return;
    }
    const data = await response.json() as ExecutionLedgerResponse;
    setLedger(data);
    setLedgerError(null);
    setSelectedLedgerLotId((current) => current && data.rows.some((row) => row.lotId === current) ? current : data.rows[0]?.lotId ?? null);
  }, [fabId, ledgerPage, ledgerQuery, product]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => { if (!document.hidden) void load(); }, 6_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [load]);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadLedger(), 0);
    const interval = window.setInterval(() => { if (!document.hidden) void loadLedger(); }, 60_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [loadLedger]);

  useEffect(() => {
    if (!onLiveFoupsChange) return;
    onLiveFoupsChange((states ?? []).map(toLiveFoup));
  }, [states, onLiveFoupsChange]);

  const selectedLedgerLot = ledger?.rows.find((row) => row.lotId === selectedLedgerLotId) ?? null;
  const state = selectedLedgerLot?.watched
    ? (states ?? []).find((candidate) => candidate.lot.foupCode === selectedLedgerLot.foupCode) ?? null
    : null;

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
  const currentProcessCode = state?.currentVisit ? normalizeProcessCode(state.currentVisit.processCode) : undefined;
  const proc = PROCESSES.find((p) => p.code === currentProcessCode);

  return (
    <aside className="rounded-2xl border border-[#D8DDE2] bg-white p-4">
      <div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#0EA5E9]">LOT 실행 추적 · {fabId} · 전체 원장</div>
      <div className="mt-1 text-[9px] font-bold text-[#59636D]">
        활성 {(ledger?.summary.activeTotal ?? occupiedFoup ?? 0).toLocaleString()} Lot · Modeled {(ledger?.summary.modeledTotal ?? 0).toLocaleString()} · Watched {(ledger?.summary.watchedTotal ?? states.length).toLocaleString()}
      </div>
      <div className="mt-1 text-[9px] text-[#B0B8BF]">전체 Lot은 페이지 원장으로 조회하고, Watched 12개만 3D 이동·이벤트 이력을 상세 추적합니다.</div>

      <div className="mt-3 rounded-xl border border-[#E5E9ED] bg-[#FAFBFC] p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#59636D]">전체 활성 LOT 원장</div>
          <div className="font-mono text-[8px] font-bold text-[#8A929A]">{ledger ? `${ledger.total.toLocaleString()}건` : "조회 중"}</div>
        </div>
        <form
          className="mt-2 flex gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            setLedgerPage(1);
            setLedgerQuery(ledgerSearchInput.trim());
          }}
        >
          <input
            value={ledgerSearchInput}
            onChange={(event) => setLedgerSearchInput(event.target.value)}
            placeholder="Lot ID · FOUP ID · Route node 검색"
            className="min-w-0 flex-1 rounded-md border border-[#D8DDE2] bg-white px-2 py-1.5 text-[9px] text-[#303840] outline-none focus:border-[#0EA5E9]"
          />
          <button type="submit" className="rounded-md bg-[#20262D] px-2.5 py-1.5 text-[9px] font-black text-white">검색</button>
          {(ledgerQuery || ledgerSearchInput) && (
            <button type="button" onClick={() => { setLedgerSearchInput(""); setLedgerQuery(""); setLedgerPage(1); }}
              className="rounded-md border border-[#D8DDE2] bg-white px-2 py-1.5 text-[9px] font-bold text-[#59636D]">초기화</button>
          )}
        </form>

        {ledgerError && <div className="mt-2 rounded bg-red-50 px-2 py-1.5 text-[9px] text-red-700">{ledgerError}</div>}
        {!ledger && !ledgerError && <div className="mt-2 py-4 text-center text-[9px] text-[#8A929A]">14,040개 실행 원장 조회 중…</div>}
        {ledger && ledger.rows.length === 0 && <div className="mt-2 py-4 text-center text-[9px] text-[#8A929A]">검색 결과가 없습니다.</div>}
        {ledger && ledger.rows.length > 0 && (
          <div className="mt-2 overflow-hidden rounded-lg border border-[#E5E9ED] bg-white">
            <div className="grid grid-cols-[minmax(0,1fr)_42px_48px_42px] gap-1 border-b border-[#EEF1F4] bg-[#F5F7F9] px-2 py-1 text-[8px] font-black text-[#8A929A]">
              <span>LOT / FOUP</span><span>공정</span><span>진행</span><span>구분</span>
            </div>
            {ledger.rows.map((row) => {
              const selected = row.lotId === selectedLedgerLotId;
              return (
                <button key={row.lotId} type="button"
                  onClick={() => {
                    setSelectedLedgerLotId(row.lotId);
                    setShowHistory(false);
                  }}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_42px_48px_42px] items-center gap-1 border-b border-[#F0F2F4] px-2 py-1.5 text-left last:border-b-0 ${selected ? "bg-sky-50" : "hover:bg-[#FAFBFC]"}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[8px] font-black text-[#303840]">{row.lotId}</span>
                    <span className="block truncate font-mono text-[8px] text-[#8A929A]">{row.foupCode}</span>
                  </span>
                  <span className="text-[8px] font-black text-[#59636D]">{row.processCode}</span>
                  <span className="font-mono text-[8px] font-bold text-[#59636D]">{row.progressPct}%</span>
                  <span className={`rounded px-1 py-0.5 text-center text-[7px] font-black ${row.watched ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600"}`}>
                    {row.watched ? "WATCH" : "MODEL"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {selectedLedgerLot && !selectedLedgerLot.watched && (
          <div className="mt-2 rounded-lg border border-sky-100 bg-white px-2.5 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-mono text-[9px] font-black text-[#20262D]">{selectedLedgerLot.lotId}</div>
                <div className="mt-0.5 truncate font-mono text-[8px] text-[#8A929A]">{selectedLedgerLot.foupCode} · {selectedLedgerLot.routeMasterId}</div>
              </div>
              <span className="shrink-0 rounded bg-[#E9F8F2] px-1.5 py-0.5 text-[7px] font-black text-[#087A55]">{selectedLedgerLot.assignmentStatus ?? "NO ASSIGN"}</span>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[8px]">
              <div><span className="text-[#8A929A]">현재 위치 </span><b className="text-[#414A52]">{selectedLedgerLot.processCode} · {selectedLedgerLot.nodeLabel ?? "-"}</b></div>
              <div><span className="text-[#8A929A]">Operation </span><b className="text-[#414A52]">{selectedLedgerLot.operationCode ?? "GENERAL"}</b></div>
              <div><span className="text-[#8A929A]">Carrier </span><b className="text-[#414A52]">{selectedLedgerLot.carrierState ?? "-"} · {selectedLedgerLot.movementStatus ?? "-"}</b></div>
              <div><span className="text-[#8A929A]">수량 </span><b className="text-[#414A52]">{selectedLedgerLot.waferQty} wafers</b></div>
              <div><span className="text-[#8A929A]">투입 </span><b className="text-[#414A52]">{formatDateTime(selectedLedgerLot.modeledReleaseAt)}</b></div>
              <div><span className="text-[#8A929A]">다음 전이 </span><b className="text-[#414A52]">{formatDateTime(selectedLedgerLot.nextTransitionAt)}</b></div>
            </div>
            {!selectedLedgerLot.watched && <div className="mt-1.5 text-[7px] font-bold text-amber-600">SIMPLIFIED_UNIFORM_DWELL 투영 Lot · 개별 이벤트 애니메이션 없음</div>}
          </div>
        )}

        {ledger && (
          <div className="mt-2 flex items-center justify-between">
            <button type="button" disabled={ledger.page <= 1} onClick={() => setLedgerPage((page) => Math.max(1, page - 1))}
              className="rounded border border-[#D8DDE2] bg-white px-2 py-1 text-[8px] font-black text-[#59636D] disabled:opacity-35">← 이전</button>
            <span className="font-mono text-[8px] font-bold text-[#59636D]">{ledger.page.toLocaleString()} / {ledger.totalPages.toLocaleString()}</span>
            <button type="button" disabled={ledger.page >= ledger.totalPages} onClick={() => setLedgerPage((page) => Math.min(ledger.totalPages, page + 1))}
              className="rounded border border-[#D8DDE2] bg-white px-2 py-1 text-[8px] font-black text-[#59636D] disabled:opacity-35">다음 →</button>
          </div>
        )}
      </div>

      {selectedLedgerLot?.watched && (
        <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[9px] font-black uppercase tracking-[0.08em] text-sky-700">선택 LOT 상세 · WATCHED / 3D LIVE</div>
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[7px] font-black text-sky-700">{selectedLedgerLot.foupCode}</span>
          </div>
          <div className="mt-1 text-[8px] text-[#8A929A]">전체 원장에서 선택한 Lot의 Route 이벤트입니다. 3D에서도 같은 FOUP가 강조됩니다.</div>

          {!state ? (
            <div className="mt-3 text-[10px] text-[#8A929A]">선택 Lot 상세 이력을 불러오는 중…</div>
          ) : (
            <>
              <div className="mt-3 text-sm font-black text-[#20262D]">{state.lot._id}</div>
              <div className="mt-0.5 text-[10px] text-[#8A929A]">
                {state.lot.foupCode} · {selectedLedgerLot.waferQty} wafers · 전체 {state.currentStepIndex}/{state.totalSteps} ({state.totalSteps > 0 ? Math.round(state.currentStepIndex / state.totalSteps * 100) : 0}%)
              </div>

              {state.isDone ? (
                <div className="mt-3 rounded-lg bg-[#E9F8F2] px-3 py-2 text-[11px] font-black text-[#087A55]">
                  라우팅 전체 스텝 완주 — routeMaster 전체를 통과했습니다.
                </div>
              ) : (
                <>
                  <div className="mt-3 text-[11px] font-bold text-[#414A52]">
                    {state.currentVisit && `${state.currentVisit.stage} · ${state.currentVisit.label} · ${currentProcessCode} ${proc?.name ?? ""} (visit ${state.currentVisit.visitIndex + 1}회차)`}
                  </div>
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
                  <div className="mt-1 text-[8px] text-[#B0B8BF]">{state.nodes.length}개 Route 노드 · 칸 너비는 스텝 비중</div>
                </>
              )}

              {error && <div className="mt-3 rounded bg-red-50 px-2 py-1.5 text-[10px] text-red-700">{error}</div>}

              {!state.isDone && (
                <button
                  type="button" disabled={busy} onClick={() => void advance()}
                  className="mt-3 w-full rounded-lg bg-[#0EA5E9] px-3 py-2 text-[11px] font-black text-white disabled:opacity-50"
                >
                  {busy ? "확인 처리 중…" : `다음 스텝 완료 확인${state.nextVisit ? ` (${normalizeProcessCode(state.nextVisit.processCode)} ${state.nextVisit.label} 진입)` : ""}`}
                </button>
              )}

              {state.history.length > 0 && (
                <div className="mt-3">
                  <button type="button" onClick={() => setShowHistory((prev) => !prev)} className="text-[9px] font-bold text-[#0EA5E9] underline">
                    완료 이력 {state.history.length}건 {showHistory ? "▲" : "▼"}
                  </button>
                  {showHistory && (
                    <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto border-t border-[#DDEEF7] pt-1">
                      {[...state.history].reverse().map((event) => (
                        <div key={event._id} className="text-[9px] text-[#8A929A]">
                          {event.completedAt ? new Date(event.completedAt).toLocaleTimeString("ko-KR") : "-"} · {normalizeProcessCode(event.processCode)} · {event.triggeredBy.type}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
