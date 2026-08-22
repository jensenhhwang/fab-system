"use client";

import { useCallback, useEffect, useState } from "react";

type InboundHoldItem = {
  id: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  qty: number;
  orderedAt: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  warehouseUtilization: number | null;
  coverageDays: number | null;
  ropDays: number | null;
  waitingMinutes: number;
};

function capacityColor(pct: number | null): { text: string; bar: string; bg: string } {
  if (pct === null) return { text: "#999", bar: "#D0D5DD", bg: "#F1F1F0" };
  if (pct >= 100) return { text: "#C01048", bar: "#E11D48", bg: "#FFF1F3" };
  if (pct >= 80) return { text: "#B54708", bar: "#F59E0B", bg: "#FFFAEB" };
  return { text: "#087A55", bar: "#10B981", bg: "#F3FBF7" };
}

function coverageChip(coverageDays: number | null, ropDays: number | null): { label: string; color: string; bg: string } {
  if (coverageDays === null) return { label: "소모율 미확정", color: "#999", bg: "#F1F1F0" };
  if (coverageDays < 5) return { label: `D-${Math.max(0, Math.floor(coverageDays))} 결품위험`, color: "#C01048", bg: "#FFF1F3" };
  if (ropDays !== null && coverageDays < ropDays) return { label: `D-${Math.floor(coverageDays)} 주의`, color: "#B54708", bg: "#FFFAEB" };
  return { label: `여유 D-${Math.floor(coverageDays)}`, color: "#087A55", bg: "#F3FBF7" };
}

export default function InboundHoldPanel() {
  const [items, setItems] = useState<InboundHoldItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/twin/purchase-orders/pending-inbound", { cache: "no-store", signal });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "입고 보류 목록을 불러오지 못했습니다.");
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

  async function release(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/twin/purchase-orders/${encodeURIComponent(id)}/inbound-release`, { method: "POST" });
      if (!res.ok) { const p = await res.json().catch(() => ({})); throw new Error(p.error ?? "처리 실패"); }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "처리 실패");
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) return null;

  return (
    <div className="rounded-2xl border bg-white p-4" style={{ borderColor: "#FDA29B", boxShadow: "var(--shadow-1)" }}>
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[#FFF1F3] px-2 py-0.5 text-[10px] font-extrabold text-[#C01048]">입고 보류</span>
        <h2 className="text-sm font-bold text-[#141413]">박물류 판정 — 목적창고 용량초과로 자동 입고가 보류된 화물</h2>
      </div>
      <p className="mt-1 text-[11px] text-[#888]">
        이미 도착한 화물입니다. 창고 여유를 확인한 뒤 반영하세요 — 사람이 확인해야 실제 재고에 반영됩니다.
      </p>
      {error && <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">{error}</div>}
      <div className="mt-3 space-y-2">
        {items.map((item) => {
          const cap = capacityColor(item.warehouseUtilization);
          const cov = coverageChip(item.coverageDays, item.ropDays);
          const stale = item.waitingMinutes >= 60;
          return (
            <div
              key={item.id}
              className="rounded-xl px-3 py-2.5"
              style={{ background: stale ? "#FFF7F8" : "#FAFAFA" }}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-[#141413]">
                    {item.materialName} <span className="text-[#999]">({item.materialCode})</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#888]">
                    {Math.round(item.qty).toLocaleString("ko-KR")} {item.unit} · 목적창고 {item.warehouseName ?? item.warehouseCode ?? "—"}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="rounded-full px-1.5 py-0.5 text-[9px] font-extrabold" style={{ background: cov.bg, color: cov.color }}>{cov.label}</span>
                  <span className="text-[11px] font-bold" style={{ color: stale ? "#C01048" : "#999" }}>{item.waitingMinutes}분 대기</span>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EEE]">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, item.warehouseUtilization ?? 0)}%`, background: cap.bar }} />
                </div>
                <span className="text-[10px] font-bold" style={{ color: cap.text }}>
                  {item.warehouseUtilization !== null ? `${item.warehouseUtilization}%` : "—"} (게이팅 시점 기준)
                </span>
              </div>
              <div className="mt-2 flex items-center justify-end gap-2">
                {item.warehouseCode && (
                  <a href={`/warehouse/${item.warehouseCode}`} className="text-[11px] font-bold text-[#0078D4]">창고 상세 →</a>
                )}
                <button
                  disabled={busyId === item.id}
                  onClick={() => void release(item.id)}
                  className="rounded-lg bg-[#0078D4] px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
                >
                  입고 반영
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
