"use client";

import { useMemo, useState } from "react";
import {
  planProductionChanges, type ProductDemand, type ProductionPlanEvent,
  type ProductionPlanInput, type ScenarioMaterial,
} from "@/lib/scenario-engine";

const PRODUCTS: (keyof ProductDemand)[] = ["HBM", "DRAM", "NAND"];
const PRODUCT_COLOR = { HBM: "#EA002C", DRAM: "#2563EB", NAND: "#8B5CF6" };
const PRIORITY = {
  OVERDUE: { label: "즉시 대응", style: "bg-red-50 text-red-700" },
  NOW: { label: "오늘 발주", style: "bg-amber-50 text-amber-700" },
  PLANNED: { label: "발주 예정", style: "bg-blue-50 text-blue-700" },
  LEAD_TIME_MISSING: { label: "리드타임 미등록", style: "bg-gray-100 text-gray-600" },
};

const INITIAL_EVENTS: ProductionPlanEvent[] = [
  { id: "event-hbm", product: "HBM", startDay: 2, changePct: 30, durationDays: 30 },
  { id: "event-dram", product: "DRAM", startDay: 2, changePct: -15, durationDays: 30 },
];

function formatQty(value: number) { return value.toLocaleString("ko-KR", { maximumFractionDigits: 2 }); }
function dateAt(snapshotAt: string, day: number | null) {
  if (day === null) return "발주일 계산 불가";
  const date = new Date(snapshotAt); date.setDate(date.getDate() + day);
  return `${date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} · ${day === 0 ? "오늘" : day > 0 ? `D+${day}` : `D${day}`}`;
}

function EventCard({ event, index, canDelete, onChange, onCopy, onDelete }: {
  event: ProductionPlanEvent; index: number; canDelete: boolean;
  onChange: (patch: Partial<ProductionPlanEvent>) => void; onCopy: () => void; onDelete: () => void;
}) {
  return <div className="rounded-xl border bg-[#FCFBFA] p-3">
    <div className="mb-3 flex items-center justify-between">
      <div><span className="text-[10px] font-bold text-[#999]">변경 {index + 1}</span><div className="mt-0.5 text-sm font-extrabold" style={{ color: PRODUCT_COLOR[event.product] }}>D+{event.startDay} · {event.product} · {event.changePct >= 0 ? "+" : ""}{event.changePct}%</div></div>
      <div className="flex gap-1"><button type="button" onClick={onCopy} className="rounded-lg border px-2 py-1 text-[10px] text-[#666]">복제</button><button type="button" disabled={!canDelete} onClick={onDelete} className="rounded-lg border px-2 py-1 text-[10px] text-[#EA002C] disabled:opacity-30">삭제</button></div>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <label className="text-[10px] font-bold text-[#777]">제품<select aria-label={`변경 ${index + 1} 대상 제품`} value={event.product} onChange={e => onChange({ product: e.target.value as keyof ProductDemand })} className="mt-1 w-full rounded-lg border bg-white px-2 py-2 text-xs font-normal">{PRODUCTS.map(product => <option key={product}>{product}</option>)}</select></label>
      <label className="text-[10px] font-bold text-[#777]">생산량 변화<div className="relative"><input aria-label={`변경 ${index + 1} 생산량 변화`} type="number" min="-100" max="300" value={event.changePct} onChange={e => onChange({ changePct: Math.max(-100, Math.min(300, Number(e.target.value) || 0)) })} className="mt-1 w-full rounded-lg border bg-white px-2 py-2 pr-7 text-xs font-normal"/><span className="absolute right-2 top-3 text-[10px] text-[#999]">%</span></div></label>
      <label className="text-[10px] font-bold text-[#777]">시작<div className="relative"><input aria-label={`변경 ${index + 1} 시작일`} type="number" min="0" max="365" value={event.startDay} onChange={e => onChange({ startDay: Math.max(0, Number(e.target.value) || 0) })} className="mt-1 w-full rounded-lg border bg-white px-2 py-2 pr-10 text-xs font-normal"/><span className="absolute right-2 top-3 text-[10px] text-[#999]">일 뒤</span></div></label>
      <label className="text-[10px] font-bold text-[#777]">유지 기간<div className="relative"><input aria-label={`변경 ${index + 1} 유지 기간`} type="number" min="1" max="365" value={event.durationDays} onChange={e => onChange({ durationDays: Math.max(1, Number(e.target.value) || 1) })} className="mt-1 w-full rounded-lg border bg-white px-2 py-2 pr-7 text-xs font-normal"/><span className="absolute right-2 top-3 text-[10px] text-[#999]">일</span></div></label>
    </div>
  </div>;
}

