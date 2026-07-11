export const dynamic = "force-dynamic";

import { getWarehouseCapacity, type WarehouseCapacity } from "@/lib/queries";

const CAT_COLOR: Record<string, string> = {
  GAS: "#B91C1C", CHM: "#1D4ED8", CSM: "#7C3AED", UTL: "#059669", PKG: "#64748B",
};
const TYPE_LABEL: Record<string, string> = {
  AS_RS: "자동화 (AS/RS)", FLAT: "평치", HAZMAT: "위험물 방폭", MRO: "공구·MRO",
};
const TYPE_DESC: Record<string, string> = {
  AS_RS: "고층 랙 · 스태커크레인 · 고밀도 자동보관",
  FLAT: "평치 적재 · 접근성 우수 · 저밀도",
  HAZMAT: "방폭 설비 · 법적 저장 한도 관리",
  MRO: "공구·부품 소형 슬롯 보관",
};

function pctColor(p: number) {
  return p >= 90 ? "#EA002C" : p >= 80 ? "#F7A600" : "#00B96B";
}

function Gauge({ pct }: { pct: number }) {
  const c = pctColor(pct);
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-3 bg-[#F0F0F0] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: c }} />
      </div>
      <span className="text-lg font-black tabular-nums w-14 text-right" style={{ color: c }}>{pct}%</span>
    </div>
  );
}

function CategoryBar({ wh }: { wh: WarehouseCapacity }) {
  const total = wh.byCategory.reduce((s, c) => s + c.occupancy, 0) || 1;
  return (
    <div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-[#F0F0F0]">
        {wh.byCategory.map((c) => (
          <div key={c.category} style={{ width: `${(c.occupancy / total) * 100}%`, backgroundColor: CAT_COLOR[c.category] ?? "#999" }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {wh.byCategory.map((c) => (
          <div key={c.category} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: CAT_COLOR[c.category] ?? "#999" }} />
            <span className="text-[10px] font-bold text-[#555]">{c.category}</span>
            <span className="text-[10px] text-[#999]">{c.occupancy.toLocaleString()}pl</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function WarehousePage() {
  const caps = await getWarehouseCapacity();
  const avg = caps.length ? Math.round(caps.reduce((s, w) => s + w.utilization, 0) / caps.length) : 0;
  const hazmatOver = caps.filter((w) => w.legalUtilization !== null && w.legalUtilization >= 90);

  return (
    <>
      <div className="mb-1 text-2xl font-extrabold tracking-tight">창고 Capacity</div>
      <div className="text-sm text-[#999] mb-6">
        점유 = Σ(재고 × 단위 파렛트 환산) · 재고 데이터와 실시간 연동 · 기준: {new Date().toLocaleDateString("ko-KR")}
      </div>

      {/* 요약 KPI */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-2xl p-5 shadow-sm border-t-4 border-[#F7A600]">
          <div className="text-[11px] text-[#999] mb-1 font-medium">전체 평균 점유율</div>
          <div className="text-4xl font-black leading-none" style={{ color: pctColor(avg) }}>{avg}<span className="text-lg font-semibold">%</span></div>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm border-t-4 border-[#0078D4]">
          <div className="text-[11px] text-[#999] mb-1 font-medium">운영 창고</div>
          <div className="text-4xl font-black text-[#0078D4] leading-none">{caps.length}<span className="text-lg font-semibold">동</span></div>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm border-t-4 border-[#EA002C]">
          <div className="text-[11px] text-[#999] mb-1 font-medium">위험물 한도 경보</div>
          <div className="text-4xl font-black text-[#EA002C] leading-none">{hazmatOver.length}</div>
          <div className="text-xs mt-1 text-[#999]">법적 한도 90% 초과</div>
        </div>
      </div>

      {/* 창고별 카드 */}
      <div className="grid grid-cols-2 gap-5">
        {caps.map((wh) => (
          <div key={wh.id} className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-sm font-bold text-[#111]">{wh.name}</div>
                <div className="text-[11px] text-[#0078D4] font-semibold mt-0.5">{TYPE_LABEL[wh.type] ?? wh.type}</div>
              </div>
              <span className="text-[10px] text-[#999] bg-[#F5F7FA] px-2 py-1 rounded-full">{wh.materialCount}종 보관</span>
            </div>

            <div className="text-[10px] text-[#999] mb-1">점유율 (현재 {wh.occupancy.toLocaleString()} / 총 {wh.totalCapacity.toLocaleString()} {wh.unit})</div>
            <Gauge pct={wh.utilization} />

            <div className="mt-4 mb-1 text-[10px] text-[#999]">카테고리별 점유</div>
            <CategoryBar wh={wh} />

            {/* 위험물 법적 한도 경보 */}
            {wh.legalLimit !== null && (
              <div className="mt-4 rounded-xl px-3 py-2.5"
                style={{ background: (wh.legalUtilization ?? 0) >= 90 ? "#FFF0F2" : "#FFFBEB" }}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold" style={{ color: (wh.legalUtilization ?? 0) >= 90 ? "#EA002C" : "#B97500" }}>
                    ⚠ 위험물 법적 저장 한도
                  </span>
                  <span className="text-[11px] font-black" style={{ color: (wh.legalUtilization ?? 0) >= 90 ? "#EA002C" : "#B97500" }}>
                    {wh.legalUtilization}% ({wh.occupancy.toLocaleString()}/{wh.legalLimit.toLocaleString()})
                  </span>
                </div>
              </div>
            )}

            <div className="mt-3 text-[10px] text-[#999] leading-relaxed">
              {TYPE_DESC[wh.type] ?? ""}{wh.temperature ? ` · ${wh.temperature}` : ""}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
