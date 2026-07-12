"use client";

import { useMemo, useState } from "react";
import {
  DEFAULT_PRODUCTION_ACTUALS,
  PRODUCTION_PLAN,
  SCENARIOS,
  buildDailyControl,
  scenarioBriefing,
  type DemoEvent,
  type DemoScenario,
  type MaterialControlRow,
  type ProductKey,
  type ProductionActuals,
} from "@/lib/daily-control-demo";

const STATUS = {
  critical: { label: "위급", color: "#EA002C", bg: "#FFF0F2" },
  warning: { label: "경보", color: "#B97500", bg: "#FFF8E6" },
  ok: { label: "적정", color: "#00875A", bg: "#E6FAF1" },
  safe: { label: "여유", color: "#0078D4", bg: "#E8F3FF" },
  review: { label: "확인 필요", color: "#7C3AED", bg: "#F3E8FF" },
};

const EVENT_STYLE = {
  RECEIPT: { label: "입고", color: "#00B96B", sign: "+" },
  CONSUMPTION: { label: "사용", color: "#F47725", sign: "" },
  TRANSFER: { label: "이동", color: "#0078D4", sign: "" },
  ADJUSTMENT: { label: "조정", color: "#7C3AED", sign: "" },
  PLAN: { label: "계획", color: "#696969", sign: "+" },
};

const STATE_LABEL = { ACTUAL: "실적", CONFIRMED: "확정", PENDING: "승인 대기" };
const nf = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });

function formatQuantity(value: number, unit: string, plus = false) {
  const prefix = plus && value > 0 ? "+" : "";
  return `${prefix}${nf.format(value)} ${unit}`;
}

function StatusBadge({ row }: { row: MaterialControlRow }) {
  const style = STATUS[row.status];
  return <span className="inline-flex rounded-full px-2 py-1 text-[10px] font-extrabold" style={{ color: style.color, background: style.bg }}>{style.label}</span>;
}

function KpiCard({ label, value, note, tone = "#141413" }: { label: string; value: string; note: string; tone?: string }) {
  return <div className="rounded-2xl border bg-white p-4" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
    <div className="text-[11px] font-bold tracking-[0.04em] text-[#777]">{label}</div>
    <div className="mt-2 text-2xl font-black tracking-tight" style={{ color: tone }}>{value}</div>
    <div className="mt-1 text-[11px] text-[#888]">{note}</div>
  </div>;
}

