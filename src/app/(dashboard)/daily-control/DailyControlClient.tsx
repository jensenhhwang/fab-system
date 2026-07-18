"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { dailyPlanKWafer } from "@/lib/fab-scenario";

type Product = "HBM" | "DRAM" | "NAND";
type FabId = "M20" | "M21" | "M22";
type MaterialStatus = "critical" | "warning" | "ok" | "safe";

type ProductionActualRevisionView = { producedQty: number; note?: string; reason?: string; enteredBy: string; recordedAt: string };
type ProductionActualView = {
  _id: string; fabId: FabId; product: Product; date: string; producedQty: number; planQty: number;
  unit: "K_WAFER"; note?: string; source: "MANUAL" | "MES_MASTER"; enteredBy: string; confirmedAt: string;
  revisions: ProductionActualRevisionView[];
};

type MaterialUsageByProductView = { product: Product; fabId: FabId; producedQty: number | null; planQty: number; coefficient: number; usage: number; confirmed: boolean };
type LiveMaterialRowView = {
  materialId: string; code: string; name: string; unit: string; category: string;
  current: number; safetyStock: number; ropDays: number; todayUsage: number; projectedClose: number; closeDoh: number;
  status: MaterialStatus; statusReason: string;
  usageByProduct: MaterialUsageByProductView[]; sharedAcrossFabs: boolean; allConfirmed: boolean;
};

type RerouteView = { _id: string; materialId: string; fromFabId: FabId; toFabId: FabId; quantity: number; unit: string; reason?: string; decidedBy: string; decidedAt: string };

type DailyControlResponse = { date: string; rows: LiveMaterialRowView[]; actuals: Record<Product, ProductionActualView | null> };

const FAB_IDS: FabId[] = ["M20", "M21", "M22"];
const FAB_TO_PRODUCT: Record<FabId, Product> = { M20: "HBM", M21: "DRAM", M22: "NAND" };
const FAB_LABEL: Record<FabId, string> = { M20: "M20 · HBM", M21: "M21 · DRAM", M22: "M22 · NAND" };
const PRODUCT_LABEL: Record<Product, string> = { HBM: "HBM", DRAM: "DRAM", NAND: "NAND" };

const STATUS: Record<MaterialStatus, { label: string; color: string; bg: string }> = {
  critical: { label: "위급", color: "#EA002C", bg: "#FFF0F2" },
  warning: { label: "경보", color: "#B97500", bg: "#FFF8E6" },
  ok: { label: "적정", color: "#00875A", bg: "#E6FAF1" },
  safe: { label: "여유", color: "#0078D4", bg: "#E8F3FF" },
};

const nf = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });

function StatusBadge({ status }: { status: MaterialStatus }) {
  const style = STATUS[status];
  return <span className="inline-flex rounded-full px-2 py-1 text-[10px] font-extrabold" style={{ color: style.color, background: style.bg }}>{style.label}</span>;
}

function KpiCard({ label, value, note, tone = "#141413" }: { label: string; value: string; note: string; tone?: string }) {
  return <div className="rounded-2xl border bg-white p-4" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
    <div className="text-[11px] font-bold tracking-[0.04em] text-[#777]">{label}</div>
    <div className="mt-2 text-2xl font-black tracking-tight" style={{ color: tone }}>{value}</div>
    <div className="mt-1 text-[11px] text-[#888]">{note}</div>
  </div>;
}

