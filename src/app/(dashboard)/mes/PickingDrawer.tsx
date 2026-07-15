"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import type { WorkOrderDoc, BomLine, InventoryLotDoc } from "@/lib/db";

export default function PickingDrawer({
  wo,
  onClose,
  onPicked,
}: {
  wo: WorkOrderDoc;
  onClose: () => void;
  onPicked: () => void;
}) {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? "";
  const canPick = role === "MATERIALS" || role === "ADMIN";

  const [selectedLine, setSelectedLine] = useState<BomLine>(wo.bomLines[0]);
  const [lots, setLots] = useState<InventoryLotDoc[]>([]);
  const [pickQtys, setPickQtys] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [renderedAt] = useState(() => Date.now());

  useEffect(() => {
    if (!selectedLine) return;
    fetch(`/api/lots?materialId=${selectedLine.materialId}&status=AVAILABLE`)
      .then(r => r.ok ? r.json() : [])
      .then(setLots)
      .catch(() => setLots([]));
  }, [selectedLine]);

  const handlePick = async () => {
    setSubmitting(true);
    try {
      for (const [lotId, qtyStr] of Object.entries(pickQtys)) {
        const qty = Number(qtyStr);
        if (!qty || qty <= 0) continue;
        await fetch(`/api/mes/workorders/${wo._id}/pick`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ materialId: selectedLine.materialId, lotId, qty }),
        });
      }
      await onPicked();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const totalPicking = Object.values(pickQtys).reduce((s, v) => s + (Number(v) || 0), 0);
  const remaining = selectedLine ? selectedLine.plannedQty - (selectedLine.actualQty ?? 0) : 0;
  const availableLots = lots.filter(l => l.qualityStatus === "AVAILABLE" && l.availableQuantity > 0);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-[440px] z-50 bg-white shadow-xl flex flex-col">
        {/* 헤더 */}
        <div className="flex items-start justify-between p-5 border-b" style={{ borderColor: "var(--border)" }}>
          <div>
            <div className="text-sm font-bold" style={{ color: "var(--text-1)" }}>자재 피킹</div>
            <div className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
              {wo._id} · {wo.processCode} · {wo.product}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none mt-0.5">×</button>
        </div>

        {/* BOM 자재 탭 */}
        <div className="flex gap-1.5 px-4 pt-3 pb-2 overflow-x-auto border-b" style={{ borderColor: "var(--border)" }}>
          {wo.bomLines.map(line => {
            const fulfilled = (line.actualQty ?? 0) >= line.plannedQty;
            const isSelected = selectedLine?.materialId === line.materialId;
            return (
              <button
                key={line.materialId}
                onClick={() => { setSelectedLine(line); setPickQtys({}); }}
                className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap font-medium border transition-colors shrink-0 ${
                  isSelected
                    ? "bg-[#0078D4] text-white border-[#0078D4]"
                    : fulfilled
                    ? "bg-green-100 text-green-700 border-green-200"
                    : "bg-gray-100 text-gray-600 border-gray-200"
                }`}
              >
                {line.materialId}
                {fulfilled ? " ✓" : ` (잔${(line.plannedQty - (line.actualQty ?? 0)).toFixed(0)})`}
              </button>
            );
          })}
        </div>

        {/* 선택된 자재 정보 */}
        {selectedLine && (
          <div className="px-4 py-2.5 bg-gray-50 text-xs flex gap-4" style={{ color: "var(--text-3)" }}>
            <span>계획 <strong style={{ color: "var(--text-1)" }}>{selectedLine.plannedQty}</strong></span>
            <span>피킹완료 <strong style={{ color: "var(--text-1)" }}>{selectedLine.actualQty ?? 0}</strong></span>
            <span>잔여 <strong className={remaining > 0 ? "text-amber-600" : "text-green-600"}>{remaining.toFixed(1)}</strong></span>
          </div>
        )}

        {/* Lot 목록 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          <div className="text-xs font-medium mb-2" style={{ color: "var(--text-2)" }}>
            FEFO 순 가용 Lot ({availableLots.length}개)
          </div>
          {availableLots.length === 0 ? (
            <div className="text-xs text-center py-8" style={{ color: "var(--text-3)" }}>
              가용 Lot 없음
            </div>
          ) : (
            availableLots.map(lot => {
              const dDay = lot.expiryDate
                ? Math.round((new Date(lot.expiryDate).getTime() - renderedAt) / 86400000)
                : null;
              return (
                <div key={lot._id} className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-lg text-xs">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate" style={{ color: "var(--text-1)" }}>{lot.lotNo}</div>
                    <div style={{ color: "var(--text-3)" }}>
                      가용 <strong>{lot.availableQuantity.toFixed(1)}</strong>
                      {dDay !== null && (
                        <span className={`ml-1.5 ${dDay < 14 ? "text-amber-600" : "text-gray-400"}`}>
                          · D{dDay >= 0 ? "+" : ""}{dDay}
                        </span>
                      )}
                    </div>
                  </div>
                  <input
                    type="number"
                    value={pickQtys[lot._id] ?? ""}
                    onChange={e => setPickQtys(prev => ({ ...prev, [lot._id]: e.target.value }))}
                    placeholder="수량"
                    max={lot.availableQuantity}
                    min="0"
                    className="w-24 px-2 py-1.5 border rounded-lg text-xs text-right"
                    style={{ borderColor: "var(--border)" }}
                  />
                </div>
              );
            })
          )}
        </div>

        {/* 하단 확정 버튼 */}
        <div className="p-4 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
          <div className="flex justify-between text-xs" style={{ color: "var(--text-2)" }}>
            <span>총 피킹 수량</span>
            <span className="font-semibold">{totalPicking.toFixed(1)}</span>
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">
              취소
            </button>
            <button
              onClick={handlePick}
              disabled={!canPick || totalPicking <= 0 || submitting}
              title={!canPick ? "자재관리팀(MATERIALS) 또는 관리자 권한 필요" : undefined}
              className="flex-1 py-2 text-sm font-medium rounded-lg bg-[#0078D4] text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "처리 중..." : "피킹 확정"}
            </button>
          </div>
          {!canPick && (
            <div className="text-xs text-center" style={{ color: "var(--text-3)" }}>
              자재관리팀(MATERIALS) 또는 관리자 권한이 필요합니다.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