function FlowChart({ row, selectedEvent, onEvent }: { row: MaterialControlRow; selectedEvent: string | null; onEvent: (id: string) => void }) {
  const actualEvents = row.events.filter((event) => event.state === "ACTUAL" && event.affectsInventory);
  let balance = row.opening;
  const actualPoints = [{ x: 6, yValue: balance, label: "00:00" }];
  actualEvents.forEach((event, index) => {
    balance += event.quantity;
    actualPoints.push({ x: 20 + index * 22, yValue: balance, label: event.time });
  });
  const currentX = Math.max(48, actualPoints.at(-1)?.x ?? 48);
  const values = [...actualPoints.map((point) => point.yValue), row.projectedClose, row.previousClose, row.safetyStock];
  const min = Math.min(...values) - Math.max(5, row.dailyUsage * 0.5);
  const max = Math.max(...values) + Math.max(5, row.dailyUsage * 0.5);
  const y = (value: number) => 118 - ((value - min) / Math.max(1, max - min)) * 88;
  const points = actualPoints.map((point) => `${point.x},${y(point.yValue)}`).join(" ");
  const chartEvents = row.events.filter((event) => event.state === "ACTUAL" && event.kind !== "TRANSFER");

  return <div className="rounded-2xl bg-[#171817] p-5 text-white shadow-xl">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 text-[11px] font-bold text-white/55"><span className="h-2 w-2 rounded-full bg-[#00B96B]" />선택 자재 · 금일 흐름</div>
        <div className="mt-1 text-xl font-black">{row.name} <span className="font-mono text-xs text-white/45">{row.code}</span></div>
      </div>
      <div className="flex gap-4 text-right">
        <div><div className="text-[10px] text-white/45">현재고</div><div className="font-black">{formatQuantity(row.current, row.unit)}</div></div>
        <div><div className="text-[10px] text-white/45">마감 예상</div><div className="font-black text-[#FF8B55]">{formatQuantity(row.projectedClose, row.unit)}</div></div>
      </div>
    </div>

    <div className="mt-5 grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-2 rounded-xl bg-white/[0.06] p-3 text-center">
      <div><div className="text-[9px] text-white/40">기초</div><b className="text-sm">{nf.format(row.opening)}</b></div><span className="text-white/25">+</span>
      <div><div className="text-[9px] text-white/40">입고 실적</div><b className="text-sm text-[#66E4AC]">{nf.format(row.actualReceipt)}</b></div><span className="text-white/25">−</span>
      <div><div className="text-[9px] text-white/40">사용 실적</div><b className="text-sm text-[#FFAB7D]">{nf.format(row.actualUsed)}</b></div><span className="text-white/25">=</span>
      <div><div className="text-[9px] text-white/40">현재고</div><b className="text-sm">{nf.format(row.current)} {row.unit}</b></div>
    </div>

    <svg viewBox="0 0 100 136" className="mt-3 h-[190px] w-full" role="img" aria-label={`${row.name} 재고 흐름 그래프`} preserveAspectRatio="none">
      {[35, 70, 105].map((line) => <line key={line} x1="4" x2="97" y1={line} y2={line} stroke="rgba(255,255,255,.08)" strokeWidth=".5" />)}
      <line x1="4" x2="97" y1={y(row.safetyStock)} y2={y(row.safetyStock)} stroke="#EA002C" strokeWidth=".7" strokeDasharray="2 2" opacity=".8" />
      <text x="96" y={y(row.safetyStock) - 2} textAnchor="end" fill="#FF718C" fontSize="3.2">안전재고 {row.safetyStock}</text>
      <polyline points={points} fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinejoin="round" />
      <line x1={currentX} y1={y(row.current)} x2="96" y2={y(row.projectedClose)} stroke="#F47725" strokeWidth="1.7" strokeDasharray="3 2" />
      <line x1={currentX} y1={y(row.current)} x2="96" y2={y(row.previousClose)} stroke="rgba(255,255,255,.3)" strokeWidth="1" strokeDasharray="2 2" />
      <line x1={currentX} x2={currentX} y1="18" y2="124" stroke="rgba(255,255,255,.18)" strokeWidth=".5" strokeDasharray="1 2" />
      <text x={currentX} y="14" textAnchor="middle" fill="rgba(255,255,255,.55)" fontSize="3.4">14:00 · R08</text>
      {chartEvents.map((event) => {
        const point = actualPoints.find((item) => item.label === event.time);
        if (!point) return null;
        const color = EVENT_STYLE[event.kind].color;
        return <g key={event.id} onClick={() => onEvent(event.id)} className="cursor-pointer">
          <circle cx={point.x} cy={y(point.yValue)} r={selectedEvent === event.id ? 3.3 : 2.2} fill={color} stroke="#171817" strokeWidth="1" />
          {selectedEvent === event.id && <circle cx={point.x} cy={y(point.yValue)} r="5" fill="none" stroke={color} strokeWidth=".7" opacity=".7" />}
        </g>;
      })}
      <circle cx="96" cy={y(row.projectedClose)} r="2.4" fill="#F47725" />
      <text x="96" y="133" textAnchor="end" fill="rgba(255,255,255,.45)" fontSize="3.5">24:00 마감</text>
      <text x="4" y="133" fill="rgba(255,255,255,.45)" fontSize="3.5">00:00</text>
    </svg>
    <div className="flex flex-wrap items-center gap-4 text-[10px] text-white/50">
      <span><i className="mr-1 inline-block h-0.5 w-4 bg-white align-middle" />실적</span>
      <span><i className="mr-1 inline-block w-4 border-t border-dashed border-[#F47725] align-middle" />R08 전망</span>
      <span><i className="mr-1 inline-block w-4 border-t border-dashed border-white/30 align-middle" />R07 전망</span>
      <span className="ml-auto">HOLD {formatQuantity(row.holdQuantity, row.unit)} · 가용재고 별도</span>
    </div>
  </div>;
}

function MaterialTable({ rows, selectedId, onSelect }: { rows: MaterialControlRow[]; selectedId: string; onSelect: (id: string) => void }) {
  return <div className="overflow-hidden rounded-2xl border bg-white" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
    <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
      <div><div className="text-sm font-extrabold">자재별 운영 현황</div><div className="mt-0.5 text-[11px] text-[#888]">행을 선택하면 흐름과 원장 근거가 함께 바뀝니다.</div></div>
      <div className="text-[10px] font-bold text-[#777]">8개 핵심 자재 · 단위별 관리</div>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-xs">
        <thead className="bg-[#F8F6F4] text-[10px] font-bold text-[#777]"><tr>
          <th className="px-4 py-3 text-left">자재</th><th className="px-3 py-3 text-right">기초</th><th className="px-3 py-3 text-right">입고 실적</th><th className="px-3 py-3 text-right">사용 실적</th><th className="px-3 py-3 text-right">현재고</th><th className="px-3 py-3 text-right">마감 예상</th><th className="px-3 py-3 text-right">DOH</th><th className="px-4 py-3 text-center">상태</th>
        </tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id} onClick={() => onSelect(row.id)} className="cursor-pointer border-t transition-colors hover:bg-[#FFF8F8]" style={{ borderColor: "var(--border)", background: selectedId === row.id ? "#FFF5F6" : undefined }}>
          <td className="px-4 py-3"><div className="flex items-center gap-2"><span className="h-7 w-1 rounded-full" style={{ background: STATUS[row.status].color }} /><div><div className="font-bold">{row.name}</div><div className="font-mono text-[9px] text-[#999]">{row.code} · {row.unit}</div></div></div></td>
          <td className="px-3 py-3 text-right tabular-nums">{nf.format(row.opening)}</td>
          <td className="px-3 py-3 text-right font-bold tabular-nums text-[#00875A]">+{nf.format(row.actualReceipt)}</td>
          <td className="px-3 py-3 text-right font-bold tabular-nums text-[#C45C19]">−{nf.format(row.actualUsed)}</td>
          <td className="px-3 py-3 text-right font-black tabular-nums">{nf.format(row.current)}</td>
          <td className="px-3 py-3 text-right"><div className="font-black tabular-nums">{nf.format(row.projectedClose)}</div><div className="text-[9px] text-[#999]">입고 +{row.forecastReceipt} · 사용 −{row.forecastUsage}</div></td>
          <td className="px-3 py-3 text-right font-bold tabular-nums">{row.closeDoh.toFixed(1)}일</td>
          <td className="px-4 py-3 text-center"><StatusBadge row={row} /><div className="mt-1 whitespace-nowrap text-[9px] text-[#888]">{row.statusReason}</div></td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

function EventRow({ event, unit, selected, onSelect }: { event: DemoEvent; unit: string; selected: boolean; onSelect: () => void }) {
  const style = EVENT_STYLE[event.kind];
  return <button onClick={onSelect} className="w-full rounded-xl border p-3 text-left transition-all" style={{ borderColor: selected ? style.color : "var(--border)", background: selected ? `${style.color}0D` : "#fff" }}>
    <div className="flex items-start gap-3">
      <div className="w-11 shrink-0 font-mono text-[10px] font-bold text-[#777]">{event.time}</div>
      <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ background: style.color }} />
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><b className="text-xs">{style.label}</b><span className="rounded bg-[#F3F0EE] px-1.5 py-0.5 text-[9px] font-bold text-[#666]">{STATE_LABEL[event.state]}</span></div><div className="mt-1 text-[10px] leading-4 text-[#777]">{event.description}</div><div className="mt-1 font-mono text-[9px] text-[#aaa]">{event.source} · {event.reference}</div></div>
      <div className="shrink-0 text-right text-xs font-black" style={{ color: style.color }}>{event.quantity === 0 ? "이동" : formatQuantity(event.quantity, unit, true)}</div>
    </div>
  </button>;
}

