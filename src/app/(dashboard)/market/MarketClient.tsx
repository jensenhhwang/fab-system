"use client";

import { useRouter } from "next/navigation";

type SpotPrice = { product: string; price: string; trend: string; change: string; driver?: string };
type MarketShare = { name: string; share: number; color: string; note?: string };
type Indicator = { name: string; value: string; signal: string; desc?: string };
type PricePoint = { month: string; price: number };

type MarketData = {
  hbm: { spotPrices: SpotPrice[]; marketShare: MarketShare[]; leadingIndicators: Indicator[] };
  dram: { product: string; priceUSD: number; unit: string; changeQoQ: number; changeMoM: number; trend: string; driver: string; history: PricePoint[] };
  nand: { product: string; priceUSD: number; unit: string; changeQoQ: number; changeMoM: number; trend: string; driver: string; history: PricePoint[] };
  lastUpdated: string;
};

type ProcCap = { code: string; name: string; nMachines: number; monthly: number; color: string };

type FabCapacity = {
  procCapacity: ProcCap[];
  bottleneck: ProcCap;
  monthlyWspm: number;
  productRatio: { HBM: number; DRAM: number; NAND: number };
};

function TrendBadge({ change, trend }: { change: string; trend: string }) {
  const up = trend === "up";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-1.5 py-0.5 rounded-full ${up ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
      {up ? "▲" : "▼"} {change}
    </span>
  );
}

function MiniLineChart({ data, color }: { data: PricePoint[]; color: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data.map((d) => d.price));
  const max = Math.max(...data.map((d) => d.price));
  const range = max - min || 1;
  const w = 120, h = 36;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((d.price - min) / range) * (h - 6) - 3;
    return `${x},${y}`;
  });
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1].split(",")[0]} cy={pts[pts.length - 1].split(",")[1]} r="3" fill={color} />
    </svg>
  );
}

function CapBar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[11px] text-[#666] w-8 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-[#F0EFED] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[11px] font-semibold text-[#333] w-20 text-right shrink-0">
        {value.toLocaleString()} W
      </span>
    </div>
  );
}

