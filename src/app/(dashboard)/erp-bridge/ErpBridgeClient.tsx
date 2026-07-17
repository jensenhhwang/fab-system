"use client";

import { useSession } from "next-auth/react";
import { useState } from "react";

type PlanStatus = "DRAFT" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
type Plan = {
  _id: string; planNo: string; materialId: string; supplierId: string; unit: string;
  plannedDate: string; plannedQuantity: number; receivedQuantity: number; remainingQuantity: number;
  status: PlanStatus; note?: string | null; createdBy: string; createdAt: string;
};
type Material = { _id: string; code: string; name: string; unit: string };
type Supplier = { _id: string; name: string };
type SupplierLink = { materialId: string; supplierId: string; qualificationStatus?: string };
type Form = { materialId: string; supplierId: string; plannedDate: string; plannedQuantity: string; note: string };
type ScaleUpProposal = {
  materialId: string; code: string; name: string; unit: string;
  currentQuantity: number; safetyStock: number; dailyUsage: number; activeInboundQuantity: number;
  targetQuantity: number; replenishmentQuantity: number; projectedDoh: number | null;
  reviewStatus: "READY" | "CAPACITY_REVIEW" | "MASTER_DATA_REVIEW"; blockReason: string | null; canCreate: boolean;
};
type ScaleUpOverview = {
  formulaVersion: string;
  proposals: ScaleUpProposal[];
  counts: { total: number; ready: number; capacityReview: number; masterReview: number; creatable: number };
};

const EMPTY: Form = { materialId: "", supplierId: "", plannedDate: "", plannedQuantity: "", note: "" };
const STATUS: Record<PlanStatus, { label: string; style: string }> = {
  DRAFT: { label: "초안", style: "bg-slate-100 text-slate-700" },
  CONFIRMED: { label: "확정", style: "bg-blue-50 text-blue-700" },
  COMPLETED: { label: "완료", style: "bg-emerald-50 text-emerald-700" },
  CANCELLED: { label: "취소", style: "bg-red-50 text-red-700" },
};