function DetailPanel({ row, selectedEvent, onEvent }: { row: MaterialControlRow; selectedEvent: string | null; onEvent: (id: string) => void }) {
  const delta = row.projectedClose - row.previousClose;
  const selected = row.events.find((event) => event.id === selectedEvent);
  return <aside className="rounded-2xl border bg-white" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
    <div className="border-b p-5" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-bold text-[#999]">MATERIAL TRACE</div><div className="mt-1 text-lg font-black">{row.name}</div><div className="font-mono text-[10px] text-[#999]">{row.code}</div></div><StatusBadge row={row} /></div>
      <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-xl bg-[#F8F6F4] p-3"><div className="text-[9px] text-[#888]">공식 현재고</div><div className="mt-1 text-lg font-black">{formatQuantity(row.current, row.unit)}</div></div><div className="rounded-xl bg-[#FFF3EA] p-3"><div className="text-[9px] text-[#9A5A2C]">마감 예상</div><div className="mt-1 text-lg font-black text-[#C45C19]">{formatQuantity(row.projectedClose, row.unit)}</div></div></div>
      <div className="mt-3 grid grid-cols-3 text-center text-[10px]"><div><span className="text-[#999]">안전재고</span><b className="mt-1 block">{row.safetyStock}</b></div><div className="border-x" style={{ borderColor: "var(--border)" }}><span className="text-[#999]">HOLD</span><b className="mt-1 block">{row.holdQuantity}</b></div><div><span className="text-[#999]">마감 DOH</span><b className="mt-1 block">{row.closeDoh.toFixed(1)}일</b></div></div>
      {row.pendingVariance !== 0 && <div className="mt-3 rounded-xl bg-[#F3E8FF] p-3 text-[11px] text-[#6D28D9]"><b>실사 차이 {formatQuantity(row.pendingVariance, row.unit)}</b><div className="mt-1 leading-4">승인 전 값으로 공식 현재고에는 반영하지 않았습니다.</div></div>}
    </div>
    <div className="p-5">
      <div className="flex items-center justify-between"><b className="text-sm">오늘 이벤트 원장</b><span className="text-[9px] text-[#999]">시간 · 상태 · 출처 · 참조번호</span></div>
      <div className="mt-3 space-y-2">{row.events.map((event) => <EventRow key={event.id} event={event} unit={row.unit} selected={selectedEvent === event.id} onSelect={() => onEvent(event.id)} />)}</div>
      <div className="mt-5 rounded-xl border p-4" style={{ borderColor: "var(--border)" }}><div className="flex items-center justify-between"><div className="text-[10px] font-extrabold text-[#777]">생산량 → 자재 사용량</div><span className="text-[9px] text-[#999]">실적 × 원단위</span></div><div className="mt-3 space-y-2">{row.usageByProduct.map((item) => <div key={item.product} className="grid grid-cols-[48px_1fr_auto] items-center gap-2 text-[10px]"><b>{item.product}</b><div className="h-1.5 overflow-hidden rounded-full bg-[#EEE]"><div className="h-full rounded-full bg-[#F47725]" style={{ width: `${Math.min(100, item.usage / Math.max(...row.usageByProduct.map((entry) => entry.usage)) * 100)}%` }} /></div><span className="tabular-nums text-[#777]">{item.production.toFixed(1)}K × {item.coefficient} = <b className="text-[#C45C19]">{item.usage.toFixed(1)} {row.unit}</b></span></div>)}</div><div className="mt-3 border-t pt-3 text-right text-xs" style={{ borderColor: "var(--border)" }}>오늘 생산실적 유도 사용량 <b>{row.actualUsed.toFixed(1)} {row.unit}</b></div></div>
      <div className="mt-5 rounded-xl border p-4" style={{ borderColor: "var(--border)" }}><div className="text-[10px] font-extrabold text-[#777]">계획 → 실적 연결</div><div className="mt-3 flex items-center justify-between gap-2 text-center text-[10px]"><div className="flex-1 rounded-lg bg-[#F8F6F4] p-2"><span className="text-[#999]">승인 계획</span><b className="mt-1 block">PP-0712</b></div><span className="text-[#bbb]">→</span><div className="flex-1 rounded-lg bg-[#F8F6F4] p-2"><span className="text-[#999]">공정 투입</span><b className="mt-1 block">MES 실적</b></div><span className="text-[#bbb]">→</span><div className="flex-1 rounded-lg bg-[#E6FAF1] p-2"><span className="text-[#48806A]">재고 반영</span><b className="mt-1 block text-[#00875A]">완료</b></div></div></div>
      <div className="mt-3 rounded-xl bg-[#171817] p-4 text-white"><div className="text-[10px] font-bold text-white/50">R07 → R08 REVISION</div><div className="mt-2 flex items-end justify-between"><div><span className="text-white/45 line-through">{nf.format(row.previousClose)}</span><span className="mx-2 text-white/30">→</span><b className="text-lg">{nf.format(row.projectedClose)} {row.unit}</b></div><b className={delta < 0 ? "text-[#FF718C]" : "text-[#66E4AC]"}>{delta > 0 ? "+" : ""}{nf.format(delta)}</b></div><div className="mt-2 text-[10px] leading-4 text-white/55">{delta === 0 ? "직전 리비전 대비 수량 변화 없음" : row.statusReason}</div></div>
      {selected && <div className="mt-3 text-[10px] leading-4 text-[#777]">선택 이벤트 <b className="text-[#111]">{selected.reference}</b>가 원장·흐름·리비전 근거에서 함께 강조됩니다.</div>}
    </div>
  </aside>;
}

export default function DailyControlClient() {
  const [scenario, setScenario] = useState<DemoScenario>("delay");
  const [productionActuals, setProductionActuals] = useState<ProductionActuals>(DEFAULT_PRODUCTION_ACTUALS);
  const rows = useMemo(() => buildDailyControl(scenario, productionActuals), [scenario, productionActuals]);
  const riskFirst = rows.find((row) => row.status === "critical" || row.status === "warning" || row.status === "review")?.id ?? rows[0].id;
  const [selectedId, setSelectedId] = useState("sih4");
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const selected = rows.find((row) => row.id === selectedId) ?? rows.find((row) => row.id === riskFirst) ?? rows[0];
  const riskCount = rows.filter((row) => row.status === "critical" || row.status === "warning").length;
  const reviewCount = rows.filter((row) => row.status === "review").length;
  const plannedReceipts = rows.filter((row) => row.baseReceipt > 0 || row.remainingReceipt > 0).length;
  const completedReceipts = rows.filter((row) => row.actualReceipt > 0).length;

  function changeScenario(next: DemoScenario) {
    setScenario(next);
    setProductionActuals(next === "surge" ? { HBM: 13.2, DRAM: 17.6, NAND: 15.4 } : DEFAULT_PRODUCTION_ACTUALS);
    const focusMaterial: Record<DemoScenario, string> = { normal: "nf3", delay: "sih4", surge: "nf3", variance: "nf3" };
    setSelectedId(focusMaterial[next]);
    setSelectedEvent(null);
  }

  function selectMaterial(id: string) { setSelectedId(id); setSelectedEvent(null); }
  function changeProduction(product: ProductKey, value: number) {
    setProductionActuals((current) => ({ ...current, [product]: Math.max(0, Math.round(value * 10) / 10) }));
    setScenario(product === "HBM" && value > PRODUCTION_PLAN.HBM.plan ? "surge" : "normal");
    setSelectedId(product === "HBM" ? "nf3" : product === "DRAM" ? "arf-pr" : "h2o2");
    setSelectedEvent(null);
  }

  return <div className="mx-auto max-w-[1600px]">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="flex items-center gap-2"><h1 className="text-2xl font-extrabold tracking-tight">일일 생산 · 자재 연동</h1><span className="rounded-full bg-[#FFF0F2] px-2.5 py-1 text-[9px] font-black tracking-[0.08em] text-[#EA002C]">DEMO · 가상 운영 데이터</span></div><p className="mt-1 text-sm text-[#777]">제품별 일 생산실적 × 공정 원단위로 자재 사용량과 기말재고를 함께 계산합니다.</p></div>
      <div className="rounded-xl border bg-white px-4 py-3 text-right" style={{ borderColor: "var(--border)" }}><div className="text-[10px] font-bold text-[#999]">운영 기준 시각</div><div className="mt-0.5 text-sm font-black">2026.07.12 14:00 · R08</div><div className="mt-1 text-[9px] text-[#999]">가상 MES · WMS · 구매계획 · 다음 리비전 15:00</div></div>
    </div>

    <div className="mt-6 flex flex-wrap items-center gap-2"><span className="mr-1 text-[10px] font-extrabold text-[#777]">운영 시나리오</span>{SCENARIOS.map((item) => <button key={item.id} onClick={() => changeScenario(item.id)} className="rounded-full border px-3 py-2 text-[11px] font-bold transition-all" style={{ borderColor: scenario === item.id ? "#EA002C" : "var(--border)", color: scenario === item.id ? "#EA002C" : "#666", background: scenario === item.id ? "#FFF0F2" : "#fff" }}>{item.label}</button>)}</div>

    <div className="mt-4 rounded-2xl border bg-white p-5" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-sm font-extrabold">오늘 제품별 생산량</div><div className="mt-1 text-[11px] text-[#777]">실적을 조정하면 제품별 원단위를 통해 8개 자재의 사용량·현재고·마감예상이 즉시 다시 계산됩니다.</div></div><div className="rounded-lg bg-[#F8F6F4] px-3 py-2 text-[10px] text-[#777]">생산계획 → 원단위 → 자재 소요량 → 재고</div></div><div className="mt-4 grid gap-3 lg:grid-cols-3">{(Object.keys(PRODUCTION_PLAN) as ProductKey[]).map((product) => { const item = PRODUCTION_PLAN[product]; const actual = productionActuals[product]; const rate = actual / item.plan * 100; return <div key={product} className="rounded-xl border p-4" style={{ borderColor: "var(--border)" }}><div className="flex items-start justify-between"><div><div className="text-xs font-black">{item.label}</div><div className="mt-1 text-[9px] text-[#999]">금일 누적 생산실적</div></div><div className="text-right"><b className="text-xl tabular-nums">{actual.toFixed(1)}K</b><div className="text-[9px] text-[#999]">계획 {item.plan.toFixed(1)}K wafer</div></div></div><input aria-label={`${product} 생산실적`} type="range" min="0" max={item.plan * 1.25} step="0.1" value={actual} onChange={(event) => changeProduction(product, Number(event.target.value))} className="mt-4 w-full accent-[#EA002C]" /><div className="mt-2 flex items-center justify-between text-[10px]"><span className="text-[#777]">달성률</span><b style={{ color: rate > 105 ? "#EA002C" : rate >= 95 ? "#00875A" : "#B97500" }}>{rate.toFixed(1)}%</b></div></div>; })}</div></div>

    <div className="mt-4 rounded-2xl border border-[#F4C8CF] bg-gradient-to-r from-[#FFF5F6] to-white px-5 py-4"><div className="flex items-start gap-3"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EA002C] text-xs font-black text-white">!</span><div><div className="text-[10px] font-extrabold text-[#A14A58]">14:00 운영 브리핑</div><div className="mt-1 text-sm font-bold">{scenarioBriefing(scenario, rows)}</div><div className="mt-1 text-[10px] text-[#888]">{SCENARIOS.find((item) => item.id === scenario)?.note}</div></div></div></div>

    <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <KpiCard label="관리 품목 상태" value={`정상 ${rows.length - riskCount - reviewCount} · 위험 ${riskCount}`} note="서로 다른 자재 단위는 합산하지 않음" tone={riskCount ? "#EA002C" : "#00875A"} />
      <KpiCard label="오늘 입고" value={`${completedReceipts} / ${plannedReceipts}건`} note="검수 실적 / 금일 예정" tone="#00875A" />
      <KpiCard label="생산계획 달성" value={`${((productionActuals.HBM + productionActuals.DRAM + productionActuals.NAND) / (PRODUCTION_PLAN.HBM.plan + PRODUCTION_PLAN.DRAM.plan + PRODUCTION_PLAN.NAND.plan) * 100).toFixed(1)}%`} note="제품별 wafer 생산실적 기준" />
      <KpiCard label="정시 반영률" value={scenario === "delay" ? "92.4%" : "98.7%"} note="운영 SLA 15분 이내" tone={scenario === "delay" ? "#B97500" : "#00875A"} />
      <KpiCard label="확인 필요" value={`${reviewCount + (scenario === "delay" ? 1 : 0)}건`} note={reviewCount ? "실사 조정 승인 대기" : scenario === "delay" ? "입고 지연 확인" : "미확인 이벤트 없음"} tone={reviewCount || scenario === "delay" ? "#7C3AED" : "#00875A"} />
    </div>

    <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(340px,0.8fr)]">
      <div className="min-w-0 space-y-5"><FlowChart row={selected} selectedEvent={selectedEvent} onEvent={setSelectedEvent} /><MaterialTable rows={rows} selectedId={selected.id} onSelect={selectMaterial} /></div>
      <DetailPanel row={selected} selectedEvent={selectedEvent} onEvent={setSelectedEvent} />
    </div>

    <div className="mt-5 rounded-xl border border-dashed p-4 text-[10px] leading-5 text-[#777]" style={{ borderColor: "#C9C4BF" }}><b className="text-[#444]">데모 범위:</b> 실제 MongoDB, MES, WMS와 연결하지 않았습니다. 입력·승인·자동 갱신은 동작하지 않으며, 모든 현재고와 마감 예상은 같은 가상 이벤트 원장과 계산 규칙에서 파생됩니다.</div>
  </div>;
}
