"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type BenefitCase = {
  id: string; title: string; category: string; valueType: string; status: string; materialId?: string | null;
  baselineDescription: string; systemFinding: string; actionTaken?: string | null; affectedQuantity?: number | null;
  unit?: string | null; unitPrice?: number | null; calculatedAmount?: number | null; approvedAmount?: number | null;
  detectedAt: string;
};
type Material = { id: string; code: string; name: string; unit: string };

const VALUE_LABEL: Record<string, string> = {
  CASH_SAVING: "현금성 효과", WORKING_CAPITAL: "운전자본", COST_AVOIDANCE: "비용 회피",
  TIME_VALUE: "업무시간 가치", RISK_AVOIDANCE: "위험 회피", FORECAST_QUALITY: "예측 품질",
};
const STATUS_LABEL: Record<string, string> = {
  HYPOTHESIS: "개선 가설", OBSERVED: "사례 발견", CALCULATED: "금액 산정", VALIDATED: "검증 완료",
  REALIZED: "효과 실현", NOT_REALIZED: "미실현", REJECTED: "불인정",
};

function money(value: number) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억원`;
  if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString()}만원`;
  return `${value.toLocaleString()}원`;
}

export default function ValueClient({ cases, materials }: { cases: BenefitCase[]; materials: Material[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ title: "", category: "COST", valueType: "COST_AVOIDANCE", materialId: "", baselineDescription: "", systemFinding: "", actionTaken: "", affectedQuantity: "", unit: "", unitPrice: "", evidence: "" });

  const summary = useMemo(() => {
    const validated = cases.filter((item) => item.status === "VALIDATED" || item.status === "REALIZED");
    const byType = (type: string) => validated.filter((item) => item.valueType === type).reduce((sum, item) => sum + (item.approvedAmount ?? item.calculatedAmount ?? 0), 0);
    return {
      cash: byType("CASH_SAVING"), working: byType("WORKING_CAPITAL"), avoidance: byType("COST_AVOIDANCE"),
      risk: byType("RISK_AVOIDANCE"), pending: cases.filter((item) => item.status === "OBSERVED" || item.status === "CALCULATED").length,
    };
  }, [cases]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError("");
    const res = await fetch("/api/value", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "저장하지 못했습니다."); setSaving(false); return; }
    setOpen(false); setSaving(false); router.refresh();
  }

  const cards = [
    ["확정 현금성 효과", summary.cash, "실현·검증된 절감"], ["운전자본 개선", summary.working, "평균 재고금액 감소"],
    ["검증 완료 비용 회피", summary.avoidance, "발주·폐기 비용 방지"], ["위험 회피 추정", summary.risk, "별도 추정값"],
  ] as const;

  return <div>
    <div className="flex items-end justify-between mb-7">
      <div><div className="text-2xl font-extrabold tracking-tight">성과 관리</div><div className="text-sm text-[#777] mt-1">운영 개선을 사례·산식·증거로 검증하는 가치 원장</div></div>
      <button onClick={() => setOpen(true)} className="px-4 py-2.5 rounded-xl bg-[#141413] text-white text-sm font-bold">효과 사례 추가</button>
    </div>
    <div className="grid grid-cols-4 gap-4 mb-4">
      {cards.map(([label, value, note]) => <div key={label} className="bg-white rounded-2xl border border-[var(--border)] p-5 shadow-[var(--shadow-1)]">
        <div className="text-[11px] uppercase tracking-[0.08em] font-bold text-[#777]">{label}</div><div className="text-2xl font-extrabold mt-3">{money(value)}</div><div className="text-xs text-[#999] mt-1">{note}</div>
      </div>)}
    </div>
    <div className="flex justify-end mb-6 text-xs text-[#777]">검증 대기 <span className="ml-2 font-bold text-[#F47725]">{summary.pending}건</span></div>
    <div className="bg-white rounded-2xl border border-[var(--border)] overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--border)]"><div className="font-bold">효과 사례 원장</div><div className="text-xs text-[#888] mt-1">금액 성격이 다른 항목은 하나의 총액으로 합산하지 않습니다.</div></div>
      {cases.length === 0 ? <div className="text-center py-16"><div className="font-bold text-[#444]">아직 기록된 효과 사례가 없습니다.</div><div className="text-sm text-[#999] mt-2">과잉발주 감축, 폐기 방지, 업무시간 단축 사례부터 기록해보세요.</div><button onClick={() => setOpen(true)} className="mt-5 px-4 py-2 rounded-xl border border-[#141413] text-sm font-bold">첫 사례 기록</button></div> :
      <div className="divide-y divide-[var(--border)]">{cases.map((item) => <div key={item.id} className="px-5 py-4 flex items-center gap-4">
        <div className="flex-1"><div className="font-bold text-sm">{item.title}</div><div className="text-xs text-[#888] mt-1">{VALUE_LABEL[item.valueType] ?? item.valueType} · {new Date(item.detectedAt).toLocaleDateString("ko-KR")}</div></div>
        <div className="text-right"><div className="font-bold">{item.calculatedAmount != null ? money(item.calculatedAmount) : "측정 전"}</div><div className="text-[11px] text-[#777] mt-1">{STATUS_LABEL[item.status] ?? item.status}</div></div>
      </div>)}</div>}
    </div>
    <div className="mt-5 rounded-2xl border border-dashed border-[#CFC8C2] bg-[#FCFBFA] p-5"><div className="font-bold text-sm">산정 원칙</div><div className="grid grid-cols-3 gap-4 mt-3 text-xs text-[#666]"><div>시스템은 수량×단가를 계산합니다.</div><div>담당자가 기준 상황과 귀속을 검증합니다.</div><div>검증 완료 이상만 상단 성과에 반영합니다.</div></div></div>
    {open && <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-6"><form onSubmit={submit} className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 shadow-2xl">
      <div className="flex justify-between items-start"><div><div className="text-xl font-extrabold">효과 사례 기록</div><div className="text-xs text-[#888] mt-1">먼저 발견 사실을 기록하고, 검증은 이후에 진행합니다.</div></div><button type="button" onClick={() => setOpen(false)} className="text-[#999]">닫기</button></div>
      <div className="grid grid-cols-2 gap-4 mt-6">
        <label className="col-span-2 text-xs font-bold">제목<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 w-full border rounded-xl px-3 py-2.5 font-normal" placeholder="EUV PR 과잉입고 감축" /></label>
        <label className="text-xs font-bold">운영 분류<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full border rounded-xl px-3 py-2.5 font-normal"><option value="COST">비용</option><option value="TIME">업무시간</option><option value="RISK">위험</option><option value="QUALITY">데이터 품질</option><option value="CONTROL">운영 통제</option></select></label>
        <label className="text-xs font-bold">가치 유형<select value={form.valueType} onChange={(e) => setForm({ ...form, valueType: e.target.value })} className="mt-1 w-full border rounded-xl px-3 py-2.5 font-normal">{Object.entries(VALUE_LABEL).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="col-span-2 text-xs font-bold">관련 자재<select value={form.materialId} onChange={(e) => { const m=materials.find(x=>x.id===e.target.value); setForm({ ...form, materialId:e.target.value, unit:m?.unit ?? form.unit }); }} className="mt-1 w-full border rounded-xl px-3 py-2.5 font-normal"><option value="">공통/선택 안 함</option>{materials.map(m=><option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</select></label>
        <label className="col-span-2 text-xs font-bold">기준 상황<textarea required value={form.baselineDescription} onChange={(e)=>setForm({...form,baselineDescription:e.target.value})} className="mt-1 w-full border rounded-xl px-3 py-2.5 font-normal" placeholder="시스템이 없었다면 어떤 일이 발생했을지" /></label>
        <label className="col-span-2 text-xs font-bold">시스템이 발견한 것<textarea required value={form.systemFinding} onChange={(e)=>setForm({...form,systemFinding:e.target.value})} className="mt-1 w-full border rounded-xl px-3 py-2.5 font-normal" /></label>
        <label className="col-span-2 text-xs font-bold">실제 조치<textarea value={form.actionTaken} onChange={(e)=>setForm({...form,actionTaken:e.target.value})} className="mt-1 w-full border rounded-xl px-3 py-2.5 font-normal" /></label>
        <label className="text-xs font-bold">영향 수량<input type="number" min="0" value={form.affectedQuantity} onChange={(e)=>setForm({...form,affectedQuantity:e.target.value})} className="mt-1 w-full border rounded-xl px-3 py-2.5 font-normal" /></label>
        <label className="text-xs font-bold">단가(원)<input type="number" min="0" value={form.unitPrice} onChange={(e)=>setForm({...form,unitPrice:e.target.value})} className="mt-1 w-full border rounded-xl px-3 py-2.5 font-normal" /></label>
      </div>
      {error && <div className="mt-4 text-sm text-[#EA002C]">{error}</div>}
      <div className="flex justify-end gap-2 mt-6"><button type="button" onClick={()=>setOpen(false)} className="px-4 py-2 rounded-xl border text-sm">취소</button><button disabled={saving} className="px-4 py-2 rounded-xl bg-[#141413] text-white text-sm font-bold disabled:opacity-50">{saving ? "저장 중" : "사례 저장"}</button></div>
    </form></div>}
  </div>;
}
