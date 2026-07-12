"use client";

import { useState, useMemo } from "react";

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  GAS: { bg: "#FEE2E2", text: "#B91C1C" },
  CHM: { bg: "#DBEAFE", text: "#1D4ED8" },
  CSM: { bg: "#EDE9FE", text: "#6D28D9" },
  UTL: { bg: "#D1FAE5", text: "#065F46" },
  PKG: { bg: "#F1F5F9", text: "#475569" },
};

export type SimMaterial = {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  totalQuantity: number;
  dailyUsage: number;
  doh: number | null;
  ropDays: number;
};

export type AffectedProcess = {
  materialId: string;
  processCode: string;
  product: string;
  monthlyQty: number;
};

function dohColor(doh: number | null, ropDays: number) {
  if (doh === null) return "#999";
  if (doh < 5) return "#EA002C";
  if (doh < ropDays) return "#F7A600";
  return "#00B96B";
}

function ExpiryBadge({ label, doh, color }: { label: string; doh: number | null; color: string }) {
  if (doh === null) return null;
  const date = new Date();
  date.setDate(date.getDate() + Math.floor(doh));
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: color + "18", border: `1px solid ${color}40` }}>
      <span className="text-xs font-bold" style={{ color }}>{label}</span>
      <span className="text-xs text-[#ccc]">소진 예상</span>
      <span className="text-sm font-bold tabular-nums" style={{ color }}>{dateStr}</span>
      <span className="text-xs text-[#888]">({Math.floor(doh)}일 후)</span>
    </div>
  );
}

function DOHChart({
  currentQty, qtyA, qtyB, dailyUsage, unit,
}: {
  currentQty: number; qtyA: number; qtyB: number; dailyUsage: number; unit: string;
}) {
  const W = 560;
  const H = 200;
  const PAD = { top: 16, right: 24, bottom: 36, left: 56 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const maxQty = Math.max(currentQty + qtyA, currentQty + qtyB, currentQty);
  const dohCurrent = dailyUsage > 0 ? currentQty / dailyUsage : 0;
  const dohA = dailyUsage > 0 ? (currentQty + qtyA) / dailyUsage : 0;
  const dohB = dailyUsage > 0 ? (currentQty + qtyB) / dailyUsage : 0;
  const maxDays = Math.ceil(Math.max(dohCurrent, dohA, dohB) * 1.15) || 30;

  function toX(day: number) { return PAD.left + (day / maxDays) * chartW; }
  function toY(qty: number) { return PAD.top + chartH - (qty / Math.max(maxQty, 1)) * chartH; }

  function linePoints(startQty: number) {
    const pts: [number, number][] = [];
    const steps = 80;
    for (let i = 0; i <= steps; i++) {
      const day = (i / steps) * maxDays;
      const qty = Math.max(0, startQty - dailyUsage * day);
      pts.push([toX(day), toY(qty)]);
      if (qty === 0) break;
    }
    return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ qty: Math.round(maxQty * f), y: toY(maxQty * f) }));
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ day: Math.round(maxDays * f), x: toX(maxDays * f) }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      {/* 그리드 */}
      {yTicks.map(({ y }) => (
        <line key={y} x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#2a2a2a" strokeWidth={1} />
      ))}
      {/* Y축 레이블 */}
      {yTicks.map(({ qty, y }) => (
        <text key={qty} x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize={10} fill="#666">{qty.toLocaleString()}</text>
      ))}
      {/* X축 레이블 */}
      {xTicks.map(({ day, x }) => (
        <text key={day} x={x} y={H - 8} textAnchor="middle" fontSize={10} fill="#666">{day}일</text>
      ))}
      {/* 단위 */}
      <text x={PAD.left - 6} y={PAD.top - 4} textAnchor="end" fontSize={9} fill="#555">{unit}</text>

      {/* 현재 (회색 점선) */}
      {currentQty > 0 && (
        <polyline points={linePoints(currentQty)} fill="none" stroke="#555" strokeWidth={1.5} strokeDasharray="4,3" />
      )}
      {/* B안 (주황) */}
      {(currentQty + qtyB) > 0 && (
        <polyline points={linePoints(currentQty + qtyB)} fill="none" stroke="#F7A600" strokeWidth={2} />
      )}
      {/* A안 (파랑) */}
      {(currentQty + qtyA) > 0 && (
        <polyline points={linePoints(currentQty + qtyA)} fill="none" stroke="#3B82F6" strokeWidth={2} />
      )}

      {/* 범례 */}
      <line x1={PAD.left} y1={16} x2={PAD.left + 18} y2={16} stroke="#555" strokeWidth={1.5} strokeDasharray="4,3" />
      <text x={PAD.left + 22} y={20} fontSize={10} fill="#888">현재</text>
      <line x1={PAD.left + 60} y1={16} x2={PAD.left + 78} y2={16} stroke="#3B82F6" strokeWidth={2} />
      <text x={PAD.left + 82} y={20} fontSize={10} fill="#3B82F6">A안</text>
      <line x1={PAD.left + 108} y1={16} x2={PAD.left + 126} y2={16} stroke="#F7A600" strokeWidth={2} />
      <text x={PAD.left + 130} y={20} fontSize={10} fill="#F7A600">B안</text>
    </svg>
  );
}

