"use client";

import { useCallback, useEffect, useState } from "react";

type ProductView = {
  fabId: string; product: string; warehouseId: string; warehouseName: string;
  quantity: number; unit: string; capacityGbPerUnit: number;
  pendingTestQuantity: number; pendingTestReadyAt: string | null; updatedAt: string | null;
  recentEvents: { id: string; at: string; addedQty: number; queuedQty: number }[];
};
type Receipt = {
  tickAt: string; product: string; unit: string; producedAdded: number; producedQueued: number;
  consumed: { materialId: string; code: string; qty: number; shortfall: number }[];
};
type Customer = {
  _id: string; name: string; priorityTier: 1 | 2 | 3;
  contractedMonthlyQty: number; shippedThisMonth: number; fulfillmentPct: number | null;
};
type Shipment = { _id: string; customerId: string; customerName: string; quantity: number; unit: string; shippedAt: string };

const PRODUCT_COLOR: Record<string, string> = { HBM: "#EA002C", DRAM: "#2563EB", NAND: "#7C3AED" };
const TIER_LABEL: Record<number, { label: string; color: string; bg: string }> = {
  1: { label: "Tier-1", color: "#087A55", bg: "#E9F8F2" },
  2: { label: "Tier-2", color: "#B54708", bg: "#FFFAEB" },
  3: { label: "Tier-3", color: "#667085", bg: "#F2F4F7" },
};

