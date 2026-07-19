"use client";

import { useCallback, useEffect, useState } from "react";
import type { FabId } from "@/lib/fab-domain";

type ScenarioResponse = {
  scenario: { id: FabId; nominalWspm: number; utilization: number };
  metrics: { utilizedWspm: number; effectiveWspm: number; dailyWaferStarts: number };
  targetWip: number | null;
};
type AggregateWipResponse = { targetWip: number; currentWip: number; created: number; advanced: number; completed: number };

export default function FabThroughputDial({ fabId }: { fabId: FabId }) {
  const [scenario, setScenario] = useState<ScenarioResponse | null>(null);
  const [wip, setWip] = useState<AggregateWipResponse | null>(null);
  const [sliderValue, setSliderValue] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    void loadScenario();
    const interval = window.setInterval(() => { if (!document.hidden) void loadWip(); }, 6_000);
    const initial = window.setTimeout(() => void loadWip(), 0);
    return () => { window.clearInterval(interval); window.clearTimeout(initial); };
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  if (fabId !== "M20") return null;
  if (!scenario) return <div className="rounded-xl border border-[#D8DDE2] bg-white p-4 text-[11px] text-[#999]">가동 정보 로딩 중…</div>;

  const displayUtilization = sliderValue ?? scenario.scenario.utilization;
  const targetWip = scenario.targetWip ?? 0;
  const currentWip = wip?.currentWip ?? 0;
  const wipRatio = targetWip > 0 ? Math.min(1, currentWip / targetWip) : 0;
  const wipColor = wipRatio > 0.9 ? "#00B96B" : wipRatio > 0.5 ? "#F7A600" : "#EA002C";

  return (
    <div className="rounded-xl border border-[#D8DDE2] bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-black uppercase tracking-[0.08em] text-[#7D8790]">FAB THROUGHPUT · {fabId}</div>
        {saving && <span className="text-[9px] text-[#999]">저장 중…</span>}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <input
          type="range" min={0.1} max={1} step={0.01} value={displayUtilization}
          onChange={(event) => setSliderValue(Number(event.target.value))}
          onMouseUp={(event) => void commitUtilization(Number((event.target as HTMLInputElement).value))}
          onTouchEnd={(event) => void commitUtilization(Number((event.target as HTMLInputElement).value))}
          className="flex-1"
        />
        <span className="w-14 text-right font-mono text-sm font-black text-[#20262D]">{Math.round(displayUtilization * 100)}%</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-[10px]">
        <div>
          <div className="text-[#8A929A]">유효 WSPM</div>
          <div className="mt-0.5 font-mono text-sm font-black text-[#303840]">{Math.round(scenario.metrics.utilizedWspm).toLocaleString()}</div>
        </div>
        <div>
          <div className="text-[#8A929A]">목표 WIP</div>
          <div className="mt-0.5 font-mono text-sm font-black text-[#303840]">{targetWip.toLocaleString()}개</div>
        </div>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-[#8A929A]">현재 WIP</span>
          <span className="font-mono font-black" style={{ color: wipColor }}>{currentWip.toLocaleString()} / {targetWip.toLocaleString()}</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#F2F4F6]">
          <div className="h-full rounded-full transition-all" style={{ width: `${wipRatio * 100}%`, background: wipColor }} />
        </div>
      </div>
      {error && <div className="mt-2 text-[10px] font-bold text-[#EA002C]">{error}</div>}
    </div>
  );
}
