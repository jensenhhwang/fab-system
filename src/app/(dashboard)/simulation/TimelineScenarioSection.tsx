"use client";

import { useMemo, useState } from "react";
import {
  runTimelineScenario,
  type ScenarioMaterial,
  type TimelineEvent,
  type TimelineMaterialResult,
  type PurchasePlan,
} from "@/lib/scenario-engine";

const PRODUCT_OPTIONS = ["HBM", "DRAM", "NAND", "ALL"] as const;
const PRODUCT_COLOR: Record<string, string> = { HBM: "#EA002C", DRAM: "#3B82F6", NAND: "#8B5CF6", ALL: "#059669" };
const LINE_PALETTE = ["#EA002C","#3B82F6","#8B5CF6","#059669","#F59E0B","#EC4899","#14B8A6","#6366F1"];

function fmtDay(day: number | null) {
  if (day === null) return "—";
  if (day === 0) return "즉시";
  return `D+${day}`;
}

function urgencyClass(day: number | null): string {
  if (day === null) return "text-gray-400";
  if (day === 0) return "text-red-600 font-bold";
  if (day <= 7) return "text-red-500 font-semibold";
  if (day <= 14) return "text-amber-600 font-semibold";
  return "text-gray-700";
}

// DOH 차트: 기준선(회색 점선) + 계획 반영선(컬러 실선)
function DohChart({ results, hasPlans }: { results: TimelineMaterialResult[]; hasPlans: boolean }) {
  const top = results.slice(0, 8);
  const W = 720, H = 240, P = { l: 40, r: 16, t: 16, b: 40 };
  const maxDoh = 90;
  const x = (d: number) => P.l + (d / 90) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - Math.min(v, maxDoh) / maxDoh) * (H - P.t - P.b);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[240px]">
      {/* 위험 구간 */}
      <rect x={P.l} y={y(5)} width={W - P.l - P.r} height={y(0) - y(5)} fill="#FEF2F2" opacity="0.6" />
      {/* 그리드 */}
      {[0, 14, 30, 60, 90].map(v => (
        <g key={v}>
          <line x1={P.l} y1={y(v)} x2={W - P.r} y2={y(v)} stroke="#E5E7EB" strokeDasharray={v === 0 ? "0" : "3,3"} />
          <text x={P.l - 5} y={y(v) + 4} textAnchor="end" fontSize="9" fill="#9CA3AF">{v}일</text>
        </g>
      ))}
      {[0, 30, 60, 90].map(d => (
        <text key={d} x={x(d)} y={H - 8} textAnchor="middle" fontSize="9" fill="#9CA3AF">D+{d}</text>
      ))}

      {top.map((r, i) => {
        const color = LINE_PALETTE[i % LINE_PALETTE.length];
        return (
          <g key={r.materialId}>
            {/* 기준선: 회색 점선 */}
            <polyline
              fill="none" stroke="#D1D5DB" strokeWidth={1.2} strokeDasharray="4,3"
              points={r.points.map(p => `${x(p.day)},${y(p.doh)}`).join(" ")}
            />
            {/* 계획 반영선: 컬러 실선 */}
            <polyline
              fill="none" stroke={color} strokeWidth={hasPlans ? 2 : 1.8} opacity={hasPlans ? 1 : 0.85}
              points={(hasPlans ? r.withPlanPoints : r.points).map(p => `${x(p.day)},${y(p.doh)}`).join(" ")}
            />
          </g>
        );
      })}

      {/* 범례 */}
      {top.map((r, i) => (
        <g key={r.materialId} transform={`translate(${P.l + (i % 4) * 170}, ${H - (i < 4 ? 6 : 18)})`}>
          <circle cx="4" cy="-3" r="3" fill={LINE_PALETTE[i % LINE_PALETTE.length]} />
          <text x="10" y="0" fontSize="8" fill="#6B7280">{r.name.slice(0, 14)}</text>
        </g>
      ))}

      {/* 범례: 기준선/계획선 구분 (발주 계획 있을 때만) */}
      {hasPlans && (
        <g transform={`translate(${W - P.r - 130}, ${P.t + 4})`}>
          <line x1="0" y1="6" x2="18" y2="6" stroke="#D1D5DB" strokeWidth="1.5" strokeDasharray="4,3" />
          <text x="22" y="10" fontSize="8" fill="#9CA3AF">발주 없을 때</text>
          <line x1="0" y1="20" x2="18" y2="20" stroke="#6366F1" strokeWidth="2" />
          <text x="22" y="24" fontSize="8" fill="#9CA3AF">발주 계획 반영</text>
        </g>
      )}
    </svg>
  );
}

