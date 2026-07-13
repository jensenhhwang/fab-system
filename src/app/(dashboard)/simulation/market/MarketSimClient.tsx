"use client";

import { useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";

type ProcUsage = { procCode: string; product: string; monthlyQty: number; category: string; whCode: string };
type WhData = { code: string; name: string; totalCapacity: number; utilization: number; byCategory: { category: string; occupancy: number }[] };

const PRODUCT_COLOR: Record<string, string> = {
  HBM:  "#EA002C",
  DRAM: "#3B82F6",
  NAND: "#8B5CF6",
};

const WH_CAPACITY_PALLET: Record<string, number> = {
  "MWH-01": 7000,
  "MWH-02": 2600,
  "HZW-01": 800,
  "MRO-01": 2200,
};

function clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }

// 1% 단위 슬라이더 — + 초록, - 빨강, 0 회색
function DemandSlider({
  product, value, onChange,
}: { product: string; value: number; onChange: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  const isPos = value > 0;
  const isNeg = value < 0;
  const color = isPos ? "#00875A" : isNeg ? "#EA002C" : "#999";
  const bgColor = isPos ? "#E6FAF1" : isNeg ? "#FFF0F2" : "#F3F0EE";

  function startEdit() {
    setInputVal(String(value));
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commit(raw: string) {
    const v = Math.min(50, Math.max(-50, Math.round(Number(raw)) || 0));
    onChange(v);
    setEditing(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold" style={{ color: PRODUCT_COLOR[product] }}>{product}</span>
        {editing ? (
          <div className="relative flex items-center">
            <input
              ref={inputRef}
              type="number"
              min={-50} max={50} step={1}
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onBlur={() => commit(inputVal)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit(inputVal);
                if (e.key === "Escape") setEditing(false);
              }}
              className="w-[80px] text-center font-bold text-sm rounded-lg outline-none border-2 px-1 py-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              style={{ color, backgroundColor: bgColor, borderColor: color }}
            />
            <span className="absolute right-2 text-xs font-bold pointer-events-none" style={{ color }}>%</span>
          </div>
        ) : (
          <div
            onClick={startEdit}
            title="클릭하여 직접 입력"
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold text-sm min-w-[72px] justify-center transition-colors cursor-pointer select-none hover:opacity-75"
            style={{ color, backgroundColor: bgColor }}
          >
            {isPos ? "+" : ""}{value}%
          </div>
        )}
      </div>
      <div className="relative">
        <input
          type="range"
          min={-50} max={50} step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-2 rounded-full appearance-none cursor-pointer"
          style={{
            background: value === 0
              ? "#E5E7EB"
              : value > 0
                ? `linear-gradient(to right, #E5E7EB 50%, #00875A ${50 + value}%, #E5E7EB ${50 + value}%)`
                : `linear-gradient(to right, #E5E7EB ${50 + value}%, #EA002C 50%, #E5E7EB 50%)`,
            accentColor: color,
          }}
        />
        <div className="flex justify-between text-[10px] text-[#CCC] mt-0.5 px-0.5">
          <span>-50%</span><span>0</span><span>+50%</span>
        </div>
      </div>
      {/* 버튼 단축키 */}
      <div className="flex gap-1 flex-wrap">
        {[-30, -10, 0, +10, +30].map((v) => (
          <button key={v} onClick={() => onChange(v)}
            className="px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors"
            style={{
              borderColor: value === v ? color : "#E5E7EB",
              color: value === v ? color : "#999",
              backgroundColor: value === v ? bgColor : "transparent",
            }}
          >
            {v > 0 ? `+${v}` : v}%
          </button>
        ))}
      </div>
    </div>
  );
}

export default function MarketSimClient({ procUsages, whData }: { procUsages: ProcUsage[]; whData: WhData[] }) {
  const router = useRouter();
  const [demand, setDemand] = useState({ HBM: 0, DRAM: 0, NAND: 0 });

  // 공정별 소비량 변화 계산
  const procImpact = useMemo(() => {
    const map: Record<string, { base: number; delta: number; byProduct: Record<string, number> }> = {};
    for (const u of procUsages) {
      if (!map[u.procCode]) map[u.procCode] = { base: 0, delta: 0, byProduct: {} };
      const delta = u.monthlyQty * (demand[u.product as keyof typeof demand] ?? 0) / 100;
      map[u.procCode].base += u.monthlyQty;
      map[u.procCode].delta += delta;
      map[u.procCode].byProduct[u.product] = (map[u.procCode].byProduct[u.product] ?? 0) + u.monthlyQty;
    }
    return map;
  }, [procUsages, demand]);

  // 창고별 영향 계산
  const whImpact = useMemo(() => {
    // whCode별 월 소비량 증분
    const whDelta: Record<string, number> = {};
    const whBase: Record<string, number> = {};
    for (const u of procUsages) {
      whDelta[u.whCode] = (whDelta[u.whCode] ?? 0) + u.monthlyQty * (demand[u.product as keyof typeof demand] ?? 0) / 100;
      whBase[u.whCode] = (whBase[u.whCode] ?? 0) + u.monthlyQty;
    }

    return whData.map((w) => {
      const palletCap = WH_CAPACITY_PALLET[w.code] ?? w.totalCapacity;
      const currentPallets = Math.round(palletCap * w.utilization / 100);
      const freePallets = palletCap - currentPallets;

      const dailyDeltaPallets = (whDelta[w.code] ?? 0) / 30 / 100; // 단순 비례 추정
      const projectedUtil = clamp(
        w.utilization + (whDelta[w.code] ?? 0) / (whBase[w.code] || 1) * w.utilization,
        0, 100
      );
      const daysUntilFull = dailyDeltaPallets > 0 && freePallets > 0
        ? Math.round(freePallets / dailyDeltaPallets)
        : null;

      const alertLevel: "danger" | "warn" | "ok" =
        projectedUtil >= 85 ? "danger" : projectedUtil >= 70 ? "warn" : "ok";

      return { ...w, palletCap, projectedUtil: Math.round(projectedUtil), daysUntilFull, alertLevel };
    }).filter((w) => WH_CAPACITY_PALLET[w.code]);
  }, [procUsages, whData, demand]);

  const hasAnyDemand = Object.values(demand).some((v) => v !== 0);

  const PROC_ORDER = ["P01","P02","P03","P04","P05","P06","P07","P08","P09","P10"];
  const topProcs = PROC_ORDER.filter((c) => procImpact[c])
    .map((c) => ({ code: c, ...procImpact[c] }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-end justify-between mb-7">
        <div>
          <button onClick={() => router.back()} className="text-xs text-[#999] hover:text-[#555] mb-2 flex items-center gap-1">
            ← 돌아가기
          </button>
          <div className="text-2xl font-extrabold tracking-tight">수요 시나리오 시뮬레이터</div>
          <div className="text-sm text-[#999] mt-0.5">제품별 수요 변화 → 공정 소비량 · 창고 영향 예측</div>
        </div>
        {hasAnyDemand && (
          <div className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg text-xs font-bold">
            시나리오 적용 중
          </div>
        )}
      </div>

      <div className="grid grid-cols-5 gap-5">

        {/* 좌측: 슬라이더 */}
        <div className="col-span-2">
          <div className="bg-white rounded-2xl border border-[#E8E8E8] p-5">
            <div className="flex items-center justify-between mb-5">
              <div className="text-xs font-bold text-[#333]">제품 수요 조정</div>
              <button
                onClick={() => setDemand({ HBM: 0, DRAM: 0, NAND: 0 })}
                className="text-[11px] text-[#999] hover:text-[#555] underline"
              >
                초기화
              </button>
            </div>
            <div className="space-y-6">
              {(["HBM", "DRAM", "NAND"] as const).map((p) => (
                <DemandSlider key={p} product={p} value={demand[p]}
                  onChange={(v) => setDemand((d) => ({ ...d, [p]: v }))} />
              ))}
            </div>
            <div className="mt-5 pt-4 border-t border-[#F0EFED] text-[10px] text-[#999] space-y-1">
              <div>• 수요 변화율은 공정별 자재 소비량에 비례 적용</div>
              <div>• 창고 포화 예상은 현재 여유 용량 ÷ 일 소비 증분 기준</div>
              <div>• 범위: -50% ~ +50% (1% 단위)</div>
            </div>
          </div>
        </div>

        {/* 우측: 결과 */}
        <div className="col-span-3 space-y-4">

          {/* 창고 영향 */}
          <div className="bg-white rounded-2xl border border-[#E8E8E8] p-5">
            <div className="text-xs font-bold text-[#333] mb-4">창고 용량 예측 (현재 → 예상)</div>
            <div className="space-y-3">
              {whImpact.map((w) => {
                const barColor = w.alertLevel === "danger" ? "#EA002C" : w.alertLevel === "warn" ? "#F97316" : "#00875A";
                const projDiff = w.projectedUtil - w.utilization;
                return (
                  <div key={w.code}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#333]">{w.code}</span>
                        <span className="text-[10px] text-[#999]">{w.name}</span>
                        {w.alertLevel === "danger" && (
                          <span className="text-[10px] font-bold text-[#EA002C] bg-[#FFF0F2] px-1.5 py-0.5 rounded-full">
                            ⚠ 포화 위험
                          </span>
                        )}
                        {w.alertLevel === "warn" && (
                          <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
                            주의
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-[#999]">{w.utilization}%</span>
                        <span className="text-[#CCC]">→</span>
                        <span className="font-bold" style={{ color: barColor }}>{w.projectedUtil}%</span>
                        {projDiff !== 0 && (
                          <span className="text-[10px] font-semibold" style={{ color: projDiff > 0 ? "#EA002C" : "#00875A" }}>
                            ({projDiff > 0 ? "+" : ""}{projDiff}%)
                          </span>
                        )}
                      </div>
                    </div>
                    {/* 이중 바 (현재 + 예상) */}
                    <div className="relative h-3 bg-[#F0EFED] rounded-full overflow-hidden">
                      <div className="absolute h-full bg-[#DDD] rounded-full" style={{ width: `${w.utilization}%` }} />
                      <div className="absolute h-full rounded-full transition-all duration-500"
                        style={{ width: `${w.projectedUtil}%`, backgroundColor: barColor, opacity: 0.7 }} />
                    </div>
                    {w.daysUntilFull !== null && w.daysUntilFull < 120 && (
                      <div className="text-[10px] text-[#EA002C] mt-0.5">
                        현 추세 지속 시 약 {w.daysUntilFull}일 후 포화
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 공정 영향 Top 6 */}
          <div className="bg-white rounded-2xl border border-[#E8E8E8] p-5">
            <div className="text-xs font-bold text-[#333] mb-4">공정별 소비량 영향 (상위 6)</div>
            {!hasAnyDemand ? (
              <div className="text-center py-6 text-sm text-[#CCC]">슬라이더를 조정하면 결과가 표시돼요</div>
            ) : (
              <div className="space-y-3">
                {topProcs.map((p) => {
                  const pct = p.base > 0 ? Math.round(p.delta / p.base * 100) : 0;
                  const isIncrease = p.delta >= 0;
                  return (
                    <div key={p.code} className="flex items-center gap-3">
                      <span className="text-xs font-bold text-[#333] w-8 shrink-0">{p.code}</span>
                      <div className="flex-1 relative h-2 bg-[#F0EFED] rounded-full overflow-hidden">
                        <div className="absolute top-0 left-0 h-full bg-[#DDD] rounded-full" style={{ width: "100%" }} />
                        <div className="absolute top-0 left-0 h-full rounded-full transition-all"
                          style={{
                            width: `${clamp(Math.abs(pct), 0, 100)}%`,
                            backgroundColor: isIncrease ? "#EA002C" : "#3B82F6",
                            opacity: 0.75,
                          }}
                        />
                      </div>
                      <span className="text-xs font-bold w-16 text-right shrink-0"
                        style={{ color: isIncrease ? "#EA002C" : "#3B82F6" }}>
                        {isIncrease ? "+" : ""}{pct}%
                      </span>
                      <span className="text-[10px] text-[#999] w-24 text-right shrink-0">
                        {Math.round(p.delta).toLocaleString()} /월
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