export default function MarketClient({ market, fab }: { market: MarketData; fab: FabCapacity }) {
  const router = useRouter();
  const updatedAt = new Date(market.lastUpdated).toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric",
  });

  const maxProcCap = Math.max(...fab.procCapacity.map((p) => p.monthly));

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-end justify-between mb-7">
        <div>
          <div className="text-2xl font-extrabold tracking-tight">Market Intelligence</div>
          <div className="text-sm text-[#999] mt-0.5">반도체 시장 가격 · FAB 생산능력 모니터링</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#999]">데이터 기준: {updatedAt}</span>
          <button
            onClick={() => router.push("/simulation")}
            className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-[#EA002C] text-white hover:bg-[#C8001F] transition-colors"
          >
            수요 시나리오 시뮬 →
          </button>
        </div>
      </div>

      {/* ── 섹션 1: FAB 생산능력 ── */}
      <section className="mb-7">
        <div className="text-xs font-bold uppercase tracking-widest text-[#999] mb-3">FAB 월간 생산능력 (WSPM)</div>
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div className="bg-white rounded-2xl border border-[#E8E8E8] p-5 col-span-1">
            <div className="text-[11px] text-[#999] mb-1">총 장비</div>
            <div className="text-2xl font-extrabold text-[#1A1A1A]">
              {fab.procCapacity.reduce((s, p) => s + p.nMachines, 0)}
              <span className="text-sm font-medium text-[#999] ml-1">대</span>
            </div>
            <div className="text-xs text-[#999] mt-1">10개 공정</div>
          </div>
          <div className="bg-white rounded-2xl border border-[#E8E8E8] p-5 col-span-1">
            <div className="text-[11px] text-[#999] mb-1">병목 공정</div>
            <div className="text-lg font-extrabold" style={{ color: fab.bottleneck.color }}>
              {fab.bottleneck.code}
            </div>
            <div className="text-xs text-[#555] mt-0.5">{fab.bottleneck.name}</div>
            <div className="text-xs text-[#999] mt-1">{fab.bottleneck.monthly.toLocaleString()} W/월</div>
          </div>
          <div className="bg-[#1A1A1A] rounded-2xl p-5 col-span-1">
            <div className="text-[11px] text-white/50 mb-1">월 생산능력 (병목 기준)</div>
            <div className="text-2xl font-extrabold text-white">
              {(fab.monthlyWspm / 1000).toFixed(1)}K
              <span className="text-sm font-medium text-white/50 ml-1">wafers</span>
            </div>
            <div className="text-xs text-white/40 mt-1">~{Math.round(fab.monthlyWspm / 30).toLocaleString()} wafers/day</div>
          </div>
          <div className="bg-white rounded-2xl border border-[#E8E8E8] p-5 col-span-1">
            <div className="text-[11px] text-[#999] mb-2">제품별 캐파 비중</div>
            <div className="space-y-1.5">
              {(["HBM", "DRAM", "NAND"] as const).map((p) => (
                <div key={p} className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-[#333] w-10">{p}</span>
                  <div className="flex-1 h-1.5 bg-[#F0EFED] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{
                      width: `${fab.productRatio[p]}%`,
                      backgroundColor: p === "HBM" ? "#EA002C" : p === "DRAM" ? "#3B82F6" : "#8B5CF6",
                    }} />
                  </div>
                  <span className="text-[11px] text-[#666] w-8 text-right">{fab.productRatio[p]}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 공정별 캐파 바 */}
        <div className="bg-white rounded-2xl border border-[#E8E8E8] p-5">
          <div className="text-xs font-semibold text-[#555] mb-4">공정별 월 처리량 (Wafers/Month)</div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2.5">
            {fab.procCapacity.map((p) => (
              <CapBar key={p.code} value={p.monthly} max={maxProcCap} color={p.color}
                label={`${p.code}`} />
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-[#F0EFED] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#EA002C] animate-pulse" />
            <span className="text-xs text-[#999]">
              병목: <span className="font-semibold text-[#EA002C]">{fab.bottleneck.code} {fab.bottleneck.name}</span> — 전체 WSPM을 {fab.bottleneck.monthly.toLocaleString()}으로 제한
            </span>
          </div>
        </div>
      </section>

      {/* ── 섹션 2: 시장 가격 ── */}
      <section className="mb-7">
        <div className="text-xs font-bold uppercase tracking-widest text-[#999] mb-3">반도체 가격 현황</div>
        <div className="grid grid-cols-3 gap-4">

          {/* HBM 스팟 가격 */}
          <div className="bg-white rounded-2xl border border-[#E8E8E8] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-[#333]">HBM 스팟 가격</span>
              <span className="text-[10px] text-[#999]">per GPU stack</span>
            </div>
            <div className="space-y-3">
              {market.hbm.spotPrices.map((sp) => (
                <div key={sp.product} className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-[#333]">{sp.product}</div>
                    <div className="text-[11px] text-[#999]">{sp.driver ?? ""}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-[#1A1A1A]">{sp.price}</div>
                    <TrendBadge change={sp.change} trend={sp.trend} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* DRAM */}
          <div className="bg-white rounded-2xl border border-[#E8E8E8] p-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-[#333]">DRAM 계약가</span>
              <TrendBadge change={`+${market.dram.changeQoQ}% QoQ`} trend={market.dram.trend} />
            </div>
            <div className="text-[11px] text-[#999] mb-3">{market.dram.product}</div>
            <div className="text-3xl font-extrabold text-[#1A1A1A] mb-1">
              ${market.dram.priceUSD}
              <span className="text-sm font-normal text-[#999] ml-1">{market.dram.unit}</span>
            </div>
            <div className="text-xs text-[#999] mb-3">전월 대비 +{market.dram.changeMoM}%</div>
            <MiniLineChart data={market.dram.history} color="#3B82F6" />
            <div className="text-[10px] text-[#999] mt-2">{market.dram.driver}</div>
          </div>

          {/* NAND */}
          <div className="bg-white rounded-2xl border border-[#E8E8E8] p-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-[#333]">NAND Flash 계약가</span>
              <TrendBadge change={`+${market.nand.changeQoQ}% QoQ`} trend={market.nand.trend} />
            </div>
            <div className="text-[11px] text-[#999] mb-3">{market.nand.product}</div>
            <div className="text-3xl font-extrabold text-[#1A1A1A] mb-1">
              ${market.nand.priceUSD.toFixed(3)}
              <span className="text-sm font-normal text-[#999] ml-1">{market.nand.unit}</span>
            </div>
            <div className="text-xs text-[#999] mb-3">전월 대비 +{market.nand.changeMoM}%</div>
            <MiniLineChart data={market.nand.history} color="#8B5CF6" />
            <div className="text-[10px] text-[#999] mt-2">{market.nand.driver}</div>
          </div>
        </div>
      </section>

      {/* ── 섹션 3: 시장점유율 + 선행지표 ── */}
      <section>
        <div className="grid grid-cols-2 gap-4">

          {/* HBM 시장점유율 */}
          <div className="bg-white rounded-2xl border border-[#E8E8E8] p-5">
            <div className="text-xs font-bold text-[#333] mb-4">HBM 공급사 시장점유율 (2026)</div>
            <div className="space-y-3">
              {market.hbm.marketShare.map((m) => (
                <div key={m.name} className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-[#333] w-20 shrink-0">{m.name}</span>
                  <div className="flex-1 h-3 bg-[#F0EFED] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${m.share}%`, backgroundColor: m.color }} />
                  </div>
                  <span className="text-sm font-bold text-[#1A1A1A] w-10 text-right">{m.share}%</span>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-[#F0EFED] text-[10px] text-[#999]">
              출처: Silicon Analysts · {updatedAt} 기준
            </div>
          </div>

          {/* 선행 지표 */}
          <div className="bg-white rounded-2xl border border-[#E8E8E8] p-5">
            <div className="text-xs font-bold text-[#333] mb-4">선행 지표 (Leading Indicators)</div>
            <div className="space-y-3">
              {market.hbm.leadingIndicators.map((ind) => (
                <div key={ind.name} className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="text-xs font-semibold text-[#333]">{ind.name}</div>
                    {ind.desc && <div className="text-[10px] text-[#999] mt-0.5 leading-relaxed">{ind.desc}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-[#1A1A1A]">{ind.value}</div>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      ind.signal === "bullish" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                    }`}>
                      {ind.signal === "bullish" ? "Bullish" : "Bearish"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 p-3 bg-[#FFF0F2] rounded-xl">
              <div className="text-xs font-bold text-[#EA002C] mb-1">FAB 시사점</div>
              <div className="text-[11px] text-[#555] leading-relaxed">
                HBM 수요 강세 지속 — P08 TSV 공정 병목 해소 및 WH-C 위험물 창고 용량 선제 확보 필요
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
