"use client";
import { useCallback, useEffect, useState } from "react";

type MaterialRow = {
  materialId: string; onHand: number; avgDailyBurn: number; ropDays: number; rop: number;
  inTransit: { poId: string; qty: number; etaAt: string }[]; recentBurn: number;
};
type EngineData = { status: "RUNNING" | "PAUSED"; lastTickAt: string; materials: MaterialRow[] };

export function TwinEnginePanel() {
  const [data, setData] = useState<EngineData | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/twin/engine");
    if (res.ok) setData(await res.json());
  }, []);
  const toggle = useCallback(async (action: "start" | "pause") => {
    await fetch("/api/twin/engine", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }) });
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [refresh]);

  if (!data) return <div className="rounded-lg border p-4 text-sm text-gray-500">트윈 엔진 로딩…</div>;

  return (
    <section className="rounded-lg border p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">트윈 물리 엔진 · 자재 실시간 현황</h2>
        <button
          onClick={() => toggle(data.status === "RUNNING" ? "pause" : "start")}
          className={`rounded px-3 py-1 text-sm ${data.status === "RUNNING" ? "bg-emerald-600 text-white" : "bg-gray-300"}`}
        >
          {data.status === "RUNNING" ? "● 가동 중 (일시정지)" : "▷ 시작"}
        </button>
      </header>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.materials.map((m) => {
          const low = m.rop > 0 && m.onHand < m.rop;
          return (
            <div key={m.materialId} className={`rounded border p-3 text-sm ${low ? "border-amber-400 bg-amber-50" : ""}`}>
              <div className="flex justify-between font-medium">
                <span>{m.materialId}</span>
                <span className={low ? "text-amber-700" : ""}>{Math.round(m.onHand).toLocaleString()}</span>
              </div>
              <div className="mt-1 text-xs text-gray-600">
                소모 {m.avgDailyBurn.toFixed(1)}/일 · ROP {Math.round(m.rop).toLocaleString()}
              </div>
              {m.inTransit.length > 0 && (
                <div className="mt-1 text-xs text-blue-700">
                  입고 중: {m.inTransit.map((po) => `${Math.round(po.qty).toLocaleString()} (ETA ${new Date(po.etaAt).toLocaleDateString()})`).join(", ")}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
