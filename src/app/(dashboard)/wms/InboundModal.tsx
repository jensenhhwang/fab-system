"use client";
import { useEffect, useRef, useState } from "react";

type MatDoc = { _id: string; name: string; code: string; unit: string };
type WhDoc = { _id: string; name: string; code: string };
type InboundPlan = {
  _id: string; planNo: string; materialId: string; supplierId: string;
  plannedDate: string; plannedQuantity: number; receivedQuantity: number; remainingQuantity: number; unit: string;
};

export default function InboundModal({
  matMap, whMap, onClose, onSuccess,
}: {
  matMap: Record<string, MatDoc>; whMap: Record<string, WhDoc>;
  onClose: () => void; onSuccess: () => void;
}) {
  const [materialId, setMaterialId] = useState("");
  const [inboundPlanId, setInboundPlanId] = useState("");
  const [plans, setPlans] = useState<InboundPlan[]>([]);
  const [supplierNames, setSupplierNames] = useState<Record<string, string>>({});
  const [warehouseId, setWarehouseId] = useState("");
  const [slotId, setSlotId] = useState("");
  const [qty, setQty] = useState("");
  const [mfgDate, setMfgDate] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestIdRef = useRef("");

  const materials = Object.values(matMap).sort((a, b) => a.code.localeCompare(b.code));
  const warehouses = Object.values(whMap).sort((a, b) => a.code.localeCompare(b.code));
  const selectedPlan = plans.find((plan) => plan._id === inboundPlanId);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/inbound-plans?status=CONFIRMED", { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("확정 입고계획을 불러오지 못했습니다.");
        return response.json();
      })
      .then(data => {
        setPlans(data.plans ?? []);
        setSupplierNames(Object.fromEntries((data.suppliers ?? []).map((supplier: { _id: string; name: string }) => [supplier._id, supplier.name])));
      })
      .catch(err => { if (err instanceof Error && err.name !== "AbortError") setError(err.message); });
    return () => controller.abort();
  }, []);

  function choosePlan(planId: string) {
    setInboundPlanId(planId);
    const plan = plans.find(item => item._id === planId);
    if (plan) { setMaterialId(plan.materialId); setQty(""); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!materialId || !warehouseId || !qty) { setError("자재·시설·수량은 필수입니다"); return; }
    setLoading(true);
    setError("");
    if (!requestIdRef.current) requestIdRef.current = globalThis.crypto.randomUUID();
    try {
      const res = await fetch("/api/lots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialId, warehouseId, slotId: slotId || undefined, qty: Number(qty), mfgDate: mfgDate || undefined, expiresAt: expiresAt || undefined, inboundPlanId: inboundPlanId || undefined, requestId: requestIdRef.current }),
      });
      if (!res.ok) { const d = await res.json(); requestIdRef.current = ""; throw new Error(d.error ?? "입고 실패"); }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류 발생");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="font-bold text-lg">입고 등록</div>
          <button onClick={onClose} className="text-[#999] hover:text-[#333] text-xl">×</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#555] mb-1">확정 입고계획 (선택)</label>
            <select value={inboundPlanId} onChange={(e) => choosePlan(e.target.value)} className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm">
              <option value="">계획 없이 입고</option>
              {plans.map(plan => <option key={plan._id} value={plan._id}>{plan.planNo} · {matMap[plan.materialId]?.name ?? plan.materialId} · 잔여 {plan.remainingQuantity.toLocaleString()} {plan.unit}</option>)}
            </select>
            {selectedPlan && <div className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-[11px] leading-5 text-blue-800">{supplierNames[selectedPlan.supplierId] ?? selectedPlan.supplierId} · 예정 {new Date(selectedPlan.plannedDate).toLocaleDateString("ko-KR")}<br />계획 {selectedPlan.plannedQuantity.toLocaleString()} · 입고 {selectedPlan.receivedQuantity.toLocaleString()} · 잔여 <b>{selectedPlan.remainingQuantity.toLocaleString()} {selectedPlan.unit}</b></div>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#555] mb-1">자재 *</label>
            <select disabled={Boolean(inboundPlanId)} value={materialId} onChange={(e) => setMaterialId(e.target.value)} className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm disabled:bg-[#F8F6F4]">
              <option value="">선택</option>
              {materials.map((m) => <option key={m._id} value={m._id}>{m.code} — {m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#555] mb-1">시설 *</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm">
              <option value="">선택</option>
              {warehouses.map((w) => <option key={w._id} value={w._id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#555] mb-1">슬롯 (선택)</label>
            <input value={slotId} onChange={(e) => setSlotId(e.target.value)} placeholder="예: MWH-01-R03-C02-L1" className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#555] mb-1">수량 *</label>
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} min="0.000001" step="any" max={selectedPlan?.remainingQuantity} className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#555] mb-1">제조일 (선택)</label>
              <input type="date" value={mfgDate} onChange={(e) => setMfgDate(e.target.value)} className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#555] mb-1">유효기간 (선택)</label>
              <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          {error && <div className="text-sm text-[#EA002C] bg-[#FFF0F2] rounded-lg px-3 py-2">{error}</div>}
          <button type="submit" disabled={loading} className="w-full py-2.5 rounded-xl bg-[#0078D4] text-white font-bold text-sm hover:bg-[#006CBE] disabled:opacity-50 transition-colors">
            {loading ? "저장 중..." : "입고 등록"}
          </button>
        </form>
      </div>
    </div>
  );
}