function relTime(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}초 전`;
  return `${Math.floor(s / 60)}분 전`;
}
function fmt(n: number): string { return Math.round(n).toLocaleString("ko-KR"); }
// Gb → 자동 스케일(Gb/Tb/Pb/Eb). 완제품 수량 × capacityGbPerUnit.
function fmtGb(gb: number): string {
  const units = ["Gb", "Tb", "Pb", "Eb"];
  let v = gb, i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return `${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)} ${units[i]}`;
}

export default function FinishedGoodsClient() {
  const [products, setProducts] = useState<ProductView[] | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [gbMode, setGbMode] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGbMode(window.localStorage.getItem("fg-gb-mode") === "1");
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [fgRes, mbRes, custRes, shipRes] = await Promise.all([
        fetch("/api/twin/finished-goods", { cache: "no-store", signal }),
        fetch("/api/twin/material-balance", { cache: "no-store", signal }),
        fetch("/api/customers", { cache: "no-store", signal }),
        fetch("/api/twin/shipments", { cache: "no-store", signal }),
      ]);
      const [fgPayload, mbPayload, custPayload, shipPayload] = await Promise.all([fgRes.json(), mbRes.json(), custRes.json(), shipRes.json()]);
      if (!fgRes.ok) throw new Error(fgPayload.error ?? "완제품 재고를 불러오지 못했습니다.");
      setProducts(fgPayload.products ?? []);
      if (mbRes.ok) setReceipts(mbPayload.receipts ?? []);
      if (custRes.ok) setCustomers(custPayload.customers ?? []);
      if (shipRes.ok) setShipments(shipPayload.shipments ?? []);
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
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { controller.abort(); window.clearInterval(interval); window.clearInterval(clock); };
  }, [load]);

  function toggleGb() {
    setGbMode((v) => { const nv = !v; window.localStorage.setItem("fg-gb-mode", nv ? "1" : "0"); return nv; });
  }

  const hbm = products?.find((p) => p.product === "HBM") ?? products?.[0];

  async function submitShipment() {
    if (!customerId || !qty || Number(qty) <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/twin/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, quantity: Number(qty) }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "출하 처리에 실패했습니다.");
      setQty("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "출하 처리에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (!products) return <div className="rounded-2xl border bg-white p-8 text-center text-sm text-[#999]" style={{ borderColor: "var(--border)" }}>불러오는 중…</div>;

  // Gb 정규화된 최대값 — 스트립 바 폭 기준(제품 간 상대 비교).
  const maxGb = Math.max(1, ...products.map((p) => p.quantity * p.capacityGbPerUnit));
  const maxNative = Math.max(1, ...products.map((p) => p.quantity));

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      {/* [A] 3제품 스케일 스트립 + Gb 토글 */}
      <div className="rounded-2xl border bg-white p-4" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[#EAF4FF] px-2 py-0.5 text-[10px] font-extrabold text-[#0956B0]">물질 보존</span>
            <h2 className="text-sm font-bold text-[#141413]">HBM · DRAM · NAND 완제품 적립</h2>
          </div>
          <div className="inline-flex overflow-hidden rounded-lg border border-[#DDE2E7] text-[11px] font-bold">
            <button type="button" onClick={() => gbMode && toggleGb()} className={`px-2.5 py-1 ${gbMode ? "bg-white text-[#888]" : "bg-[#24221F] text-white"}`}>native 단위</button>
            <button type="button" onClick={() => !gbMode && toggleGb()} className={`px-2.5 py-1 ${gbMode ? "bg-[#24221F] text-white" : "bg-white text-[#888]"}`}>Gb 공통</button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {products.map((p) => {
            const color = PRODUCT_COLOR[p.product] ?? "#0078D4";
            const gb = p.quantity * p.capacityGbPerUnit;
            const barPct = gbMode ? (gb / maxGb) * 100 : (p.quantity / maxNative) * 100;
            const latestAdd = p.recentEvents[0]?.addedQty ?? 0;
            return (
              <div key={p.product} className="rounded-xl border bg-white p-3.5" style={{ borderColor: "var(--border)", borderTop: `4px solid ${color}` }}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-black" style={{ color }}>{p.product}</span>
                  <span className="rounded-full px-1.5 py-0.5 text-[9px] font-extrabold" style={{ background: `${color}14`, color }}>● 산출중</span>
                </div>
                <div className="mt-1.5 text-2xl font-black leading-none">
                  {gbMode ? fmtGb(gb) : fmt(p.quantity)}
                  {!gbMode && <span className="ml-1 text-xs font-semibold text-[#999]">{p.unit}</span>}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#EEE]">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, barPct)}%`, background: color }} />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[10px]">
                  <span className="font-bold text-[#087A55]">최근 tick +{fmt(latestAdd)}</span>
                  {p.pendingTestQuantity > 0 && <span className="text-[#9333EA]">테스트대기 {fmt(p.pendingTestQuantity)}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2.5 text-[11px] text-[#999]">
          {gbMode ? "Gb 공통 환산 = 완제품 수량 × 제품별 밀도(HBM 36Gb/stack · DRAM 16Gb/chip · NAND 1Tb/die)." : "각 제품 native 단위(HBM=STACK · DRAM=CHIP · NAND=DIE). 교차 비교는 Gb 공통 토글."}
        </p>
      </div>

      {/* [C] 소모-산출 영수증 피드 */}
      <div className="rounded-2xl border bg-white p-4" style={{ borderColor: "#BFDBFE", boxShadow: "var(--shadow-1)" }}>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#EAF4FF] px-2 py-0.5 text-[10px] font-extrabold text-[#0956B0]">소모 → 산출 영수증</span>
          <h2 className="text-sm font-bold text-[#141413]">자재가 줄어든 만큼 완제품이 늘어난다</h2>
        </div>
        <p className="mt-1 text-[11px] text-[#999]">매 tick 소모된 자재(twinBurnEvents)와 같은 tick 완제품 적립(finishedGoodsEvents)을 시간축으로 대조합니다.</p>
        <div className="mt-3 space-y-1.5">
          {receipts.length === 0 && <div className="rounded-xl bg-[#F8F7F5] p-4 text-center text-xs text-[#999]">아직 소모·산출 기록이 없습니다.</div>}
          {receipts.map((r, i) => {
            const color = PRODUCT_COLOR[r.product] ?? "#0078D4";
            const produced = r.producedAdded > 0 ? r.producedAdded : r.producedQueued;
            const isQueued = r.producedAdded <= 0 && r.producedQueued > 0;
            return (
              <div key={`${r.tickAt}-${r.product}-${i}`} className="flex items-center justify-between gap-3 rounded-lg bg-[#F3FBFF] px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span className="font-black" style={{ color }}>{r.product}</span>
                  {r.consumed.map((c) => (
                    <span key={c.materialId} className={c.shortfall > 0 ? "text-red-600 font-semibold" : "text-[#888]"}>
                      {c.code} −{fmt(c.qty)}{c.shortfall > 0 ? " ⚠결품" : ""}
                    </span>
                  ))}
                  {r.consumed.length === 0 && <span className="text-[#bbb]">소모 없음</span>}
                  <span className="text-[#087A55] font-bold">→ +{fmt(produced)} {r.unit}{isQueued ? " (테스트대기)" : ""}</span>
                </div>
                <span className="shrink-0 text-[#888]">{relTime(r.tickAt, now)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 고객사 계약 이행률 (HBM 기준) */}
      <div className="rounded-2xl border bg-white p-4" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#F0EEEB] px-2 py-0.5 text-[10px] font-extrabold text-[#6F6963]">고객사 계약 이행률</span>
          <h2 className="text-sm font-bold text-[#141413]">이번 달 계약물량 대비 출하 (HBM)</h2>
        </div>
        <p className="mt-1 text-[11px] text-[#999]">계약물량도 가상 데이터(HBM 설계기준 월산출을 등급 비율로 배분)입니다.</p>
        <div className="mt-3 space-y-2">
          {customers.map((c) => {
            const pct = c.fulfillmentPct ?? 0;
            const barColor = pct >= 100 ? "#00875A" : pct >= 50 ? "#0078D4" : "#B97500";
            return (
              <div key={c._id} className="rounded-xl bg-[#FAFAFA] px-3 py-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold">{c.name} <span className="ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold" style={{ background: TIER_LABEL[c.priorityTier].bg, color: TIER_LABEL[c.priorityTier].color }}>{TIER_LABEL[c.priorityTier].label}</span></span>
                  <span className="text-[#888]">{fmt(c.shippedThisMonth)} / {c.contractedMonthlyQty.toLocaleString("ko-KR")} {hbm?.unit ?? "STACK"}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EEE]">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: barColor }} />
                  </div>
                  <span className="text-[10px] font-bold" style={{ color: barColor }}>{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 출하 처리 (HBM) */}
      <div className="rounded-2xl border bg-white p-4" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#F0EEEB] px-2 py-0.5 text-[10px] font-extrabold text-[#6F6963]">출하 처리</span>
          <h2 className="text-sm font-bold text-[#141413]">가상 고객사에게 HBM 완제품 출하</h2>
        </div>
        <p className="mt-1 text-[11px] text-[#999]">고객사 데이터는 실제 영업 계약이 아닌 데모용 가상 데이터입니다. (DRAM/NAND 출하는 후속 과제)</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="rounded-lg border border-[#DDE2E7] bg-white px-2.5 py-2 text-xs">
            <option value="">고객사 선택</option>
            {customers.map((c) => (
              <option key={c._id} value={c._id}>{c.name} · {TIER_LABEL[c.priorityTier].label}</option>
            ))}
          </select>
          <input
            type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)}
            placeholder={`수량 (${hbm?.unit ?? "STACK"})`}
            className="w-40 rounded-lg border border-[#DDE2E7] bg-white px-2.5 py-2 text-xs"
          />
          <button
            type="button" disabled={busy || !customerId || !qty} onClick={() => void submitShipment()}
            className="rounded-lg bg-[#24221F] px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            {busy ? "처리 중…" : "출하 처리"}
          </button>
          <span className="text-[11px] text-[#999]">HBM 가용 재고 {fmt(hbm?.quantity ?? 0)} {hbm?.unit ?? "STACK"}</span>
        </div>

        <div className="mt-4 space-y-1.5">
          {shipments.length === 0 && <div className="text-[11px] text-[#999]">출하 이력이 없습니다.</div>}
          {shipments.map((s) => (
            <div key={s._id} className="flex items-center justify-between rounded-lg bg-[#FAFAFA] px-3 py-2 text-xs">
              <span className="font-bold">{s.customerName} · {fmt(s.quantity)} {s.unit}</span>
              <span className="text-[#888]">{new Date(s.shippedAt).toLocaleString("ko-KR")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
