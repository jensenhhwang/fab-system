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

type FabCapacity = {
  version: string;
  globalMemoryWspm: number;
  campus: { nominalWspm: number; effectiveWspm: number; globalMemorySharePct: number };
  fabs: {
    id: string; name: string; product: "HBM" | "DRAM" | "NAND"; nominalWspm: number;
    utilization: number; waferYield: number; marketReferenceWspm: number; color: string;
    dimensionsM: { length: number; width: number; height: number };
    metrics: { utilizedWspm: number; effectiveWspm: number; dailyWaferStarts: number; waferEquivalentSharePct: number };
  }[];
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

export default function MarketClient({ market, fab }: { market: MarketData; fab: FabCapacity }) {
  const router = useRouter();
  const updatedAt = new Date(market.lastUpdated).toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric",
  });

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

      {/* ── 섹션 1: 3-Fab 생산능력 기준선 ── */}
      <section className="mb-7">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><div className="text-xs font-bold uppercase tracking-widest text-[#999]">3-FAB CAMPUS · WSPM</div><div className="mt-1 text-sm font-extrabold">M20 HBM · M21 DRAM · M22 NAND</div></div><div className="rounded-full bg-amber-50 px-3 py-1 text-[10px] font-bold text-amber-800">{fab.version} · wafer-equivalent 학습 가정</div></div>
        <div className="mb-4 grid gap-4 xl:grid-cols-3">
          {fab.fabs.map(item => <div key={item.id} className="overflow-hidden rounded-2xl border bg-white" style={{ borderColor: `${item.color}35` }}>
            <div className="h-1.5" style={{ background: item.color }} /><div className="p-5"><div className="flex items-start justify-between"><div><div className="text-xl font-black" style={{ color: item.color }}>{item.id}</div><div className="mt-0.5 text-xs font-bold">{item.name}</div></div><div className="text-right"><div className="text-2xl font-black">{(item.nominalWspm / 1000).toFixed(0)}K</div><div className="text-[10px] text-[#888]">명목 WSPM</div></div></div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-[#F8F6F4] p-2"><span className="text-[9px] text-[#888]">가동률</span><b className="mt-1 block text-sm">{(item.utilization * 100).toFixed(0)}%</b></div><div className="rounded-xl bg-[#F8F6F4] p-2"><span className="text-[9px] text-[#888]">wafer yield</span><b className="mt-1 block text-sm">{(item.waferYield * 100).toFixed(0)}%</b></div><div className="rounded-xl bg-[#F8F6F4] p-2"><span className="text-[9px] text-[#888]">유효 WSPM</span><b className="mt-1 block text-sm">{(item.metrics.effectiveWspm / 1000).toFixed(1)}K</b></div></div>
            <div className="mt-4 flex items-end justify-between"><div><div className="text-[9px] font-bold text-[#888]">설계 외곽치</div><div className="mt-1 text-[11px] font-bold">{item.dimensionsM.length} × {item.dimensionsM.width} × {item.dimensionsM.height}m</div></div><div className="text-right"><div className="text-[9px] font-bold text-[#888]">{item.product} wafer-equivalent</div><div className="mt-0.5 text-xl font-black" style={{ color: item.color }}>{item.metrics.waferEquivalentSharePct.toFixed(1)}%</div><div className="text-[9px] text-[#aaa]">분모 {(item.marketReferenceWspm / 1000).toFixed(0)}K WSPM</div></div></div></div>
          </div>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-[#171817] p-4 text-white"><div className="text-[10px] text-white/50">캠퍼스 명목 생산능력</div><div className="mt-1 text-2xl font-black">{(fab.campus.nominalWspm / 1000).toFixed(0)}K <span className="text-xs font-normal text-white/50">WSPM</span></div></div><div className="rounded-2xl border bg-white p-4"><div className="text-[10px] text-[#888]">캠퍼스 유효 생산능력</div><div className="mt-1 text-2xl font-black">{(fab.campus.effectiveWspm / 1000).toFixed(1)}K <span className="text-xs font-normal text-[#999]">WSPM</span></div></div><div className="rounded-2xl border bg-white p-4"><div className="text-[10px] text-[#888]">글로벌 300mm 메모리 대비</div><div className="mt-1 text-2xl font-black text-blue-700">{fab.campus.globalMemorySharePct.toFixed(1)}%</div><div className="mt-1 text-[9px] text-[#aaa]">SEMI 2026 기준 {(fab.globalMemoryWspm / 1_000_000).toFixed(1)}M WSPM</div></div></div>
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] leading-5 text-amber-900"><b>해석 주의:</b> 제품별 분모는 4.1M 메모리 총량을 학습 목적으로 HBM·DRAM·NAND에 배분한 계획값입니다. 매출·bit·HBM stack 시장점유율이 아니며, 완제품 비중은 die/wafer·stack 높이·패키징 수율 모델 이후 계산합니다.</div>
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
