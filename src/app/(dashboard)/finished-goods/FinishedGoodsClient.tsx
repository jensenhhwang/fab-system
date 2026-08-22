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
// 고객 × 제품 계약 라인 — 예전엔 고객당 1행이었고 단위가 다른 출하가 한 숫자로 합산됐다.
type ContractLine = {
  customerId: string; customerName: string; priorityTier: 1 | 2 | 3;
  product: string; unit: string; contractedMonthlyQty: number; contractType: "LTA" | "COMMITTED" | "SPOT";
  shippedThisMonth: number; shipmentCount: number; fulfillmentPct: number | null; shortfall: number;
};
type ContractTotal = {
  product: string; unit: string; designMonthlyQty: number;
  contracted: number; shipped: number; spotShipped: number;
  contractLineCount: number; spotLineCount: number; pct: number | null;
};
type Shipment = { _id: string; customerId: string; customerName: string; product: string; fabId: string; quantity: number; unit: string; shippedAt: string };

const PRODUCT_COLOR: Record<string, string> = { HBM: "#EA002C", DRAM: "#2563EB", NAND: "#7C3AED" };

// 이행률 게이지. 값 범위가 12%~258%로 21배까지 벌어져서 Math.min(100, pct)로 자르면 초과
// 라인들이 전부 꽉 찬 같은 바가 된다(= 계산을 고쳐도 화면이 계속 거짓말을 함). 그래서
// 100%를 트랙의 고정 55% 지점에 못 박고 초과분만 로그로 압축해 300%에서 포화시킨다.
// 100% 틱이 모든 행에서 같은 x에 있어 세로로 스캔된다.
function gaugeX(pct: number): number {
  if (pct <= 100) return pct * 0.55;
  return 55 + Math.min(45, (Math.log10(pct / 100) / Math.log10(3)) * 45);
}