export default function TimelineScenarioSection({ materials }: { materials: ScenarioMaterial[] }) {
  // ── 수요 이벤트 ──
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [day, setDay] = useState(7);
  const [product, setProduct] = useState<typeof PRODUCT_OPTIONS[number]>("HBM");
  const [pct, setPct] = useState(10);

  // ── 발주 계획 ──
  const [plans, setPlans] = useState<PurchasePlan[]>([]);
  const [planMaterialId, setPlanMaterialId] = useState(materials[0]?.id ?? "");
  const [planDay, setPlanDay] = useState(3);
  const [planQty, setPlanQty] = useState(0);

  const addEvent = () => {
    setEvents(prev => {
      const filtered = prev.filter(e => !(e.day === day && e.product === product));
      return [...filtered, { id: String(Date.now()), day, product, changePct: pct }]
        .sort((a, b) => a.day - b.day || a.product.localeCompare(b.product));
    });
  };

  const addPlan = () => {
    if (planQty <= 0) return;
    setPlans(prev => [
      ...prev,
      { id: String(Date.now()), materialId: planMaterialId, dayOffset: planDay, quantity: planQty },
    ].sort((a, b) => a.dayOffset - b.dayOffset));
    setPlanQty(0);
  };

  const removePlan = (id: string) => setPlans(prev => prev.filter(p => p.id !== id));
  const removeEvent = (id: string) => setEvents(prev => prev.filter(e => e.id !== id));

  const hasPlans = plans.length > 0;
  const hasEvents = events.length > 0;

  const results: TimelineMaterialResult[] = useMemo(() => {
    if (!hasEvents && !hasPlans) return [];
    return materials
      .map(m => runTimelineScenario(m, events, plans))
      .filter(r => r.orderNeededByDay !== null || r.planStockoutDay !== null || r.planSafetyStockDay !== null || (hasPlans && r.resolvedByPlan))
      .sort((a, b) => {
        // 아직 위험한 자재 먼저, 그 다음 해소된 자재
        const aRisk = hasPlans ? (a.planStockoutDay ?? a.planSafetyStockDay) : (a.orderNeededByDay);
        const bRisk = hasPlans ? (b.planStockoutDay ?? b.planSafetyStockDay) : (b.orderNeededByDay);
        if (aRisk === null && bRisk !== null) return 1;
        if (aRisk !== null && bRisk === null) return -1;
        return (aRisk ?? 999) - (bRisk ?? 999);
      });
  }, [materials, events, plans, hasEvents, hasPlans]);

  const planMaterial = materials.find(m => m.id === planMaterialId);

  return (
    <div className="mt-8 border-t pt-8">
      <div className="mb-5">
        <div className="text-lg font-extrabold tracking-tight mb-1">멀티 이벤트 시나리오</div>
        <div className="text-sm text-gray-400">수요 변화를 입력하고, 발주 계획을 쌓아서 재고가 버티는지 확인합니다.</div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* ── 1단계: 수요 이벤트 ── */}
        <div className="bg-gray-50 rounded-2xl p-4">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">1단계 · 수요 조건 (선택)</div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="text-xs text-gray-400 block mb-1">시점 (D+일)</label>
              <input type="number" min="0" max="90" value={day}
                onChange={e => setDay(Math.max(0, Math.min(90, Number(e.target.value))))}
                className="w-16 px-2 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">제품</label>
              <select value={product} onChange={e => setProduct(e.target.value as typeof PRODUCT_OPTIONS[number])}
                className="px-2 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none">
                {PRODUCT_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">수요 변화율</label>
              <div className="flex items-center gap-1">
                {[-30, -10, 10, 30, 50].map(v => (
                  <button key={v} onClick={() => setPct(v)}
                    className={`px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors ${pct === v ? "bg-[#0078D4] text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-100"}`}>
                    {v > 0 ? `+${v}` : v}%
                  </button>
                ))}
                <input type="number" min="-100" max="200" value={pct}
                  onChange={e => setPct(Number(e.target.value))}
                  className="w-14 px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white text-center focus:outline-none ml-1" />
                <span className="text-xs text-gray-400">%</span>
              </div>
            </div>
            <button onClick={addEvent}
              className="px-3 py-2 bg-gray-700 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition-colors">
              + 추가
            </button>
          </div>

          {events.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {events.map(ev => (
                <div key={ev.id} className="flex items-center gap-1 px-2.5 py-1.5 bg-white rounded-lg border border-gray-200 text-xs">
                  <span className="text-gray-400">D+{ev.day}</span>
                  <span className="font-bold" style={{ color: PRODUCT_COLOR[ev.product] }}>{ev.product}</span>
                  <span className={`font-semibold ${ev.changePct > 0 ? "text-red-500" : "text-blue-500"}`}>
                    {ev.changePct > 0 ? "+" : ""}{ev.changePct}%
                  </span>
                  <button onClick={() => removeEvent(ev.id)} className="text-gray-300 hover:text-red-400 ml-0.5">×</button>
                </div>
              ))}
              <button onClick={() => setEvents([])} className="text-xs text-gray-400 hover:text-red-400 underline self-center">전체 삭제</button>
            </div>
          )}
        </div>

        {/* ── 2단계: 발주 계획 ── */}
        <div className="bg-blue-50 rounded-2xl p-4">
          <div className="text-xs font-bold text-blue-600 uppercase tracking-wide mb-3">2단계 · 발주 계획 입력</div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-0">
              <label className="text-xs text-blue-500 block mb-1">자재</label>
              <select value={planMaterialId} onChange={e => setPlanMaterialId(e.target.value)}
                className="w-full px-2 py-2 text-xs border border-blue-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
                {materials.map(m => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-blue-500 block mb-1">발주일 (D+)</label>
              <input type="number" min="0" max="90" value={planDay}
                onChange={e => setPlanDay(Math.max(0, Math.min(90, Number(e.target.value))))}
                className="w-16 px-2 py-2 text-sm border border-blue-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div>
              <label className="text-xs text-blue-500 block mb-1">수량 ({planMaterial?.unit ?? ""})</label>
              <input type="number" min="0" value={planQty === 0 ? "" : planQty}
                placeholder="0"
                onChange={e => setPlanQty(Math.max(0, Number(e.target.value)))}
                className="w-24 px-2 py-2 text-sm border border-blue-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <button onClick={addPlan} disabled={planQty <= 0}
              className="px-3 py-2 bg-[#0078D4] text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors">
              + 추가
            </button>
          </div>

          {plans.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {plans.map(plan => {
                const mat = materials.find(m => m.id === plan.materialId);
                return (
                  <div key={plan.id} className="flex items-center gap-1 px-2.5 py-1.5 bg-white rounded-lg border border-blue-200 text-xs">
                    <span className="text-blue-400">D+{plan.dayOffset}</span>
                    <span className="font-semibold text-gray-700">{mat?.name.slice(0, 8)}</span>
                    <span className="font-bold text-[#0078D4]">+{plan.quantity.toLocaleString()}{mat?.unit}</span>
                    <button onClick={() => removePlan(plan.id)} className="text-gray-300 hover:text-red-400 ml-0.5">×</button>
                  </div>
                );
              })}
              <button onClick={() => setPlans([])} className="text-xs text-blue-400 hover:text-red-400 underline self-center">전체 삭제</button>
            </div>
          )}

          {plans.length === 0 && (
            <div className="mt-3 text-xs text-blue-300">발주 계획을 추가하면 재고 그래프에 반영됩니다</div>
          )}
        </div>
      </div>

      {/* ── 결과 ── */}
      {(hasEvents || hasPlans) && (
        <>
          {results.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm bg-white rounded-2xl shadow-sm">
              현재 재고로 90일 이내 결품 없음 — 추가 발주가 필요하지 않습니다.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl shadow-sm p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-semibold text-gray-700">재고 잔여일수 (DOH) 추이</div>
                  {hasPlans && (
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span className="flex items-center gap-1"><span className="inline-block w-5 border-t-2 border-dashed border-gray-300" /> 발주 없을 때</span>
                      <span className="flex items-center gap-1"><span className="inline-block w-5 border-t-2 border-[#6366F1]" /> 발주 계획 반영</span>
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-400 mb-3">빨간 배경 = 5일 미만 위험 구간 · 상위 8개 자재 표시</div>
                <DohChart results={results} hasPlans={hasPlans} />
              </div>

              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-gray-700">발주 계획 검토</span>
                    <span className="ml-2 text-xs text-gray-400">{results.length}개 자재</span>
                  </div>
                  {hasPlans && (
                    <div className="flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-1 text-green-600">
                        <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                        해소 {results.filter(r => r.resolvedByPlan).length}종
                      </span>
                      <span className="flex items-center gap-1 text-red-500">
                        <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                        위험 {results.filter(r => !r.resolvedByPlan && (r.planStockoutDay !== null || r.planSafetyStockDay !== null)).length}종
                      </span>
                    </div>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-medium">자재명</th>
                        <th className="px-4 py-2.5 text-right font-medium">현재 재고</th>
                        <th className="px-4 py-2.5 text-right font-medium">소진 예상</th>
                        {hasPlans && <th className="px-4 py-2.5 text-right font-medium">발주 후 소진</th>}
                        <th className="px-4 py-2.5 text-right font-medium">발주 권장일</th>
                        {!hasPlans && <th className="px-4 py-2.5 text-right font-medium">권장 발주량</th>}
                        {hasPlans && <th className="px-4 py-2.5 text-center font-medium">상태</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {results.map(r => {
                        const resolved = hasPlans && r.resolvedByPlan;
                        const planRisk = hasPlans && !resolved && (r.planStockoutDay !== null || r.planSafetyStockDay !== null);
                        return (
                          <tr key={r.materialId} className={`hover:bg-gray-50 transition-colors ${resolved ? "opacity-60" : ""}`}>
                            <td className="px-4 py-3">
                              <div className="font-medium text-gray-800">{r.name}</div>
                              <div className="text-xs text-gray-400">ROP {r.ropDays}일</div>
                            </td>
                            <td className="px-4 py-3 text-right text-gray-600">
                              {Math.round(r.currentQuantity).toLocaleString()} {r.unit}
                            </td>
                            <td className={`px-4 py-3 text-right ${urgencyClass(r.stockoutDay)}`}>
                              {fmtDay(r.stockoutDay)}
                            </td>
                            {hasPlans && (
                              <td className={`px-4 py-3 text-right font-semibold ${resolved ? "text-green-600" : urgencyClass(r.planStockoutDay)}`}>
                                {resolved ? "결품 없음" : fmtDay(r.planStockoutDay)}
                              </td>
                            )}
                            <td className={`px-4 py-3 text-right ${urgencyClass(r.orderNeededByDay)}`}>
                              {fmtDay(r.orderNeededByDay)}
                            </td>
                            {!hasPlans && (
                              <td className="px-4 py-3 text-right font-semibold text-[#0078D4]">
                                {r.recommendedQty.toLocaleString()} {r.unit}
                              </td>
                            )}
                            {hasPlans && (
                              <td className="px-4 py-3 text-center">
                                {resolved ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-700 rounded-full text-xs font-medium">✓ 해소</span>
                                ) : planRisk ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-600 rounded-full text-xs font-medium">⚠ 위험</span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-50 text-gray-500 rounded-full text-xs font-medium">— 안전</span>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {!hasEvents && !hasPlans && (
        <div className="text-center py-10 text-gray-300 text-sm">
          수요 조건이나 발주 계획을 입력하면 시뮬레이션이 시작됩니다
        </div>
      )}
    </div>
  );
}
