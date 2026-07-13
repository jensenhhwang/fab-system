"use client";
import { useState, useMemo } from "react";
import InboundModal from "./InboundModal";

type Lot = {
  _id: string; materialId: string; lotNo: string; quantity: number;
  availableQuantity: number; receivedAt: string; expiryDate?: string;
  warehouseId?: string; slotId?: string; qualityStatus: string;
};
type Movement = {
  _id: string; materialId: string; type: string; quantity: number;
  processCode?: string; userId: string; createdAt: string; lotId?: string;
};
type MatDoc = { _id: string; name: string; code: string; unit: string; category: string };
type WhDoc = { _id: string; name: string; code: string };

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function ExpiryBadge({ expiryDate }: { expiryDate?: string }) {
  const d = daysUntil(expiryDate);
  if (d === null) return <span className="text-xs text-[#999]">—</span>;
  const color = d <= 30 ? "#EA002C" : d <= 60 ? "#F7A600" : "#00B96B";
  const bg = d <= 30 ? "#FFF0F2" : d <= 60 ? "#FFF8E6" : "#E6FAF1";
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ color, background: bg }}>
      D-{d}
    </span>
  );
}

export default function WmsClient({
  lots, movements, matMap, whMap,
}: {
  lots: Lot[]; movements: Movement[];
  matMap: Record<string, MatDoc>; whMap: Record<string, WhDoc>;
}) {
  const [showInbound, setShowInbound] = useState(false);
  const [filterMat, setFilterMat] = useState("");
  const [filterWh, setFilterWh] = useState("");

  const filtered = useMemo(() => {
    return lots.filter((l) => {
      if (filterMat && l.materialId !== filterMat) return false;
      if (filterWh && l.warehouseId !== filterWh) return false;
      return true;
    });
  }, [lots, filterMat, filterWh]);

  const uniqueMaterials = [...new Set(lots.map((l) => l.materialId))].sort();
  const uniqueWarehouses = [...new Set(lots.map((l) => l.warehouseId).filter(Boolean))].sort();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-2xl font-extrabold tracking-tight">창고관리 (WMS)</div>
          <div className="text-sm text-[#999] mt-1">Lot 단위 재고 추적 · FEFO 출고 관리</div>
        </div>
        <button
          onClick={() => setShowInbound(true)}
          className="px-4 py-2 rounded-xl bg-[#0078D4] text-white text-sm font-bold hover:bg-[#006CBE] transition-colors"
        >
          + 입고 등록
        </button>
      </div>

      {/* 필터 */}
      <div className="flex gap-3 mb-5">
        <select
          value={filterMat}
          onChange={(e) => setFilterMat(e.target.value)}
          className="border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">전체 자재</option>
          {uniqueMaterials.map((id) => (
            <option key={id} value={id}>{matMap[id]?.code} — {matMap[id]?.name}</option>
          ))}
        </select>
        <select
          value={filterWh}
          onChange={(e) => setFilterWh(e.target.value)}
          className="border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">전체 시설</option>
          {uniqueWarehouses.map((id) => (
            <option key={id!} value={id!}>{whMap[id!]?.code} — {whMap[id!]?.name}</option>
          ))}
        </select>
      </div>

      {/* Lot 테이블 */}
      <div className="bg-white rounded-2xl shadow-sm border border-[#F0F2F5] mb-6 overflow-hidden">
        <div className="px-5 py-3 border-b border-[#F0F2F5] text-sm font-bold text-[#333]">
          Lot 목록 <span className="text-[#999] font-normal ml-1">FEFO 순 정렬</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-[#999] border-b border-[#F0F2F5]">
                <th className="text-left px-4 py-2">Lot No</th>
                <th className="text-left px-4 py-2">자재</th>
                <th className="text-left px-4 py-2">시설</th>
                <th className="text-left px-4 py-2">슬롯</th>
                <th className="text-right px-4 py-2">가용수량</th>
                <th className="text-left px-4 py-2">유효기간</th>
                <th className="text-left px-4 py-2">D-Day</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lot) => {
                const mat = matMap[lot.materialId];
                const wh = lot.warehouseId ? whMap[lot.warehouseId] : null;
                return (
                  <tr key={lot._id} className="border-b border-[#F8F9FA] hover:bg-[#F8F9FA] transition-colors">
                    <td className="px-4 py-2.5 font-mono text-xs text-[#555]">{lot.lotNo}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-[#111]">{mat?.name ?? lot.materialId}</div>
                      <div className="text-[10px] text-[#999]">{mat?.code}</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#555]">{wh?.code ?? lot.warehouseId ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-[#999]">{lot.slotId ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-[#111]">
                      {lot.availableQuantity.toLocaleString()}
                      <span className="text-[10px] text-[#999] ml-1">{mat?.unit}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#555]">
                      {lot.expiryDate ? new Date(lot.expiryDate).toLocaleDateString("ko-KR") : "—"}
                    </td>
                    <td className="px-4 py-2.5"><ExpiryBadge expiryDate={lot.expiryDate} /></td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-[#999]">Lot 데이터 없음</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 입출고 이력 */}
      <div className="bg-white rounded-2xl shadow-sm border border-[#F0F2F5] overflow-hidden">
        <div className="px-5 py-3 border-b border-[#F0F2F5] text-sm font-bold text-[#333]">입출고 이력</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-[#999] border-b border-[#F0F2F5]">
                <th className="text-left px-4 py-2">일시</th>
                <th className="text-left px-4 py-2">유형</th>
                <th className="text-left px-4 py-2">자재</th>
                <th className="text-right px-4 py-2">수량</th>
                <th className="text-left px-4 py-2">공정</th>
                <th className="text-left px-4 py-2">처리자</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((mv) => {
                const mat = matMap[mv.materialId];
                const isIn = mv.type === "RECEIPT";
                return (
                  <tr key={mv._id} className="border-b border-[#F8F9FA] hover:bg-[#F8F9FA]">
                    <td className="px-4 py-2.5 text-xs text-[#999]">
                      {new Date(mv.createdAt).toLocaleDateString("ko-KR")}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                        style={{ background: isIn ? "#E6FAF1" : "#FFF0F2", color: isIn ? "#065F46" : "#EA002C" }}>
                        {isIn ? "입고" : "출고"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-[#111]">{mat?.name ?? mv.materialId}</td>
                    <td className="px-4 py-2.5 text-right font-bold" style={{ color: isIn ? "#00B96B" : "#EA002C" }}>
                      {isIn ? "+" : "-"}{mv.quantity.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#555]">{mv.processCode ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-[#999]">{mv.userId}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showInbound && (
        <InboundModal
          matMap={matMap}
          whMap={whMap}
          onClose={() => setShowInbound(false)}
          onSuccess={() => { setShowInbound(false); window.location.reload(); }}
        />
      )}
    </div>
  );
}