// 스팟 라인은 게이지를 아예 그리지 않는다 — 색만 바꾸면 "이것도 %인가" 하고 읽지만,
// 트랙이 없으면 오독이 불가능하다. 퍼센트가 존재하지 않는 개념이라는 걸 부재로 표현한다.
function FulfillmentGauge({ pct, color }: { pct: number | null; color: string }) {
  if (pct == null) {
    return <span className="w-[136px] text-right text-[10px] font-bold text-[#667085]">SPOT</span>;
  }
  const x = gaugeX(pct);
  const filled = Math.min(x, 55);
  const over = Math.max(0, x - 55);
  const badge = pct >= 95 && pct <= 105 ? "#00875A" : pct < 95 ? "#B97500" : "#667085";
  return (
    <span className="flex w-[136px] items-center gap-1.5">
      <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[#EEE]">
        <span className="absolute left-0 top-0 h-full" style={{ width: `${filled}%`, background: color }} />
        {over > 0 && (
          <span
            className="absolute top-0 h-full"
            style={{ left: "55%", width: `${over}%`, background: color, opacity: 0.35 }}
          />
        )}
        {/* 100% 기준선 */}
        <span className="absolute top-[-1px] h-[8px] w-[1.5px] bg-[#141413]" style={{ left: "55%" }} />
      </span>
      <span className="w-9 text-right text-[10px] font-bold tabular-nums" style={{ color: badge }}>{pct}%</span>
    </span>
  );
}
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
  const [lines, setLines] = useState<ContractLine[]>([]);
  const [totals, setTotals] = useState<ContractTotal[]>([]);
  const [openBand, setOpenBand] = useState<string | null>(null);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [gbMode, setGbMode] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [shipProduct, setShipProduct] = useState("HBM");
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
      if (custRes.ok) {
        // 고객 목록 자체는 더 이상 안 쓴다 — 화면 단위가 "고객"이 아니라 "고객 × 제품 계약 라인"이다.
        setLines(custPayload.lines ?? []);
        setTotals(custPayload.totals ?? []);
      }
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
  // 출하 대상 제품의 가용 재고 — 3제품 출하가 열리면서 "HBM 재고"가 아니라 선택 제품 기준이어야 한다.
  const shipTarget = products?.find((p) => p.product === shipProduct) ?? hbm;

  async function submitShipment() {
    if (!customerId || !qty || Number(qty) <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/twin/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, quantity: Number(qty), product: shipProduct }),
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

      {/* 고객사 계약 이행률 — 제품별 밴드 */}
      <div className="rounded-2xl border bg-white p-4" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#F0EEEB] px-2 py-0.5 text-[10px] font-extrabold text-[#6F6963]">고객사 계약 이행률</span>
          <h2 className="text-sm font-bold text-[#141413]">이번 달 계약물량 대비 출하</h2>
        </div>
        <p className="mt-1 text-[11px] text-[#999]">
          계약물량은 가상 데이터(제품별 설계기준 월산출을 등급 비율로 배분)입니다. 제품마다 단위와 자릿수가
          달라 합산하지 않고 제품별로 나눠 봅니다. 스팟 계약은 약정 물량이 없어 이행률 대신 배정량만 표시합니다.
        </p>
        <div className="mt-3 space-y-2">
          {totals.map((t) => {
            const productLines = lines.filter((l) => l.product === t.product);
            const open = openBand === t.product;
            const color = PRODUCT_COLOR[t.product] ?? "#141413";
            return (
              <div key={t.product} className="rounded-xl border" style={{ borderColor: "var(--border)" }}>
                <button
                  type="button"
                  onClick={() => setOpenBand(open ? null : t.product)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                >
                  <span className="w-14 text-xs font-extrabold" style={{ color }}>{t.product}</span>
                  <span className="text-[10px] text-[#999]">계약라인 {t.contractLineCount} · 스팟 {t.spotLineCount}</span>
                  <span className="ml-auto text-[11px] tabular-nums text-[#888]">
                    {fmt(t.shipped)} / {fmt(t.contracted)} {t.unit}
                  </span>
                  <FulfillmentGauge pct={t.pct} color={color} />
                  <span className="w-4 text-center text-[10px] text-[#999]">{open ? "▾" : "▸"}</span>
                </button>
                {open && (
                  <div className="space-y-1.5 border-t px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
                    {[...productLines]
                      // 부족분이 큰 라인부터 — 정렬 자체가 "어디를 먼저 채워야 하나" 랭킹이 된다.
                      .sort((a, b) => b.shortfall - a.shortfall)
                      .map((l) => (
                        <div key={`${l.customerId}-${l.product}`} className="flex items-center gap-2 rounded-lg bg-[#FAFAFA] px-2.5 py-2 text-xs">
                          <span className="font-bold">{l.customerName}</span>
                          <span className="rounded-full px-1.5 py-0.5 text-[9px] font-extrabold" style={{ background: TIER_LABEL[l.priorityTier].bg, color: TIER_LABEL[l.priorityTier].color }}>
                            {TIER_LABEL[l.priorityTier].label}
                          </span>
                          <span className="rounded-full bg-[#F2F4F7] px-1.5 py-0.5 text-[9px] font-extrabold text-[#667085]">{l.contractType}</span>
                          <span className="ml-auto tabular-nums text-[#888]">
                            {l.contractType === "SPOT"
                              ? `${fmt(l.shippedThisMonth)} ${l.unit} 배정 · 계약없음`
                              : `${fmt(l.shippedThisMonth)} / ${fmt(l.contractedMonthlyQty)} ${l.unit}`}
                          </span>
                          <FulfillmentGauge pct={l.fulfillmentPct} color={color} />
                        </div>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 출하 처리 (3제품) */}
      <div className="rounded-2xl border bg-white p-4" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#F0EEEB] px-2 py-0.5 text-[10px] font-extrabold text-[#6F6963]">출하 처리</span>
          <h2 className="text-sm font-bold text-[#141413]">가상 고객사에게 완제품 출하</h2>
        </div>
        <p className="mt-1 text-[11px] text-[#999]">고객사 데이터는 실제 영업 계약이 아닌 데모용 가상 데이터입니다. 완제품 창고가 차면 마지막 공정이 막히므로, 출하가 곧 생산 재개 조건입니다.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={shipProduct} onChange={(e) => setShipProduct(e.target.value)} className="rounded-lg border border-[#DDE2E7] bg-white px-2.5 py-2 text-xs font-bold" style={{ color: PRODUCT_COLOR[shipProduct] ?? "#141413" }}>
            {(products ?? []).map((p) => (
              <option key={p.product} value={p.product}>{p.product}</option>
            ))}
          </select>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="rounded-lg border border-[#DDE2E7] bg-white px-2.5 py-2 text-xs">
            <option value="">고객사 선택</option>
            {/* 제품이 이미 정해진 뒤에 고르는 순서이므로, 그 제품 기준 부족분을 같이 보여준다 */}
            {lines
              .filter((l) => l.product === shipProduct)
              .sort((a, b) => b.shortfall - a.shortfall)
              .map((l) => (
                <option key={l.customerId} value={l.customerId}>
                  {l.customerName} · {TIER_LABEL[l.priorityTier].label} · {l.contractType}
                  {l.contractType === "SPOT" ? " · 계약없음" : ` · 미달 ${fmt(l.shortfall)} ${l.unit}`}
                </option>
              ))}
          </select>
          <input
            type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)}
            placeholder={`수량 (${shipTarget?.unit ?? "STACK"})`}
            className="w-40 rounded-lg border border-[#DDE2E7] bg-white px-2.5 py-2 text-xs"
          />
          <button
            type="button" disabled={busy || !customerId || !qty} onClick={() => void submitShipment()}
            className="rounded-lg bg-[#24221F] px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            {busy ? "처리 중…" : "출하 처리"}
          </button>
          <span className="text-[11px] text-[#999]">{shipProduct} 가용 재고 {fmt(shipTarget?.quantity ?? 0)} {shipTarget?.unit ?? "STACK"}</span>
        </div>

        <div className="mt-4 space-y-1.5">
          {shipments.length === 0 && <div className="text-[11px] text-[#999]">출하 이력이 없습니다.</div>}
          {shipments.map((s) => (
            <div key={s._id} className="flex items-center justify-between rounded-lg bg-[#FAFAFA] px-3 py-2 text-xs">
              <span className="font-bold">
                <span style={{ color: PRODUCT_COLOR[s.product] ?? "#141413" }}>{s.product}</span>
                {" · "}{s.customerName} · {fmt(s.quantity)} {s.unit}
              </span>
              <span className="text-[#888]">{new Date(s.shippedAt).toLocaleString("ko-KR")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
