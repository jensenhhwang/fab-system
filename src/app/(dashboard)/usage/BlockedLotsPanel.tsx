"use client";

import { useCallback, useEffect, useState } from "react";

type BlockedGroup = {
  stepIndex: number;
  lotCount: number;
  waferQty: number;
  waitingMinutes: number;
  materials: { code: string; name: string; coverageDays: number | null; ropDays: number | null }[];
};

export default function BlockedLotsPanel() {
  const [items, setItems] = useState<BlockedGroup[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/twin/wafer-lots/material-blocked", { cache: "no-store", signal });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "자재차단 로트를 불러오지 못했습니다.");
      setItems(payload.items ?? []);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => { await load(controller.signal); };
    void run();
    const interval = window.setInterval(() => void run(), 15_000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [load]);

  if (items.length === 0) return null;

  return (
    <div className="rounded-2xl border bg-white p-4" style={{ borderColor: "#B3D6F5", boxShadow: "var(--shadow-1)" }}>
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[#EAF4FF] px-2 py-0.5 text-[10px] font-extrabold text-[#0956B0]">자재차단</span>
        <h2 className="text-sm font-bold text-[#141413]">이자재 판정 — COVERAGE_CRITICAL 자재를 다음 공정에 쓰는 로트가 멈춰 있습니다</h2>
      </div>
      <p className="mt-1 text-[11px] text-[#888]">
        재고가 회복되면 사람 개입 없이 다음 tick에 자동으로 다시 진행됩니다.
      </p>
      {error && <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">{error}</div>}
      <div className="mt-3 space-y-2">
        {items.map((g) => (
          <div key={g.stepIndex} className="rounded-xl px-3 py-2.5" style={{ background: "#FAFAFA" }}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-xs font-bold text-[#141413]">
                  스텝 {g.stepIndex} 대기 · {g.lotCount.toLocaleString("ko-KR")}로트
                </div>
                <div className="mt-0.5 text-[11px] text-[#888]">
                  {g.waferQty.toLocaleString("ko-KR")} 웨이퍼 · {g.waitingMinutes}분째 대기
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {g.materials.map((m) => (
                  <span key={m.code} className="rounded-full px-1.5 py-0.5 text-[9px] font-extrabold" style={{ background: "#FFF1F3", color: "#C01048" }}>
                    {m.name} ({m.code}) {m.coverageDays !== null ? `D-${Math.max(0, Math.floor(m.coverageDays))}` : "결품"}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
