"use client";
import { useState } from "react";

type MatDoc = { _id: string; name: string; code: string; unit: string };
type WhDoc = { _id: string; name: string; code: string };

export default function InboundModal({
  matMap, whMap, onClose, onSuccess,
}: {
  matMap: Record<string, MatDoc>; whMap: Record<string, WhDoc>;
  onClose: () => void; onSuccess: () => void;
}) {
  const [materialId, setMaterialId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [slotId, setSlotId] = useState("");
  const [qty, setQty] = useState("");
  const [mfgDate, setMfgDate] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const materials = Object.values(matMap).sort((a, b) => a.code.localeCompare(b.code));
  const warehouses = Object.values(whMap).sort((a, b) => a.code.localeCompare(b.code));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!materialId || !warehouseId || !qty) { setError("자재·시설·수량은 필수입니다"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/lots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialId, warehouseId, slotId: slotId || undefined, qty: Number(qty), mfgDate: mfgDate || undefined, expiresAt: expiresAt || undefined }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "입고 실패"); }
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
            <label className="block text-xs font-semibold text-[#555] mb-1">자재 *</label>
            <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm">
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
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} min="1" className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm" />
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