export default function ErpBridgeClient({ initialPlans, materials, suppliers, supplierLinks, scaleUpOverview }: {
  initialPlans: Plan[]; materials: Material[]; suppliers: Supplier[]; supplierLinks: SupplierLink[]; scaleUpOverview: ScaleUpOverview;
}) {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canManage = role === "ADMIN" || role === "MATERIALS";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const materialMap = new Map(materials.map(item => [item._id, item]));
  const supplierMap = new Map(suppliers.map(item => [item._id, item]));
  const availableSupplierIds = new Set(supplierLinks.filter(link => !form.materialId || link.materialId === form.materialId).map(link => link.supplierId));
  const availableSuppliers = suppliers.filter(supplier => availableSupplierIds.has(supplier._id));
  const active = initialPlans.filter(plan => plan.status === "DRAFT" || plan.status === "CONFIRMED").length;
  const confirmed = initialPlans.filter(plan => plan.status === "CONFIRMED").length;

  function choose(plan: Plan) {
    if (plan.status !== "DRAFT") return;
    setSelectedId(plan._id);
    setForm({ materialId: plan.materialId, supplierId: plan.supplierId, plannedDate: plan.plannedDate.slice(0, 10), plannedQuantity: String(plan.plannedQuantity), note: plan.note ?? "" });
    setMessage("");
  }

  function changeMaterial(materialId: string) {
    const supplierId = supplierLinks.find(link => link.materialId === materialId)?.supplierId ?? "";
    setForm(current => ({ ...current, materialId, supplierId }));
  }

  async function request(url: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "처리하지 못했습니다.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "처리하지 못했습니다.");
      setBusy(false);
    }
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    const body = { ...form, plannedQuantity: Number(form.plannedQuantity) };
    void request(selectedId ? `/api/inbound-plans/${selectedId}` : "/api/inbound-plans", selectedId ? "PATCH" : "POST", selectedId ? { ...body, action: "UPDATE" } : body);
  }

  function cancel(plan: Plan) {
    const reason = window.prompt(`${plan.planNo} 취소 사유를 입력해주세요.`)?.trim();
    if (reason) void request(`/api/inbound-plans/${plan._id}`, "PATCH", { action: "CANCEL", reason });
  }

  return <div>
    <div className="mb-5 flex items-end justify-between gap-4">
      <div><h1 className="text-2xl font-extrabold">계획·실행 브리지</h1><p className="mt-1 text-sm text-[#888]">수동 입고계획을 WMS 실입고와 연결합니다.</p></div>
      <span className="rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-bold text-indigo-700">PLANNING BRIDGE</span>
    </div>
    <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
      <b>시스템 한계:</b> 이 모듈은 회계·세무·결산 또는 외부 거래를 처리하는 ERP가 아닙니다. 사용자가 입력한 계획을 WMS 실행 데이터와 연결하며, 입력 정확성과 외부 ERP 자료와의 일치 여부는 사용자가 확인해야 합니다.
    </div>
    <div className="mb-5 rounded-2xl border border-blue-200 bg-blue-50/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="text-sm font-extrabold text-blue-950">저재고 스케일업</div><p className="mt-1 text-xs leading-5 text-blue-800">목표는 최소 안전재고 + 1일 수요입니다. 기존 초안·확정 입고는 재고포지션에 포함해 중복 계획을 막습니다.</p></div>
        <button disabled={!canManage || busy || scaleUpOverview.counts.creatable === 0} onClick={() => void request("/api/inbound-plans/scale-up", "POST", { requestId: crypto.randomUUID() })} className="rounded-xl bg-blue-700 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40">보충계획 {scaleUpOverview.counts.creatable}건 생성</button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["보충 필요", scaleUpOverview.counts.total], ["즉시 검토", scaleUpOverview.counts.ready], ["Capacity 검토", scaleUpOverview.counts.capacityReview], ["마스터 검토", scaleUpOverview.counts.masterReview]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-white px-3 py-2"><div className="text-[10px] text-[#888]">{label}</div><b className="mt-1 block text-lg text-blue-950">{value}건</b></div>)}
      </div>
      {scaleUpOverview.proposals.length > 0 && <div className="mt-4 overflow-x-auto rounded-xl border border-blue-100 bg-white"><table className="w-full text-[11px]"><thead className="bg-blue-50 text-blue-900"><tr>{["자재", "현재고", "안전재고", "목표", "신규 보충", "예상 DOH", "분류"].map(label => <th key={label} className="whitespace-nowrap px-3 py-2 text-left">{label}</th>)}</tr></thead><tbody>{scaleUpOverview.proposals.slice(0, 12).map(item => <tr key={item.materialId} className="border-t border-blue-50" title={item.blockReason ?? undefined}><td className="px-3 py-2"><b>{item.code}</b><div className="text-[9px] text-[#888]">{item.name}</div></td><td className="px-3 py-2 text-right">{item.currentQuantity.toLocaleString()}</td><td className="px-3 py-2 text-right">{item.safetyStock.toLocaleString()}</td><td className="px-3 py-2 text-right font-bold">{item.targetQuantity.toLocaleString()}</td><td className="px-3 py-2 text-right font-bold text-blue-700">+{item.replenishmentQuantity.toLocaleString()}</td><td className="px-3 py-2 text-right">{item.projectedDoh?.toFixed(1) ?? "—"}일</td><td className="px-3 py-2"><span className={`rounded-full px-2 py-1 text-[9px] font-bold ${item.reviewStatus === "READY" ? "bg-emerald-50 text-emerald-700" : item.reviewStatus === "CAPACITY_REVIEW" ? "bg-amber-50 text-amber-700" : "bg-violet-50 text-violet-700"}`}>{item.reviewStatus === "READY" ? "계획 가능" : item.reviewStatus === "CAPACITY_REVIEW" ? "분할 검토" : "마스터 검토"}</span></td></tr>)}</tbody></table>{scaleUpOverview.proposals.length > 12 && <div className="border-t p-2 text-center text-[10px] text-[#888]">외 {scaleUpOverview.proposals.length - 12}건</div>}</div>}
    </div>
    <div className="mb-5 grid gap-3 sm:grid-cols-3">
      {[["전체 입고계획", initialPlans.length, "건"], ["진행 중", active, "건"], ["WMS 입고 대기", confirmed, "건"]].map(([label, value, unit]) => <div key={String(label)} className="rounded-2xl border bg-white p-4"><div className="text-[11px] text-[#888]">{label}</div><div className="mt-2 text-2xl font-extrabold">{value}<span className="ml-1 text-xs font-normal text-[#999]">{unit}</span></div></div>)}
    </div>
    <div className="grid items-start gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
      <form onSubmit={save} className="rounded-2xl border bg-white p-5">
        <div className="mb-4 flex items-center justify-between"><h2 className="font-extrabold">{selectedId ? "초안 수정" : "입고계획 등록"}</h2>{selectedId && <button type="button" onClick={() => { setSelectedId(null); setForm(EMPTY); }} className="text-xs font-bold text-blue-700">새 계획</button>}</div>
        <div className="space-y-3">
          <label className="block text-xs font-bold">자재<select disabled={!canManage || busy} required value={form.materialId} onChange={event => changeMaterial(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"><option value="">선택</option>{materials.map(item => <option key={item._id} value={item._id}>{item.code} — {item.name}</option>)}</select></label>
          <label className="block text-xs font-bold">공급사<select disabled={!canManage || busy || !form.materialId} required value={form.supplierId} onChange={event => setForm({ ...form, supplierId: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"><option value="">선택</option>{availableSuppliers.map(item => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label>
          <label className="block text-xs font-bold">입고 예정일<input disabled={!canManage || busy} required type="date" value={form.plannedDate} onChange={event => setForm({ ...form, plannedDate: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal" /></label>
          <label className="block text-xs font-bold">계획수량 <span className="font-normal text-[#999]">{materialMap.get(form.materialId)?.unit ?? ""}</span><input disabled={!canManage || busy} required min="0.000001" step="any" type="number" value={form.plannedQuantity} onChange={event => setForm({ ...form, plannedQuantity: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal" /></label>
          <label className="block text-xs font-bold">메모<textarea disabled={!canManage || busy} value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2 font-normal" /></label>
        </div>
        {message && <div className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{message}</div>}
        <button disabled={!canManage || busy} className="mt-4 w-full rounded-xl bg-[#141413] py-2.5 text-xs font-bold text-white disabled:opacity-40">{busy ? "처리 중..." : selectedId ? "초안 저장" : "초안 등록"}</button>
        {!canManage && <p className="mt-3 text-[11px] text-[#999]">ADMIN·MATERIALS 역할만 계획을 관리할 수 있습니다.</p>}
      </form>
      <div className="overflow-hidden rounded-2xl border bg-white">
        <div className="border-b px-5 py-4"><h2 className="font-extrabold">입고계획 원장</h2><p className="mt-1 text-[11px] text-[#888]">확정 계획은 WMS 입고 등록에서 선택할 수 있습니다.</p></div>
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-[#F8F6F4] text-[#777]"><tr>{["계획번호","자재·공급사","예정일","계획","입고","잔여","상태","작업"].map(label => <th key={label} className="whitespace-nowrap px-3 py-3 text-left">{label}</th>)}</tr></thead>
          <tbody>{initialPlans.map(plan => { const status = STATUS[plan.status]; return <tr key={plan._id} onClick={() => choose(plan)} className={`border-t ${plan.status === "DRAFT" ? "cursor-pointer hover:bg-blue-50/40" : ""}`}>
            <td className="whitespace-nowrap px-3 py-3 font-mono font-bold">{plan.planNo}</td><td className="px-3 py-3"><b>{materialMap.get(plan.materialId)?.name ?? plan.materialId}</b><div className={`mt-1 text-[10px] ${plan.supplierId ? "text-[#888]" : "font-bold text-violet-700"}`}>{plan.supplierId ? supplierMap.get(plan.supplierId)?.name ?? plan.supplierId : "공급사 미지정 · 마스터 보완"}</div></td><td className="whitespace-nowrap px-3 py-3">{new Date(plan.plannedDate).toLocaleDateString("ko-KR")}</td><td className="px-3 py-3 text-right font-bold">{plan.plannedQuantity.toLocaleString()}</td><td className="px-3 py-3 text-right text-emerald-700">{plan.receivedQuantity.toLocaleString()}</td><td className="px-3 py-3 text-right font-bold text-blue-700">{plan.remainingQuantity.toLocaleString()}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${status.style}`}>{status.label}</span></td>
            <td className="whitespace-nowrap px-3 py-3" onClick={event => event.stopPropagation()}>{plan.status === "DRAFT" && <button disabled={!canManage || busy} onClick={() => void request(`/api/inbound-plans/${plan._id}`, "PATCH", { action: "CONFIRM" })} className="mr-2 font-bold text-blue-700 disabled:opacity-40">확정</button>}{(plan.status === "DRAFT" || plan.status === "CONFIRMED") && <button disabled={!canManage || busy} onClick={() => cancel(plan)} className="font-bold text-red-600 disabled:opacity-40">취소</button>}</td>
          </tr>; })}{initialPlans.length === 0 && <tr><td colSpan={8} className="p-12 text-center text-sm text-[#999]">등록된 입고계획이 없습니다.</td></tr>}</tbody>
        </table></div>
      </div>
    </div>
  </div>;
}