export default function ProductionIncreasePlanner({ materials, snapshotAt }: { materials: ScenarioMaterial[]; snapshotAt: string }) {
  const [input, setInput] = useState<ProductionPlanInput>({ events: INITIAL_EVENTS, horizonDays: 90, replenishmentMode: "ROP", coverageDays: 30 });
  const plan = useMemo(() => planProductionChanges(materials, input), [materials, input]);
  const urgent = plan.actions.filter(action => action.priority === "OVERDUE" || action.priority === "NOW").length;
  const updateEvent = (id: string, patch: Partial<ProductionPlanEvent>) => setInput(current => ({ ...current, events: current.events.map(event => event.id === id ? { ...event, ...patch } : event) }));
  const addEvent = (source?: ProductionPlanEvent) => setInput(current => ({ ...current, events: [...current.events, { id: crypto.randomUUID(), product: source?.product ?? "NAND", startDay: source?.startDay ?? 7, changePct: source?.changePct ?? 10, durationDays: source?.durationDays ?? 30 }] }));

  return <div className="space-y-5">
    <section className="grid grid-cols-[380px_1fr] gap-5 items-start">
      <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <div className="flex items-center justify-between"><div><div className="text-[11px] font-bold uppercase tracking-[.08em] text-[#777]">생산계획 이벤트</div><div className="mt-1 text-xs text-[#999]">여러 증·감산을 하나의 시나리오로 계산합니다.</div></div><span className="rounded-full bg-[#F3F0EE] px-2 py-1 text-[10px] font-bold">{input.events.length}개</span></div>
        <div className="mt-4 max-h-[510px] space-y-3 overflow-y-auto pr-1">{input.events.map((event, index) => <EventCard key={event.id} event={event} index={index} canDelete={input.events.length > 1} onChange={patch => updateEvent(event.id, patch)} onCopy={() => addEvent(event)} onDelete={() => setInput(current => ({ ...current, events: current.events.filter(item => item.id !== event.id) }))}/>)}</div>
        <button type="button" onClick={() => addEvent()} className="mt-3 w-full rounded-xl border-2 border-dashed py-2.5 text-xs font-bold text-[#2563EB]">+ 생산 변경 추가</button>
        <div className="mt-5 border-t pt-4"><div className="text-[11px] font-bold uppercase tracking-[.08em] text-[#777]">공통 보충 설정</div><div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-[10px] font-bold text-[#777]">입고 후 확보<div className="relative"><input aria-label="입고 후 확보 일수" type="number" min="1" max="90" value={input.coverageDays} onChange={e => setInput(current => ({ ...current, coverageDays: Math.max(1, Number(e.target.value) || 1) }))} className="mt-1 w-full rounded-lg border px-2 py-2 pr-7 text-xs"/><span className="absolute right-2 top-3 text-[10px] text-[#999]">일</span></div></label>
          <label className="text-[10px] font-bold text-[#777]">보충 기준<select value={input.replenishmentMode} onChange={e => setInput(current => ({ ...current, replenishmentMode: e.target.value as "ROP" | "STOCKOUT" }))} className="mt-1 w-full rounded-lg border px-2 py-2 text-xs"><option value="ROP">ROP 유지</option><option value="STOCKOUT">결품 방지</option></select></label>
        </div></div>
      </div>

      <div className="space-y-4 min-w-0">
        <div className="rounded-2xl border bg-white p-4"><div className="text-xs font-bold">생산 변경 타임라인</div><div className="mt-3 space-y-2">{input.events.slice().sort((a,b) => a.startDay-b.startDay).map(event => <div key={event.id} className="grid grid-cols-[70px_1fr_80px] items-center gap-2 text-[11px]"><b style={{ color: PRODUCT_COLOR[event.product] }}>{event.product}</b><div className="h-6 rounded bg-[#F3F0EE] overflow-hidden"><div className="h-full rounded opacity-80" style={{ marginLeft: `${Math.min(90, event.startDay / input.horizonDays * 100)}%`, width: `${Math.max(2, Math.min(100, event.durationDays / input.horizonDays * 100))}%`, backgroundColor: PRODUCT_COLOR[event.product] }}/></div><span className="text-right font-bold">D+{event.startDay} {event.changePct >= 0 ? "+" : ""}{event.changePct}%</span></div>)}</div></div>
        <div className="grid grid-cols-3 gap-3"><div className="rounded-2xl border bg-white p-4"><div className="text-[11px] text-[#888]">판정</div><div className={`mt-2 text-xl font-extrabold ${plan.status === "FEASIBLE" ? "text-emerald-600" : "text-[#EA002C]"}`}>{plan.status === "FEASIBLE" ? "계획 가능" : plan.status === "URGENT" ? "긴급 대응 필요" : "리드타임 확인 필요"}</div></div><div className="rounded-2xl border bg-white p-4"><div className="text-[11px] text-[#888]">영향 자재</div><div className="mt-2 text-2xl font-extrabold">{plan.materials.length}종</div></div><div className="rounded-2xl border bg-white p-4"><div className="text-[11px] text-[#888]">즉시 확인</div><div className="mt-2 text-2xl font-extrabold text-[#EA002C]">{urgent}건</div></div></div>
        <div className="rounded-2xl border border-[var(--border)] bg-white overflow-hidden"><div className="flex items-center justify-between border-b px-5 py-4"><div><div className="font-extrabold">통합 자재 입고 액션</div><div className="mt-1 text-xs text-[#888]">모든 생산 변경을 날짜별 순수요로 합산했습니다.</div></div><span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-bold text-blue-700">CALCULATED</span></div>
          {plan.actions.length === 0 ? <div className="p-12 text-center text-sm text-emerald-700">분석기간 내 추가 입고 없이 생산계획을 충족합니다.</div> : <div className="max-h-[500px] overflow-auto"><table className="w-full text-xs"><thead className="sticky top-0 bg-[#F8F6F4] text-[#777]"><tr>{["상태","자재·공급사","통상 / 안전 발주","입고 마감","권장 수량","수요 원인"].map(label => <th key={label} className="px-3 py-3 text-left">{label}</th>)}</tr></thead><tbody>{plan.actions.map((action,index) => { const priority=PRIORITY[action.priority]; return <tr key={`${action.materialId}-${action.inboundDay}-${index}`} className="border-t"><td className="px-3 py-3"><span className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-bold ${priority.style}`}>{priority.label}</span></td><td className="px-3 py-3"><b>{action.name}</b><div className="mt-0.5 font-mono text-[10px] text-[#888]">{action.code} · {action.supplierName ?? "승인 공급사 미등록"}</div>{action.procurementAlternatives.length>0&&<div className="mt-1 text-[10px] text-blue-700">대안: {action.procurementAlternatives.map(item=>`${item.supplierName}${item.emergencyOrderAllowed?"(긴급)":""}`).join(", ")}</div>}</td><td className="px-3 py-3"><div className="font-bold">통상 {dateAt(snapshotAt,action.orderDay)}</div><div className="mt-1 text-[10px] text-[#666]">{action.leadTimeDays??"?"}일 · {action.leadTimeSource}</div><div className="mt-1 font-bold text-amber-700">안전 {action.safeOrderDay===null?"범위 미등록":dateAt(snapshotAt,action.safeOrderDay)}</div></td><td className="px-3 py-3 font-bold">{dateAt(snapshotAt,action.inboundDay)}</td><td className="px-3 py-3 text-right font-extrabold">{formatQty(action.quantity)} {action.unit}</td><td className="px-3 py-3 text-[#666]">{action.reason === "EXISTING_RISK" ? <div className="font-bold text-amber-700">기존 재고도 기준 미달</div> : null}{action.drivers.length ? action.drivers.map(driver => <div key={driver.product}>{driver.product} {driver.changePct >= 0 ? "+" : ""}{driver.changePct}% <span className={driver.dailyDelta >= 0 ? "text-red-600" : "text-blue-600"}>({driver.dailyDelta >= 0 ? "+" : ""}{driver.dailyDelta.toFixed(1)}/일)</span></div>) : <span className="text-[#999]">기준 수요</span>}</td></tr>;})}</tbody></table></div>}
        </div>
      </div>
    </section>
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900"><b>계산 규칙:</b> 이벤트는 시작일 포함·종료일 제외로 적용하며, 같은 제품의 중첩 변화율은 합산합니다. 감산은 최대 -100%까지 적용됩니다. 리드타임이 없어도 입고 필요일과 수량은 계산되고 발주일만 미표시됩니다.</div>
  </div>;
}
