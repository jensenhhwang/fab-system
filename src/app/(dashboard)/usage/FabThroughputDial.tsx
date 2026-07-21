"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FabId } from "@/lib/fab-domain";
import type { FoupFleetProjection } from "@/lib/foup-wip-model";
import { M20_PRODUCTION_SCENARIOS, targetWipCount } from "@/lib/fab-scenario";

type ScenarioResponse = {
  scenario: { id: FabId; nominalWspm: number; utilization: number };
  metrics: { utilizedWspm: number; effectiveWspm: number; dailyWaferStarts: number };
  targetWip: number | null;
};
type AggregateWipResponse = {
  targetWip: number; currentWip: number; aggregateWip: number; visualWip: number;
  occupiedTarget: number; downstreamWipEquivalent: number; downstreamStatus: "NOT_BOOTSTRAPPED";
  unit: "FOUP_EQUIVALENT"; readOnly: true;
};
type LotLookupResponse = {
  foupCode: string; status: string; cohort: "AGGREGATE" | "LEGACY_AGGREGATE" | "MODELED_FOUP" | "WATCHED" | "VISUAL";
  nodeId: string | null; nodeLabel: string | null;
  stepIndex: number | null; totalSteps: number; lastEventAt: string | null;
};

export default function FabThroughputDial({ fabId, foupFleet }: { fabId: FabId; foupFleet?: FoupFleetProjection | null }) {
  const [scenario, setScenario] = useState<ScenarioResponse | null>(null);
  const [wip, setWip] = useState<AggregateWipResponse | null>(null);
  const [sliderValue, setSliderValue] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupCode, setLookupCode] = useState("");
  const [lookupResult, setLookupResult] = useState<LotLookupResponse | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const flashTimer = useRef<number | null>(null);

  const loadScenario = useCallback(async () => {
    const response = await fetch(`/api/fab-scenario/${fabId}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as ScenarioResponse;
    setScenario(data);
  }, [fabId]);

  const loadWip = useCallback(async () => {
    const response = await fetch(`/api/wafer-lots/aggregate-wip?fabId=${fabId}&product=HBM`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as AggregateWipResponse;
    setWip(data);
  }, [fabId]);

  useEffect(() => {
    const scenarioInitial = window.setTimeout(() => void loadScenario(), 0);
    const interval = window.setInterval(() => { if (!document.hidden) void loadWip(); }, 6_000);
    const wipInitial = window.setTimeout(() => void loadWip(), 0);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(scenarioInitial);
      window.clearTimeout(wipInitial);
    };
  }, [loadScenario, loadWip]);

  const commitUtilization = async (value: number) => {
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/fab-scenario/${fabId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utilization: value }),
      });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? "저장 실패"); }
      const data = await response.json() as ScenarioResponse;
      setScenario(data);
      void loadWip();
      setJustSaved(true);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setJustSaved(false), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);

  const runLookup = async () => {
    const code = lookupCode.trim();
    if (!code) return;
    setLookingUp(true); setLookupError(null); setLookupResult(null);
    try {
      const response = await fetch(`/api/wafer-lots/lookup?fabId=${fabId}&product=HBM&foupCode=${encodeURIComponent(code)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "조회 실패");
      setLookupResult(body as LotLookupResponse);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "조회 실패");
    } finally {
      setLookingUp(false);
    }
  };

  if (fabId !== "M20") return null;
  if (!scenario) return <div className="rounded-xl border border-[#D8DDE2] bg-white p-4 text-[11px] text-[#999]">가동 정보 로딩 중…</div>;

  const displayUtilization = sliderValue ?? scenario.scenario.utilization;
  const previewValue = sliderValue !== null && sliderValue !== scenario.scenario.utilization ? sliderValue : null;
  const isPreviewing = previewValue !== null;
  const previewUtilizedWspm = previewValue !== null ? scenario.scenario.nominalWspm * previewValue : scenario.metrics.utilizedWspm;
  const targetWip = previewValue !== null
    ? targetWipCount(previewUtilizedWspm, M20_PRODUCTION_SCENARIOS.NORMAL.cycleTimeDays)
    : (scenario.targetWip ?? 0);
  const occupiedTarget = foupFleet?.target.occupied ?? wip?.occupiedTarget ?? 0;
  const currentWip = foupFleet?.actual.occupied ?? wip?.currentWip ?? 0;
  const wipRatio = occupiedTarget > 0 ? Math.min(1, currentWip / occupiedTarget) : 0;
  const wipColor = wipRatio > 0.9 ? "#00B96B" : wipRatio > 0.5 ? "#F7A600" : "#EA002C";

  return (
    <div className="rounded-xl border border-[#D8DDE2] bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-black uppercase tracking-[0.08em] text-[#7D8790]">FAB THROUGHPUT · {fabId}</div>
        {saving && <span className="text-[9px] text-[#999]">저장 중…</span>}
        {!saving && isPreviewing && <span className="text-[9px] font-bold text-sky-600">미리보기 · 손 떼면 저장</span>}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <input
          type="range" min={0.1} max={1} step={0.01} value={displayUtilization}
          onChange={(event) => setSliderValue(Number(event.target.value))}
          onMouseUp={(event) => void commitUtilization(Number((event.target as HTMLInputElement).value))}
          onTouchEnd={(event) => void commitUtilization(Number((event.target as HTMLInputElement).value))}
          className="flex-1"
        />
        <span className={`w-14 text-right font-mono text-sm font-black transition-colors ${isPreviewing ? "text-sky-600" : "text-[#20262D]"}`}>{Math.round(displayUtilization * 100)}%</span>
      </div>
      <div className="mt-1 text-[9px] leading-4 text-[#8A929A]">가동률(Utilization)을 조절하면 아래 WSPM·목표 WIP가 즉시 재계산됩니다.</div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-[10px]">
        <div>
          <div className="text-[#8A929A]">가동 투입 WSPM</div>
          <div className={`mt-0.5 rounded font-mono text-sm font-black text-[#303840] transition-colors duration-700 ${justSaved ? "bg-sky-100" : "bg-transparent"} ${isPreviewing ? "text-sky-600" : ""}`}>{Math.round(previewUtilizedWspm).toLocaleString()}</div>
        </div>
        <div>
          <div className="text-[#8A929A]">105일 참조 목표 WIP</div>
          <div className={`mt-0.5 rounded font-mono text-sm font-black text-[#303840] transition-colors duration-700 ${justSaved ? "bg-sky-100" : "bg-transparent"} ${isPreviewing ? "text-sky-600" : ""}`}>{targetWip.toLocaleString()} FOUP-eq</div>
        </div>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-[#8A929A]">Occupied FOUP · Wafer 구간</span>
          <span className="font-mono font-black" style={{ color: wipColor }}>{currentWip.toLocaleString()} / {occupiedTarget.toLocaleString()}</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#F2F4F6]">
          <div className="h-full rounded-full transition-all" style={{ width: `${wipRatio * 100}%`, background: wipColor }} />
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-[#F7F9FA] p-2 text-[9px]">
        <div><div className="text-[#8A929A]">Physical Fleet</div><div className="font-mono font-black text-[#303840]">{(foupFleet?.actual.physicalFleet ?? 0).toLocaleString()}</div></div>
        <div><div className="text-[#8A929A]">Reserve</div><div className="font-mono font-black text-[#303840]">{(foupFleet?.actual.reserve ?? 0).toLocaleString()}</div></div>
        <div><div className="text-[#8A929A]">Watched</div><div className="font-mono font-black text-sky-600">{(foupFleet?.actual.watched ?? wip?.visualWip ?? 0).toLocaleString()}</div></div>
      </div>
      <div className="mt-2 text-[9px] leading-4 text-[#8A929A]">
        전체 105일 WIP는 {targetWip.toLocaleString()} FOUP-eq입니다. P10 이후 {(wip?.downstreamWipEquivalent ?? 0).toLocaleString()} lot-eq는 아직 `NOT_BOOTSTRAPPED`이며 실물 FOUP 수가 아닙니다.
      </div>
      {error && <div className="mt-2 text-[10px] font-bold text-[#EA002C]">{error}</div>}

      <div className="mt-4 border-t border-[#EEF1F4] pt-3">
        <div className="text-[10px] font-black uppercase tracking-[0.08em] text-[#7D8790]">로트 조회</div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text" value={lookupCode}
            onChange={(event) => setLookupCode(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void runLookup(); }}
            placeholder="FOUP-01 또는 FOUP-M20-00001"
            className="flex-1 rounded-lg border border-[#D8DDE2] px-2 py-1.5 text-[11px] font-mono"
          />
          <button
            type="button" onClick={() => void runLookup()} disabled={lookingUp || !lookupCode.trim()}
            className="rounded-lg bg-[#20262D] px-3 py-1.5 text-[10px] font-black text-white disabled:opacity-40"
          >
            {lookingUp ? "조회 중…" : "조회"}
          </button>
        </div>
        {lookupError && <div className="mt-2 text-[10px] font-bold text-[#EA002C]">{lookupError}</div>}
        {lookupResult && (
          <div className="mt-2 rounded-lg bg-[#F7F9FA] p-2.5 text-[10px]">
            <div className="flex items-center justify-between">
              <span className="font-mono font-black text-[#20262D]">{lookupResult.foupCode}</span>
              <span className="rounded bg-[#EEF1F4] px-1.5 py-0.5 text-[9px] font-black text-[#59636D]">{lookupResult.cohort}</span>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <div><span className="text-[#8A929A]">상태</span> <span className="font-bold">{lookupResult.status}</span></div>
              <div><span className="text-[#8A929A]">공정</span> <span className="font-bold">{lookupResult.nodeLabel ?? "—"}</span></div>
              <div><span className="text-[#8A929A]">진행</span> <span className="font-mono font-bold">{lookupResult.stepIndex ?? "—"} / {lookupResult.totalSteps}</span></div>
              <div><span className="text-[#8A929A]">최근 이벤트</span> <span className="font-mono font-bold">{lookupResult.lastEventAt ? new Date(lookupResult.lastEventAt).toLocaleTimeString() : "—"}</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
