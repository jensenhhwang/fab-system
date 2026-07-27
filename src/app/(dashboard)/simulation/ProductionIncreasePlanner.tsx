"use client";

import { useMemo, useState } from "react";
import {
  recommendMaterialOrders,
  type MaterialRecommendation,
  type ProductDemand,
  type ProductionPlanEvent,
  type ProductionPlanInput,
  type ScenarioMaterial,
} from "@/lib/scenario-engine";
import {
  parseMaterialScenarioPrompt,
  type CopilotFab,
  type MaterialScenarioInterpretation,
} from "@/lib/material-copilot";
import WhatIfActionCopilot from "./WhatIfActionCopilot";

const PRODUCTS: (keyof ProductDemand)[] = ["HBM", "DRAM", "NAND"];
const EXAMPLES = [
  "다음 달 1일부터 M20 HBM 생산을 6주간 20% 늘려줘",
  "8월 15일부터 M20 DRAM 생산을 30일간 10% 줄여줘",
  "현재 주의해서 봐야 할 자재와 이유를 알려줘",
];

function formatQty(value: number) {
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function dateAt(snapshotAt: string, day: number | null) {
  if (day === null) return "계산 불가";
  const date = new Date(snapshotAt);
  date.setDate(date.getDate() + day);
  return `${date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} · ${day === 0 ? "오늘" : day > 0 ? `D+${day}` : `D${day}`}`;
}

function warningStyle(severity: "HIGH" | "MEDIUM" | "LOW") {
  if (severity === "HIGH") return "bg-red-50 text-red-700";
  if (severity === "MEDIUM") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

function InterpretationEditor({
  fabId,
  event,
  horizonDays,
  coverageDays,
  onFabChange,
  onEventChange,
  onSettingsChange,
}: {
  fabId: CopilotFab | null;
  event: ProductionPlanEvent;
  horizonDays: number;
  coverageDays: number;
  onFabChange: (value: CopilotFab) => void;
  onEventChange: (patch: Partial<ProductionPlanEvent>) => void;
  onSettingsChange: (patch: Partial<Pick<ProductionPlanInput, "horizonDays" | "coverageDays">>) => void;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-extrabold text-blue-950">AI가 이렇게 해석했어요</div>
        <div className="text-[10px] text-blue-700">값을 수정하면 즉시 다시 계산됩니다.</div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <label className="text-[10px] font-bold text-blue-800">FAB
          <select value={fabId ?? ""} onChange={event => onFabChange(event.target.value as CopilotFab)} className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-2 py-2 text-xs text-[#141413]">
            {["M20", "M21", "M22"].map(item => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="text-[10px] font-bold text-blue-800">제품
          <select value={event.product} onChange={e => onEventChange({ product: e.target.value as keyof ProductDemand })} className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-2 py-2 text-xs text-[#141413]">
            {PRODUCTS.map(product => <option key={product}>{product}</option>)}
          </select>
        </label>
        <label className="text-[10px] font-bold text-blue-800">증감률
          <div className="relative"><input aria-label="증감률" type="number" min="-100" max="300" value={event.changePct} onChange={e => onEventChange({ changePct: Number(e.target.value) || 0 })} className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-2 py-2 pr-6 text-xs text-[#141413]"/><span className="absolute right-2 top-3 text-[10px] text-[#777]">%</span></div>
        </label>
        <label className="text-[10px] font-bold text-blue-800">시작
          <div className="relative"><input aria-label="시작일" type="number" min="0" value={event.startDay} onChange={e => onEventChange({ startDay: Math.max(0, Number(e.target.value) || 0) })} className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-2 py-2 pr-10 text-xs text-[#141413]"/><span className="absolute right-2 top-3 text-[10px] text-[#777]">일 뒤</span></div>
        </label>
        <label className="text-[10px] font-bold text-blue-800">유지 기간
          <div className="relative"><input aria-label="유지 기간" type="number" min="1" value={event.durationDays} onChange={e => onEventChange({ durationDays: Math.max(1, Number(e.target.value) || 1) })} className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-2 py-2 pr-7 text-xs text-[#141413]"/><span className="absolute right-2 top-3 text-[10px] text-[#777]">일</span></div>
        </label>
        <label className="text-[10px] font-bold text-blue-800">분석 기간
          <div className="relative"><input aria-label="분석 기간" type="number" min="30" value={horizonDays} onChange={e => onSettingsChange({ horizonDays: Math.max(30, Number(e.target.value) || 90) })} className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-2 py-2 pr-7 text-xs text-[#141413]"/><span className="absolute right-2 top-3 text-[10px] text-[#777]">일</span></div>
        </label>
        <label className="text-[10px] font-bold text-blue-800">입고 후 확보
          <div className="relative"><input aria-label="입고 후 확보" type="number" min="1" value={coverageDays} onChange={e => onSettingsChange({ coverageDays: Math.max(1, Number(e.target.value) || 30) })} className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-2 py-2 pr-7 text-xs text-[#141413]"/><span className="absolute right-2 top-3 text-[10px] text-[#777]">일</span></div>
        </label>
      </div>
    </div>
  );
}

function OrderTable({ rows, snapshotAt }: { rows: MaterialRecommendation[]; snapshotAt: string }) {
  if (rows.length === 0) return <div className="px-5 py-12 text-center text-sm text-emerald-700">이 시나리오 때문에 새로 늘어나는 발주량은 없습니다.</div>;
  return (
    <div className="max-h-[430px] overflow-auto">
      <table className="w-full min-w-[980px] text-xs">
        <thead className="sticky top-0 bg-[#F8F6F4] text-[#666]"><tr>{["상태", "자재", "기준 / 변경 소요", "가용·예약·확정입고", "기존 보충", "순수 추가발주", "입고 필요 / 발주 마감"].map(label => <th key={label} className="px-3 py-3 text-left">{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => {
          const urgent = row.normalOrderByDay === null || row.normalOrderByDay <= 0;
          const policyMissing = row.warnings.some(warning => warning.code === "PROCUREMENT_POLICY_MISSING");
          return <tr key={row.material.id} className="border-t align-top">
            <td className="px-3 py-3"><span className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-bold ${urgent ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>{urgent ? "즉시 확인" : "발주 예정"}</span></td>
            <td className="px-3 py-3"><b>{row.material.name}</b><div className="mt-1 font-mono text-[10px] text-[#777]">{row.material.code} · {row.material.supplierName ?? "공급사 미등록"}</div></td>
            <td className="px-3 py-3"><div>기준 {formatQty(row.baseline.grossRequirement)}</div><div className="mt-1 font-bold text-red-700">변경 {formatQty(row.scenario.grossRequirement)} <span className="text-[10px]">(+{formatQty(row.additionalRequirement)})</span></div></td>
            <td className="px-3 py-3"><div>가용 {formatQty(row.netInputs.available)}</div><div className="mt-1 text-[#777]">예약 {formatQty(row.netInputs.reserved)} · 확정입고 {formatQty(row.netInputs.confirmedInbound)}</div></td>
            <td className="px-3 py-3 text-right"><b>{formatQty(row.baseline.recommendedInbound)}</b> {row.material.unit}</td>
            <td className="px-3 py-3 text-right"><div className="text-base font-extrabold text-[#EA002C]">{formatQty(row.policyAdjustedOrderQuantity)} {row.material.unit}</div><div className="mt-1 text-[10px] text-[#777]">순증분 {formatQty(row.incrementalOrderQuantity)}{policyMissing ? " · 구매조건 미반영" : " · MOQ 반영"}</div></td>
            <td className="px-3 py-3"><b>입고 {dateAt(snapshotAt, row.needByDay)}</b><div className={`mt-1 text-[10px] font-bold ${urgent ? "text-red-700" : "text-blue-700"}`}>통상 발주 {dateAt(snapshotAt, row.normalOrderByDay)}</div><div className="mt-1 text-[10px] text-amber-700">안전 발주 {dateAt(snapshotAt, row.safeOrderByDay)}</div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
}

function AttentionTable({ rows, snapshotAt }: { rows: MaterialRecommendation[]; snapshotAt: string }) {
  if (rows.length === 0) return <div className="px-5 py-12 text-center text-sm text-emerald-700">현재 조건에서 별도 주의 경보가 없습니다.</div>;
  return (
    <div className="max-h-[430px] overflow-auto">
      <table className="w-full min-w-[860px] text-xs">
        <thead className="sticky top-0 bg-[#F8F6F4] text-[#666]"><tr>{["자재", "주의 근거", "현재 가용", "기준 보충", "첫 필요일", "데이터 근거"].map(label => <th key={label} className="px-3 py-3 text-left">{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.material.id} className="border-t align-top">
          <td className="px-3 py-3"><b>{row.material.name}</b><div className="mt-1 font-mono text-[10px] text-[#777]">{row.material.code}</div></td>
          <td className="px-3 py-3"><div className="flex max-w-[420px] flex-wrap gap-1">{row.warnings.map(warning => <span key={warning.code} className={`rounded-full px-2 py-1 text-[10px] font-bold ${warningStyle(warning.severity)}`}>{warning.label}</span>)}</div></td>
          <td className="px-3 py-3"><b>{formatQty(row.netInputs.available)} {row.material.unit}</b><div className="mt-1 text-[10px] text-[#777]">현재고 {formatQty(row.netInputs.onHand)}</div></td>
          <td className="px-3 py-3 text-right font-bold">{formatQty(row.baseline.recommendedInbound)} {row.material.unit}</td>
          <td className="px-3 py-3 font-bold">{dateAt(snapshotAt, row.scenario.firstNeedDay)}</td>
          <td className="px-3 py-3"><div>{row.evidence.usageSource}</div><div className="mt-1 font-mono text-[10px] text-[#777]">{row.evidence.usageSourceVersion ?? "버전 미등록"} · {row.evidence.formulaVersion}</div></td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}

export default function ProductionIncreasePlanner({ materials, snapshotAt }: { materials: ScenarioMaterial[]; snapshotAt: string }) {
  const [prompt, setPrompt] = useState(EXAMPLES[0]);
  const [interpretation, setInterpretation] = useState<MaterialScenarioInterpretation | null>(null);
  const [selectedFab, setSelectedFab] = useState<CopilotFab | null>(null);
  const [input, setInput] = useState<ProductionPlanInput>({ events: [], horizonDays: 90, replenishmentMode: "ROP", coverageDays: 30 });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"ORDER" | "ATTENTION">("ORDER");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNotice, setPushNotice] = useState<string | null>(null);

  const result = useMemo(() => recommendMaterialOrders(materials, input, selectedFab), [materials, input, selectedFab]);
  const orders = result.recommendations.filter(item => item.incrementalOrderQuantity > 0);
  const attention = result.recommendations
    .filter(item => item.warnings.length > 0)
    .sort((a, b) => Number(b.warnings.some(w => w.severity === "HIGH")) - Number(a.warnings.some(w => w.severity === "HIGH")) || a.material.code.localeCompare(b.material.code));
  const ready = interpretation !== null && interpretation.missingFields.length === 0;

  async function analyze() {
    if (!prompt.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/ai-material-scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, snapshotAt }),
      });
      if (!response.ok) throw new Error("AI 해석 요청 실패");
      const payload = await response.json() as { interpretation: MaterialScenarioInterpretation; notice?: string };
      applyInterpretation(payload.interpretation);
      setNotice(payload.notice ?? null);
    } catch {
      const fallback = parseMaterialScenarioPrompt(prompt, snapshotAt, "RULES_FALLBACK");
      applyInterpretation(fallback);
      setNotice("AI 연결이 원활하지 않아 안전 규칙으로 해석했습니다. 수량은 동일한 계산 엔진이 산출합니다.");
    } finally {
      setBusy(false);
    }
  }

  function applyInterpretation(next: MaterialScenarioInterpretation) {
    setInterpretation(next);
    setSelectedFab(next.fabId);
    setInput({ events: next.events, horizonDays: next.horizonDays, replenishmentMode: "ROP", coverageDays: next.coverageDays });
    setActiveTab(next.intent === "RISK_REVIEW" ? "ATTENTION" : "ORDER");
  }

  // 이 What-if 시나리오를 입고(PROCUREMENT) 그림자 조종석의 판단 입력으로 반영한다(MVP-1).
  async function pushToProcurement() {
    setPushBusy(true);
    setPushNotice(null);
    try {
      const response = await fetch("/api/agents/procurement/scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: prompt.trim().slice(0, 200) || "What-if 시나리오",
          events: input.events,
          horizonDays: input.horizonDays,
          coverageDays: input.coverageDays,
          fabId: selectedFab,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "입고 관제 반영 실패");
      setPushNotice("입고 관제(Procurement Cockpit)에 반영했습니다.");
    } catch (cause) {
      setPushNotice(cause instanceof Error ? cause.message : "입고 관제 반영 실패");
    } finally {
      setPushBusy(false);
    }
  }

  function updateEvent(patch: Partial<ProductionPlanEvent>) {
    setInput(current => ({ ...current, events: current.events.map((event, index) => index === 0 ? { ...event, ...patch } : event) }));
  }

  return <div className="space-y-5">
    <WhatIfActionCopilot fabId={selectedFab} input={input} />

    <section className="overflow-hidden rounded-3xl border border-[#D9D5D1] bg-[#171716] text-white shadow-[var(--shadow-1)]">
      <div className="grid gap-6 p-6 lg:grid-cols-[1fr_320px]">
        <div>
          <div className="flex items-center gap-2"><span className="rounded-full bg-[#EA002C] px-2.5 py-1 text-[10px] font-extrabold tracking-[.08em]">AI COPILOT</span><span className="text-[11px] text-white/50">읽기 전용 추천</span></div>
          <h2 className="mt-4 text-2xl font-extrabold leading-tight">생산 변경을 말하면,<br className="hidden sm:block"/> 필요한 자재 대응을 계산해 드려요.</h2>
          <p className="mt-2 text-xs leading-5 text-white/55">AI는 문장을 조건으로만 해석하고, 발주 수량과 날짜는 재현 가능한 계산 엔진이 산출합니다.</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[.06] p-4 text-xs text-white/70">
          <div className="font-bold text-white">분석 기준</div>
          <div className="mt-3 space-y-2"><div className="flex justify-between"><span>재고 스냅샷</span><b>{new Date(snapshotAt).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</b></div><div className="flex justify-between"><span>계산식</span><b>MATERIAL_COPILOT_V1</b></div><div className="flex justify-between"><span>실행 권한</span><b className="text-emerald-300">추천만 · 발주 안 함</b></div></div>
        </div>
      </div>
      <div className="border-t border-white/10 bg-white/[.04] p-4 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row">
          <textarea aria-label="자재 시나리오 입력" value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void analyze(); }} rows={2} className="min-h-[58px] flex-1 resize-none rounded-xl border border-white/10 bg-white px-4 py-3 text-sm font-medium text-[#141413] outline-none ring-[#EA002C] placeholder:text-[#999] focus:ring-2" placeholder="예: 다음 달부터 M20 HBM 생산을 20% 늘려줘"/>
          <button type="button" disabled={busy || !prompt.trim()} onClick={() => void analyze()} className="min-w-36 rounded-xl bg-[#EA002C] px-5 py-3 text-sm font-extrabold text-white transition hover:bg-[#C90025] disabled:opacity-50">{busy ? "해석 중..." : "추천 분석"}</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">{EXAMPLES.map(example => <button type="button" key={example} onClick={() => setPrompt(example)} className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] text-white/65 hover:bg-white/10">{example}</button>)}</div>
      </div>
    </section>

    {interpretation && <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-[11px] font-bold uppercase tracking-[.08em] text-[#777]">입력 해석</div><div className="mt-1 text-xs text-[#777]">{interpretation.intent === "RISK_REVIEW" ? "현재 기준계획에서 주의할 자재를 조회합니다." : "확인된 조건으로 기준계획과 변경계획을 비교합니다."}</div></div><span className={`rounded-full px-3 py-1 text-[10px] font-bold ${interpretation.parsedBy === "AI" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-600"}`}>{interpretation.parsedBy === "AI" ? "AI 해석" : "안전 규칙 해석"}</span></div>
      {interpretation.missingFields.length > 0 ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><b>계산 전에 확인이 필요해요.</b><div className="mt-1 text-xs">문장에 {interpretation.missingFields.join(", ")} 정보를 포함해 다시 입력해 주세요. 누락값은 임의로 만들지 않았습니다.</div></div> : interpretation.intent === "PRODUCTION_CHANGE" && input.events[0] ? <InterpretationEditor fabId={selectedFab} event={input.events[0]} horizonDays={input.horizonDays} coverageDays={input.coverageDays} onFabChange={setSelectedFab} onEventChange={updateEvent} onSettingsChange={patch => setInput(current => ({ ...current, ...patch }))}/> : <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-xs text-emerald-800">생산 변경 없이 현재 기준계획의 부족·리드타임·품질·원단위 위험을 확인합니다.</div>}
      {interpretation.assumptions.length > 0 && <div className="mt-3 text-[11px] text-[#777]">해석 기준: {interpretation.assumptions.join(" ")}</div>}
      {notice && <div className="mt-2 text-[11px] text-amber-700">{notice}</div>}
    </section>}

    {ready && <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border bg-white p-4"><div className="text-[11px] text-[#777]">영향 자재</div><div className="mt-2 text-2xl font-extrabold">{result.summary.affectedMaterials}종</div></div>
        <div className="rounded-2xl border bg-white p-4"><div className="text-[11px] text-[#777]">추가 발주</div><div className="mt-2 text-2xl font-extrabold text-[#EA002C]">{result.summary.incrementalOrders}종</div></div>
        <div className="rounded-2xl border bg-white p-4"><div className="text-[11px] text-[#777]">즉시 대응</div><div className="mt-2 text-2xl font-extrabold text-amber-600">{result.summary.urgentOrders}종</div></div>
        <div className="rounded-2xl border bg-white p-4"><div className="text-[11px] text-[#777]">주의 자재</div><div className="mt-2 text-2xl font-extrabold text-blue-700">{result.summary.attentionMaterials}종</div></div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
        <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="font-extrabold">AI 추천 결과</div><div className="mt-1 text-xs text-[#777]">기준계획과 변경계획을 같은 재고 스냅샷으로 비교했습니다.</div></div>
          <div className="flex rounded-xl bg-[#F3F0EE] p-1"><button type="button" onClick={() => setActiveTab("ORDER")} className={`rounded-lg px-4 py-2 text-xs font-bold ${activeTab === "ORDER" ? "bg-white text-[#EA002C] shadow-sm" : "text-[#666]"}`}>추가 발주 {orders.length}</button><button type="button" onClick={() => setActiveTab("ATTENTION")} className={`rounded-lg px-4 py-2 text-xs font-bold ${activeTab === "ATTENTION" ? "bg-white text-blue-700 shadow-sm" : "text-[#666]"}`}>주의 자재 {attention.length}</button></div>
        </div>
        {input.events.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-[#F8F9FB] px-5 py-2.5 text-xs">
            <span className="text-[#666]">이 시나리오를 입고 관제(그림자 조종석)의 판단 입력으로 반영할 수 있습니다.</span>
            <div className="flex items-center gap-2">
              {pushNotice && <span className="text-[#0078D4]">{pushNotice}</span>}
              <button type="button" disabled={pushBusy} onClick={() => void pushToProcurement()} className="rounded-lg bg-[#141413] px-3 py-1.5 font-bold text-white disabled:opacity-50">
                {pushBusy ? "반영 중…" : "입고 관제에 반영"}
              </button>
            </div>
          </div>
        )}
        {activeTab === "ORDER" ? <OrderTable rows={orders} snapshotAt={snapshotAt}/> : <AttentionTable rows={attention} snapshotAt={snapshotAt}/>}
      </section>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900"><b>추천 해석:</b> 추가발주량은 변경계획 권장입고량에서 기준계획 권장입고량을 뺀 값입니다. 확정 입고만 날짜별로 반영하며, 예약·품질보류 수량은 가용재고에서 제외합니다. MOQ·발주배수 정보가 없으면 순부족량만 표시합니다. 이 화면에서는 발주나 입고계획을 생성하지 않습니다.</div>
    </>}
  </div>;
}