function ProductionActualCard({ product, actual, busy, onConfirm }: {
  product: Product; actual: ProductionActualView | null; busy: boolean;
  onConfirm: (product: Product, producedQty: number, note: string, reason?: string) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState(actual ? String(actual.producedQty) : "");
  const [note, setNote] = useState(actual?.note ?? "");
  const [showHistory, setShowHistory] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const planQty = actual?.planQty ?? dailyPlanKWafer(product);
  const rate = planQty > 0 && draft !== "" ? (Number(draft) / planQty) * 100 : null;

  const submit = async () => {
    const qty = Number(draft);
    if (!Number.isFinite(qty) || qty < 0) { setLocalError("0 이상의 숫자를 입력해주세요."); return; }
    let reason: string | undefined;
    if (actual) {
      reason = window.prompt(`이미 확정된 ${PRODUCT_LABEL[product]} 실적을 ${actual.producedQty}K → ${qty}K로 수정합니다. 수정 사유를 입력해주세요.`) ?? undefined;
      if (!reason?.trim()) { setLocalError("수정 사유 입력이 취소되어 저장하지 않았습니다."); return; }
    }
    setLocalError(null);
    const error = await onConfirm(product, qty, note, reason);
    if (error) setLocalError(error);
  };

  return <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
    <div className="flex items-start justify-between">
      <div>
        <div className="text-xs font-black">{PRODUCT_LABEL[product]}</div>
        <div className="mt-1 text-[9px] text-[#999]">{actual ? `확정됨 · ${new Date(actual.confirmedAt).toLocaleTimeString("ko-KR")}` : "미확정"}</div>
      </div>
      <div className="text-right">
        <div className="text-[9px] text-[#999]">계획 {planQty.toFixed(1)}K wafer</div>
        {rate !== null && <b style={{ color: rate > 105 ? "#EA002C" : rate >= 95 ? "#00875A" : "#B97500" }}>{rate.toFixed(1)}%</b>}
      </div>
    </div>
    <div className="mt-3 flex items-center gap-2">
      <input
        type="number" min={0} step={0.1} value={draft} onChange={(event) => setDraft(event.target.value)}
        className="w-24 rounded-lg border px-2 py-1.5 text-sm font-bold" style={{ borderColor: "var(--border)" }}
      />
      <span className="text-[10px] text-[#999]">K wafer</span>
    </div>
    <input
      type="text" value={note} onChange={(event) => setNote(event.target.value)} placeholder="비고 (선택)"
      className="mt-2 w-full rounded-lg border px-2 py-1.5 text-[11px]" style={{ borderColor: "var(--border)" }}
    />
    {localError && <div className="mt-2 text-[10px] font-bold text-[#EA002C]">{localError}</div>}
    <button
      type="button" disabled={busy} onClick={() => void submit()}
      className="mt-3 w-full rounded-lg bg-[#141413] px-3 py-2 text-[11px] font-black text-white disabled:opacity-50"
    >
      {actual ? "수정 저장" : "오늘 실적 확정 저장"}
    </button>
    {actual && actual.revisions.length > 1 && <div className="mt-2">
      <button type="button" onClick={() => setShowHistory((prev) => !prev)} className="text-[9px] font-bold text-[#5E7A90] underline">
        입력 이력 {actual.revisions.length}건 {showHistory ? "▲" : "▼"}
      </button>
      {showHistory && <div className="mt-1 space-y-0.5">
        {[...actual.revisions].reverse().map((revision, index) => (
          <div key={index} className="text-[9px] text-[#999]">
            {new Date(revision.recordedAt).toLocaleString("ko-KR")} · {revision.producedQty}K{revision.reason ? ` · ${revision.reason}` : ""}
          </div>
        ))}
      </div>}
    </div>}
  </div>;
}

function MaterialTable({ rows, selectedId, onSelect }: { rows: LiveMaterialRowView[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return <div className="overflow-hidden rounded-2xl border bg-white" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
    <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
      <div><div className="text-sm font-extrabold">자재별 운영 현황</div><div className="mt-0.5 text-[11px] text-[#888]">행을 선택하면 상세 근거가 함께 바뀝니다.</div></div>
      <div className="text-[10px] font-bold text-[#777]">{rows.length}개 자재 · 실측 현재고 + MODELED_BASELINE 사용량</div>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-xs">
        <thead className="bg-[#F8F6F4] text-[10px] font-bold text-[#777]"><tr>
          <th className="px-4 py-3 text-left">자재</th><th className="px-3 py-3 text-right">현재고</th><th className="px-3 py-3 text-right">오늘 사용량</th><th className="px-3 py-3 text-right">마감 예상</th><th className="px-3 py-3 text-right">DOH</th><th className="px-4 py-3 text-center">상태</th>
        </tr></thead>
        <tbody>{rows.map((row) => <tr key={row.materialId} onClick={() => onSelect(row.materialId)} className="cursor-pointer border-t transition-colors hover:bg-[#FFF8F8]" style={{ borderColor: "var(--border)", background: selectedId === row.materialId ? "#FFF5F6" : undefined }}>
          <td className="px-4 py-3"><div className="flex items-center gap-2"><span className="h-7 w-1 rounded-full" style={{ background: STATUS[row.status].color }} /><div><div className="font-bold">{row.name}{!row.allConfirmed && <span className="ml-1 rounded-full bg-[#F3E8FF] px-1.5 py-0.5 text-[8px] font-black text-[#6D28D9]">미확정 계획치</span>}</div><div className="font-mono text-[9px] text-[#999]">{row.code} · {row.unit}</div></div></div></td>
          <td className="px-3 py-3 text-right font-black tabular-nums">{nf.format(row.current)}</td>
          <td className="px-3 py-3 text-right font-bold tabular-nums text-[#C45C19]">−{nf.format(row.todayUsage)}</td>
          <td className="px-3 py-3 text-right font-black tabular-nums">{nf.format(row.projectedClose)}</td>
          <td className="px-3 py-3 text-right font-bold tabular-nums">{Number.isFinite(row.closeDoh) ? `${row.closeDoh.toFixed(1)}일` : "—"}</td>
          <td className="px-4 py-3 text-center"><StatusBadge status={row.status} /><div className="mt-1 whitespace-nowrap text-[9px] text-[#888]">{row.statusReason}</div></td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

function DetailPanel({ row }: { row: LiveMaterialRowView | undefined }) {
  if (!row) return <aside className="rounded-2xl border bg-white p-5 text-[11px] text-[#888]" style={{ borderColor: "var(--border)" }}>자재를 선택하세요.</aside>;
  return <aside className="rounded-2xl border bg-white" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
    <div className="border-b p-5" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-bold text-[#999]">MATERIAL TRACE</div><div className="mt-1 text-lg font-black">{row.name}</div><div className="font-mono text-[10px] text-[#999]">{row.code}</div></div><StatusBadge status={row.status} /></div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-[#F8F6F4] p-3"><div className="text-[9px] text-[#888]">실측 현재고</div><div className="mt-1 text-lg font-black">{nf.format(row.current)} {row.unit}</div></div>
        <div className="rounded-xl bg-[#FFF3EA] p-3"><div className="text-[9px] text-[#9A5A2C]">마감 예상</div><div className="mt-1 text-lg font-black text-[#C45C19]">{nf.format(row.projectedClose)} {row.unit}</div></div>
      </div>
      <div className="mt-3 grid grid-cols-3 text-center text-[10px]">
        <div><span className="text-[#999]">안전재고</span><b className="mt-1 block">{row.safetyStock}</b></div>
        <div className="border-x" style={{ borderColor: "var(--border)" }}><span className="text-[#999]">ROP</span><b className="mt-1 block">{row.ropDays}일</b></div>
        <div><span className="text-[#999]">마감 DOH</span><b className="mt-1 block">{Number.isFinite(row.closeDoh) ? `${row.closeDoh.toFixed(1)}일` : "—"}</b></div>
      </div>
      {row.sharedAcrossFabs && <div className="mt-3 rounded-xl bg-[#EEF7FF] p-3 text-[10px] text-[#275879]">{row.usageByProduct.length}개 팹이 함께 사용하는 공용자재입니다. 전체 통합 탭에서 재배정할 수 있습니다.</div>}
    </div>
    <div className="p-5">
      <div className="flex items-center justify-between"><b className="text-sm">생산량 → 자재 사용량</b><span className="text-[9px] text-[#999]">실적(또는 미확정 계획치) × 원단위</span></div>
      <div className="mt-3 space-y-2">{row.usageByProduct.map((item) => (
        <div key={item.product} className="grid grid-cols-[70px_1fr_auto] items-center gap-2 text-[10px]">
          <b>{FAB_LABEL[item.fabId]}</b>
          <div className="h-1.5 overflow-hidden rounded-full bg-[#EEE]"><div className="h-full rounded-full bg-[#F47725]" style={{ width: `${Math.min(100, (item.usage / Math.max(...row.usageByProduct.map((entry) => entry.usage), 1)) * 100)}%` }} /></div>
          <span className="tabular-nums text-[#777]">
            {(item.producedQty ?? item.planQty).toFixed(1)}K × <span title="MODELED_BASELINE: processUsage 월간 소요량에서 역산한 원단위, 실측 아님" className="rounded bg-[#EEE] px-1 text-[8px] font-bold text-[#888]">MODELED {item.coefficient.toFixed(2)}</span> = <b className="text-[#C45C19]">{item.usage.toFixed(1)} {row.unit}</b>
            {!item.confirmed && <span className="ml-1 text-[8px] text-[#6D28D9]">(계획치)</span>}
          </span>
        </div>
      ))}</div>
      <div className="mt-3 border-t pt-3 text-right text-xs" style={{ borderColor: "var(--border)" }}>오늘 파생 사용량 합계 <b>{row.todayUsage.toFixed(1)} {row.unit}</b></div>
    </div>
  </aside>;
}

function CrossFabPanel({ rows, reroutes, busy, onReroute }: {
  rows: LiveMaterialRowView[]; reroutes: RerouteView[]; busy: boolean;
  onReroute: (materialId: string, fromFabId: FabId, toFabId: FabId, quantity: number, unit: string, reason: string) => Promise<string | null>;
}) {
  const shared = rows.filter((row) => row.sharedAcrossFabs);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ fromFabId: FabId; toFabId: FabId; quantity: string; reason: string }>({ fromFabId: "M20", toFabId: "M21", quantity: "", reason: "" });
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async (row: LiveMaterialRowView) => {
    const quantity = Number(form.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) { setLocalError("재배정 수량은 0보다 커야 합니다."); return; }
    if (form.fromFabId === form.toFabId) { setLocalError("출발 팹과 도착 팹이 같습니다."); return; }
    setLocalError(null);
    const error = await onReroute(row.materialId, form.fromFabId, form.toFabId, quantity, row.unit, form.reason);
    if (error) { setLocalError(error); return; }
    setOpenId(null);
    setForm({ fromFabId: "M20", toFabId: "M21", quantity: "", reason: "" });
  };

  return <div className="rounded-2xl border bg-white" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
    <div className="border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
      <div className="text-sm font-extrabold">전체 통합 · 공용자재 크로스뷰</div>
      <div className="mt-1 text-[11px] text-[#888]">{shared.length}개 공용자재 · 중앙 창고는 fabId 없는 공용 풀이라 재배정은 실물 이동이 아니라 우선순위 결정 기록입니다.</div>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-xs">
        <thead className="bg-[#F8F6F4] text-[10px] font-bold text-[#777]"><tr>
          <th className="px-4 py-3 text-left">자재</th>
          {FAB_IDS.map((fabId) => <th key={fabId} className="px-3 py-3 text-right">{FAB_LABEL[fabId]} 사용</th>)}
          <th className="px-3 py-3 text-right">현재고 / DOH</th>
          <th className="px-4 py-3 text-center">조치</th>
        </tr></thead>
        <tbody>{shared.map((row) => {
          const usageByFab = new Map(row.usageByProduct.map((item) => [item.fabId, item.usage]));
          return <Fragment key={row.materialId}>
            <tr className="border-t" style={{ borderColor: "var(--border)" }}>
              <td className="px-4 py-3"><div className="font-bold">{row.name}</div><div className="font-mono text-[9px] text-[#999]">{row.code} · {row.unit}</div></td>
              {FAB_IDS.map((fabId) => <td key={fabId} className="px-3 py-3 text-right tabular-nums">{usageByFab.has(fabId) ? nf.format(usageByFab.get(fabId) ?? 0) : <span className="text-[#ccc]">—</span>}</td>)}
              <td className="px-3 py-3 text-right"><div className="font-black tabular-nums">{nf.format(row.current)}</div><div className="text-[9px] text-[#999]">{Number.isFinite(row.closeDoh) ? `${row.closeDoh.toFixed(1)}일` : "—"}</div></td>
              <td className="px-4 py-3 text-center">
                <button type="button" onClick={() => { setOpenId(openId === row.materialId ? null : row.materialId); setLocalError(null); }} className="rounded-full border px-3 py-1 text-[10px] font-bold" style={{ borderColor: row.status === "critical" || row.status === "warning" ? "#EA002C" : "var(--border)", color: row.status === "critical" || row.status === "warning" ? "#EA002C" : "#666" }}>
                  당겨쓰기
                </button>
              </td>
            </tr>
            {openId === row.materialId && <tr><td colSpan={FAB_IDS.length + 3} className="border-t bg-[#FFF8F8] px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <div className="flex flex-wrap items-end gap-2 text-[11px]">
                <div><label className="mb-1 block text-[9px] font-bold text-[#777]">출발 팹(여유분)</label>
                  <select value={form.fromFabId} onChange={(event) => setForm((prev) => ({ ...prev, fromFabId: event.target.value as FabId }))} className="rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--border)" }}>
                    {FAB_IDS.map((fabId) => <option key={fabId} value={fabId}>{FAB_LABEL[fabId]}</option>)}
                  </select>
                </div>
                <div><label className="mb-1 block text-[9px] font-bold text-[#777]">도착 팹(부족)</label>
                  <select value={form.toFabId} onChange={(event) => setForm((prev) => ({ ...prev, toFabId: event.target.value as FabId }))} className="rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--border)" }}>
                    {FAB_IDS.map((fabId) => <option key={fabId} value={fabId}>{FAB_LABEL[fabId]}</option>)}
                  </select>
                </div>
                <div><label className="mb-1 block text-[9px] font-bold text-[#777]">수량 ({row.unit})</label>
                  <input type="number" min={0} value={form.quantity} onChange={(event) => setForm((prev) => ({ ...prev, quantity: event.target.value }))} className="w-24 rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--border)" }} />
                </div>
                <div className="min-w-[160px] flex-1"><label className="mb-1 block text-[9px] font-bold text-[#777]">사유</label>
                  <input type="text" value={form.reason} onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))} placeholder="예: M22 He 마감 DOH 3.2일" className="w-full rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--border)" }} />
                </div>
                <button type="button" disabled={busy} onClick={() => void submit(row)} className="rounded-lg bg-[#141413] px-3 py-2 text-[10px] font-black text-white disabled:opacity-50">기록 저장</button>
              </div>
              {localError && <div className="mt-2 text-[10px] font-bold text-[#EA002C]">{localError}</div>}
            </td></tr>}
          </Fragment>;
        })}</tbody>
      </table>
    </div>
    {reroutes.length > 0 && <div className="border-t px-5 py-4 text-[10px] text-[#777]" style={{ borderColor: "var(--border)" }}>
      <b className="text-[#444]">오늘 재배정 기록 {reroutes.length}건</b>
      <div className="mt-2 space-y-1">{reroutes.map((reroute) => <div key={reroute._id}>{new Date(reroute.decidedAt).toLocaleTimeString("ko-KR")} · {reroute.materialId} · {FAB_LABEL[reroute.fromFabId]} → {FAB_LABEL[reroute.toFabId]} · {nf.format(reroute.quantity)}{reroute.unit}{reroute.reason ? ` · ${reroute.reason}` : ""}</div>)}</div>
    </div>}
  </div>;
}