export default function SimulationClient({
  materials,
  processUsages,
}: {
  materials: SimMaterial[];
  processUsages: AffectedProcess[];
}) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [inputA, setInputA] = useState("");
  const [inputB, setInputB] = useState("");
  const [simulated, setSimulated] = useState(false);

  const selected = materials.find((m) => m.id === selectedId) ?? null;

  const qtyA = parseFloat(inputA) || 0;
  const qtyB = parseFloat(inputB) || 0;

  const dohA = useMemo(() => {
    if (!selected || selected.dailyUsage <= 0) return null;
    return (selected.totalQuantity + qtyA) / selected.dailyUsage;
  }, [selected, qtyA]);

  const dohB = useMemo(() => {
    if (!selected || selected.dailyUsage <= 0) return null;
    return (selected.totalQuantity + qtyB) / selected.dailyUsage;
  }, [selected, qtyB]);

  const affectedProcesses = useMemo(() => {
    if (!selected) return [];
    return processUsages.filter((p) => p.materialId === selected.id);
  }, [selected, processUsages]);

  const byCategory = useMemo(() => {
    const map = new Map<string, SimMaterial[]>();
    for (const m of materials) {
      if (!map.has(m.category)) map.set(m.category, []);
      map.get(m.category)!.push(m);
    }
    return map;
  }, [materials]);

  function handleSimulate() {
    if (!selected) return;
    setSimulated(true);
  }

  return (
    <div className="flex gap-6">
      {/* ── 좌측 패널 ── */}
      <div className="w-72 flex-shrink-0 flex flex-col gap-4">
        {/* 자재 선택 */}
        <div className="bg-[#161616] rounded-2xl p-4 flex flex-col gap-3">
          <div className="text-xs font-bold text-[#888] uppercase tracking-widest">자재 선택</div>
          <select
            value={selectedId}
            onChange={(e) => { setSelectedId(e.target.value); setSimulated(false); }}
            className="w-full bg-[#1e1e1e] border border-[#2a2a2a] text-white text-sm rounded-xl px-3 py-2 outline-none focus:border-[#444]"
          >
            <option value="">자재를 선택하세요</option>
            {[...byCategory.entries()].map(([cat, mats]) => (
              <optgroup key={cat} label={`── ${cat} ──`}>
                {mats.map((m) => (
                  <option key={m.id} value={m.id}>{m.code} {m.name}</option>
                ))}
              </optgroup>
            ))}
          </select>

          {/* 현재 상태 */}
          {selected && (
            <div className="flex flex-col gap-1.5 pt-1 border-t border-[#222]">
              <div className="flex items-center gap-2">
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: (CATEGORY_STYLES[selected.category] ?? { bg: "#eee", text: "#333" }).bg, color: (CATEGORY_STYLES[selected.category] ?? { bg: "#eee", text: "#333" }).text }}
                >
                  {selected.category}
                </span>
                <span className="text-sm font-bold text-white">{selected.name}</span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs text-[#888]">
                <span>현재 재고</span>
                <span className="text-white font-bold tabular-nums text-right">{selected.totalQuantity.toLocaleString()} {selected.unit}</span>
                <span>일평균 사용량</span>
                <span className="text-white font-bold tabular-nums text-right">{selected.dailyUsage.toFixed(1)} {selected.unit}</span>
                <span>현재 DOH</span>
                <span className="font-bold tabular-nums text-right" style={{ color: dohColor(selected.doh, selected.ropDays) }}>
                  {selected.doh !== null ? `${selected.doh.toFixed(1)}일` : "–"}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* 수량 입력 */}
        <div className="bg-[#161616] rounded-2xl p-4 flex flex-col gap-3">
          <div className="text-xs font-bold text-[#888] uppercase tracking-widest">입고 수량 입력</div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-[#3B82F6] font-bold">A안</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={inputA}
                onChange={(e) => { setInputA(e.target.value); setSimulated(false); }}
                placeholder="0"
                className="flex-1 bg-[#1e1e1e] border border-[#2a2a2a] text-white text-sm rounded-xl px-3 py-2 outline-none focus:border-[#3B82F6] tabular-nums"
              />
              <span className="text-xs text-[#666]">{selected?.unit ?? "–"}</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-[#F7A600] font-bold">B안</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={inputB}
                onChange={(e) => { setInputB(e.target.value); setSimulated(false); }}
                placeholder="0"
                className="flex-1 bg-[#1e1e1e] border border-[#2a2a2a] text-white text-sm rounded-xl px-3 py-2 outline-none focus:border-[#F7A600] tabular-nums"
              />
              <span className="text-xs text-[#666]">{selected?.unit ?? "–"}</span>
            </div>
          </div>
          <button
            onClick={handleSimulate}
            disabled={!selected}
            className="mt-1 w-full py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: selected ? "#3B82F6" : "#333", color: "white" }}
          >
            시뮬레이션 실행
          </button>
        </div>
      </div>

      {/* ── 우측 패널 ── */}
      <div className="flex-1 flex flex-col gap-4">
        {!simulated && (
          <div className="flex flex-col items-center justify-center gap-3 py-24 bg-[#161616] rounded-2xl border border-dashed border-[#2a2a2a]">
            <div className="text-3xl opacity-30">📊</div>
            <div className="text-sm text-[#555]">자재 선택 후 수량을 입력하고 시뮬레이션을 실행하세요</div>
          </div>
        )}

        {simulated && selected && (
          <>
            {/* DOH 비교 차트 */}
            <div className="bg-[#161616] rounded-2xl p-4 flex flex-col gap-3">
              <div className="text-xs font-bold text-[#888] uppercase tracking-widest">재고 소진 예측</div>
              <DOHChart
                currentQty={selected.totalQuantity}
                qtyA={qtyA}
                qtyB={qtyB}
                dailyUsage={selected.dailyUsage}
                unit={selected.unit}
              />
            </div>

            {/* 소진 예상일 배지 */}
            <div className="bg-[#161616] rounded-2xl p-4 flex flex-col gap-3">
              <div className="text-xs font-bold text-[#888] uppercase tracking-widest">소진 예상일</div>
              <div className="flex flex-col gap-2">
                <ExpiryBadge label="현재" doh={selected.doh} color={dohColor(selected.doh, selected.ropDays)} />
                {qtyA > 0 && <ExpiryBadge label="A안" doh={dohA} color="#3B82F6" />}
                {qtyB > 0 && <ExpiryBadge label="B안" doh={dohB} color="#F7A600" />}
              </div>
              {/* DOH 증가량 요약 */}
              {(qtyA > 0 || qtyB > 0) && selected.doh !== null && (
                <div className="flex gap-3 pt-2 border-t border-[#222]">
                  {qtyA > 0 && dohA !== null && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-[#3B82F6] font-bold">A안</span>
                      <span className="text-[#555]">+{(dohA - selected.doh).toFixed(1)}일</span>
                    </div>
                  )}
                  {qtyB > 0 && dohB !== null && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-[#F7A600] font-bold">B안</span>
                      <span className="text-[#555]">+{(dohB - selected.doh).toFixed(1)}일</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 영향 공정 */}
            {affectedProcesses.length > 0 && (
              <div className="bg-[#161616] rounded-2xl p-4 flex flex-col gap-3">
                <div className="text-xs font-bold text-[#888] uppercase tracking-widest">영향 공정</div>
                <div className="flex flex-col gap-1.5">
                  {affectedProcesses.map((p) => (
                    <div key={`${p.processCode}-${p.product}`} className="flex items-center justify-between py-1.5 px-3 rounded-xl bg-[#1e1e1e]">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">{p.processCode}</span>
                        <span className="text-xs text-[#666]">{p.product}</span>
                      </div>
                      <span className="text-xs tabular-nums text-[#888]">{p.monthlyQty.toLocaleString()} {selected.unit}/월</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