export default function DailyControlClient() {
  const [data, setData] = useState<DailyControlResponse | null>(null);
  const [reroutes, setReroutes] = useState<RerouteView[]>([]);
  const [tab, setTab] = useState<FabId | "ALL">("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [controlRes, rerouteRes] = await Promise.all([
      fetch("/api/daily-control", { cache: "no-store" }),
      fetch("/api/material-reroutes", { cache: "no-store" }),
    ]);
    if (controlRes.ok) setData(await controlRes.json());
    if (rerouteRes.ok) setReroutes(await rerouteRes.json());
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [load]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const visibleRows = useMemo(() => tab === "ALL" ? rows : rows.filter((row) => row.usageByProduct.some((item) => item.fabId === tab)), [rows, tab]);
  const selected = visibleRows.find((row) => row.materialId === selectedId) ?? visibleRows[0];

  const confirmActual = useCallback(async (product: Product, producedQty: number, note: string, reason?: string): Promise<string | null> => {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/production/actuals", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product, producedQty, note, reason }),
      });
      if (!response.ok) { const payload = await response.json() as { error?: string }; return payload.error ?? "생산실적 확정에 실패했습니다."; }
      await load();
      return null;
    } finally { setBusy(false); }
  }, [load]);

  const submitReroute = useCallback(async (materialId: string, fromFabId: FabId, toFabId: FabId, quantity: number, unit: string, reason: string): Promise<string | null> => {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/material-reroutes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialId, fromFabId, toFabId, quantity, unit, reason }),
      });
      if (!response.ok) { const payload = await response.json() as { error?: string }; return payload.error ?? "재배정 기록에 실패했습니다."; }
      await load();
      return null;
    } finally { setBusy(false); }
  }, [load]);

  const riskCount = rows.filter((row) => row.status === "critical" || row.status === "warning").length;
  const unconfirmedFabs = FAB_IDS.filter((fabId) => !data?.actuals[FAB_TO_PRODUCT[fabId]]);
  const productForTab = tab === "ALL" ? null : FAB_TO_PRODUCT[tab];

  return <div className="mx-auto max-w-[1600px]">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-extrabold tracking-tight">일일 생산 · 자재 연동</h1>
          <span className="rounded-full bg-[#E6FAF1] px-2.5 py-1 text-[9px] font-black tracking-[0.08em] text-[#00875A]">LIVE · 확정 실적 기반</span>
          <span className="rounded-full bg-[#F3F0EE] px-2.5 py-1 text-[9px] font-black tracking-[0.08em] text-[#777]">원단위 MODELED_BASELINE</span>
        </div>
        <p className="mt-1 text-sm text-[#777]">M20·M21·M22 팹별 확정 생산실적 × 원단위(모델 유도치)로 자재 사용량과 현재고를 계산합니다.</p>
      </div>
      <div className="rounded-xl border bg-white px-4 py-3 text-right" style={{ borderColor: "var(--border)" }}>
        <div className="text-[10px] font-bold text-[#999]">기준일 (KST)</div>
        <div className="mt-0.5 text-sm font-black">{data?.date ?? "—"}</div>
        <div className="mt-1 text-[9px] text-[#999]">실측 재고 · 실 productionActuals · MES 미연동 원단위</div>
      </div>
    </div>

    <div className="mt-6 flex flex-wrap items-center gap-2">
      <button onClick={() => setTab("ALL")} className="rounded-full border px-3 py-2 text-[11px] font-bold transition-all" style={{ borderColor: tab === "ALL" ? "#141413" : "var(--border)", color: tab === "ALL" ? "#141413" : "#666", background: tab === "ALL" ? "#F3F0EE" : "#fff" }}>전체 통합 크로스뷰</button>
      {FAB_IDS.map((fabId) => <button key={fabId} onClick={() => setTab(fabId)} className="rounded-full border px-3 py-2 text-[11px] font-bold transition-all" style={{ borderColor: tab === fabId ? "#EA002C" : "var(--border)", color: tab === fabId ? "#EA002C" : "#666", background: tab === fabId ? "#FFF0F2" : "#fff" }}>
        {FAB_LABEL[fabId]}{!data?.actuals[FAB_TO_PRODUCT[fabId]] && " ⚠"}
      </button>)}
    </div>

    {unconfirmedFabs.length > 0 && <div className="mt-4 rounded-2xl border border-[#F4C8CF] bg-gradient-to-r from-[#FFF5F6] to-white px-5 py-4">
      <div className="flex items-start gap-3"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EA002C] text-xs font-black text-white">!</span>
        <div><div className="text-[10px] font-extrabold text-[#A14A58]">오늘 실적 미확정</div>
          <div className="mt-1 text-sm font-bold">{unconfirmedFabs.map((fabId) => FAB_LABEL[fabId]).join(", ")}이(가) 아직 오늘 실적을 확정하지 않았습니다. 미확정 자재 행은 계획치로 잠정 표시됩니다.</div>
        </div>
      </div>
    </div>}

    <div className="mt-4 rounded-2xl border bg-white p-5" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="text-sm font-extrabold">오늘 팹별 생산실적 확정</div><div className="mt-1 text-[11px] text-[#777]">확정 저장 후 필드가 잠기며, 수정하려면 사유를 남겨야 합니다.</div></div>
        <div className="rounded-lg bg-[#F8F6F4] px-3 py-2 text-[10px] text-[#777]">생산실적 확정 → 원단위 → 자재 소요량 → 재고</div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {(productForTab ? [productForTab] : ["HBM", "DRAM", "NAND"] as Product[]).map((product) => (
          <ProductionActualCard key={`${product}:${data?.actuals[product]?.confirmedAt ?? "empty"}`} product={product} actual={data?.actuals[product] ?? null} busy={busy} onConfirm={confirmActual} />
        ))}
      </div>
    </div>

    <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard label="관리 품목 상태" value={`정상 ${rows.length - riskCount} · 위험 ${riskCount}`} note="서로 다른 자재 단위는 합산하지 않음" tone={riskCount ? "#EA002C" : "#00875A"} />
      <KpiCard label="공용자재" value={`${rows.filter((row) => row.sharedAcrossFabs).length}종`} note="2개 이상 팹이 함께 사용" />
      <KpiCard label="오늘 확정" value={`${3 - unconfirmedFabs.length} / 3 팹`} note={unconfirmedFabs.length ? "미확정 팹 있음" : "전체 확정 완료"} tone={unconfirmedFabs.length ? "#B97500" : "#00875A"} />
      <KpiCard label="오늘 재배정" value={`${reroutes.length}건`} note="공용자재 우선순위 기록" />
    </div>

    {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}

    {tab === "ALL" ? (
      <div className="mt-5 space-y-5">
        <CrossFabPanel rows={rows} reroutes={reroutes} busy={busy} onReroute={submitReroute} />
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(340px,0.8fr)]">
          <MaterialTable rows={rows} selectedId={selected?.materialId ?? null} onSelect={setSelectedId} />
          <DetailPanel row={selected} />
        </div>
      </div>
    ) : (
      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(340px,0.8fr)]">
        <MaterialTable rows={visibleRows} selectedId={selected?.materialId ?? null} onSelect={setSelectedId} />
        <DetailPanel row={selected} />
      </div>
    )}

    <div className="mt-5 rounded-xl border border-dashed p-4 text-[10px] leading-5 text-[#777]" style={{ borderColor: "#C9C4BF" }}>
      <b className="text-[#444]">데이터 출처:</b> 생산실적·현재고는 사용자가 확정한 실측치(productionActuals, inventory)입니다. 자재 원단위(제품별 사용계수)는 MODELED_BASELINE — 진짜 MES 원단위 마스터가 아직 없어 processUsage 월간 소요량을 FAB_SCENARIO 가동률로 역산한 값입니다. 계수가 부정확하면 사용량·마감예상도 함께 어긋납니다. 재배정 기록은 실물 이동이 아니라 우선순위 결정 로그입니다.
    </div>
  </div>;
}
