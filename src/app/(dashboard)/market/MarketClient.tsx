"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { MarketDashboardData, MarketFreshness } from "@/lib/market-data";

type PricePoint = { month: string; price: number };
type FabCapacity = {
  version: string;
  globalMemoryWspm: number;
  campus: { nominalWspm: number; effectiveWspm: number; globalMemorySharePct: number };
  fabs: {
    id: string;
    name: string;
    product: "HBM" | "DRAM" | "NAND";
    nominalWspm: number;
    utilization: number;
    waferYield: number;
    marketReferenceWspm: number;
    color: string;
    dimensionsM: { length: number; width: number; height: number };
    metrics: { utilizedWspm: number; effectiveWspm: number; dailyWaferStarts: number; waferEquivalentSharePct: number };
  }[];
};

const FRESHNESS_STYLE: Record<MarketFreshness, string> = {
  FRESH: "bg-emerald-100 text-emerald-700",
  STALE: "bg-amber-100 text-amber-800",
  ERROR: "bg-red-100 text-red-700",
  DISABLED: "bg-slate-100 text-slate-600",
  NEVER_COLLECTED: "bg-blue-100 text-blue-700",
};

const FRESHNESS_LABEL: Record<MarketFreshness, string> = {
  FRESH: "FRESH",
  STALE: "STALE",
  ERROR: "ERROR",
  DISABLED: "DISABLED",
  NEVER_COLLECTED: "수집 대기",
};

function dateTime(value: string | null) {
  if (!value) return "아직 없음";
  return new Date(value).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function TrendBadge({ change, trend }: { change: string; trend: string }) {
  const up = trend === "up";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-bold ${up ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
      {up ? "▲" : "▼"} {change}
    </span>
  );
}

function MiniLineChart({ data, color }: { data: PricePoint[]; color: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data.map((item) => item.price));
  const max = Math.max(...data.map((item) => item.price));
  const range = max - min || 1;
  const width = 120;
  const height = 36;
  const points = data.map((item, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((item.price - min) / range) * (height - 6) - 3;
    return `${x},${y}`;
  });
  const [lastX, lastY] = points[points.length - 1].split(",");
  return (
    <svg width={width} height={height} className="overflow-visible" aria-label="가격 추이">
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="3" fill={color} />
    </svg>
  );
}

export default function MarketClient({ market: initialMarket, fab }: { market: MarketDashboardData; fab: FabCapacity }) {
  const router = useRouter();
  const [market, setMarket] = useState(initialMarket);
  const [polling, setPolling] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    setPolling(true);
    try {
      const response = await fetch("/api/market-data", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setMarket(await response.json() as MarketDashboardData);
      setPollError(null);
    } catch (error) {
      setPollError(error instanceof Error ? error.message : "갱신 실패");
    } finally {
      setPolling(false);
    }
  }, []);

  useEffect(() => {
    const warmup = window.setTimeout(refresh, 5_000);
    const interval = window.setInterval(refresh, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(warmup);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-2xl font-extrabold tracking-tight">Market Intelligence</div>
          <div className="mt-0.5 text-sm text-[#999]">공식 수요 신호 · 반도체 가격 · FAB 생산능력</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-right text-[10px] leading-4 text-[#999]">
            화면 {polling ? "갱신 중…" : "60초 자동 갱신"}
            <br />
            {dateTime(market.lastRefreshedAt)}
            {pollError && <span className="block text-red-600">{pollError}</span>}
          </span>
          <button
            onClick={() => router.push("/simulation")}
            className="rounded-lg bg-[#EA002C] px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#C8001F]"
          >
            수요 시나리오 시뮬 →
          </button>
        </div>
      </div>

      <section className="mb-7">
        <div className="mb-3">
          <div className="text-xs font-bold uppercase tracking-widest text-[#999]">LIVE DEMAND SIGNALS</div>
          <div className="mt-1 text-sm font-extrabold">공식 소스에서 수집한 수요·실적 신호</div>
        </div>
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          {market.live.sources.map((source) => (
            <a key={source.id} href={source.officialUrl} target="_blank" rel="noreferrer" className="rounded-2xl border bg-white p-4 transition-colors hover:border-[#bbb]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black">{source.label}</div>
                  <div className="mt-1 text-[10px] text-[#888]">{source.cadence}</div>
                </div>
                <span className={`rounded-full px-2 py-1 text-[9px] font-black ${FRESHNESS_STYLE[source.freshness]}`}>
                  {FRESHNESS_LABEL[source.freshness]}
                </span>
              </div>
              <div className="mt-3 text-[10px] leading-4 text-[#777]">
                최근 성공: {dateTime(source.lastSuccessAt)}
                {source.error && <span className="block text-red-600">{source.error}</span>}
              </div>
            </a>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
          <div className="rounded-2xl border bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold">대만 전자 공급망 월매출</div>
                <div className="mt-1 text-[10px] text-[#999]">TWSE 실제 공시 · 매출 단위 TWD billion</div>
              </div>
              <span className="text-[9px] font-bold text-[#888]">ACTUAL</span>
            </div>
            {market.live.twseRevenue.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {market.live.twseRevenue.map((item) => (
                  <a key={item.companyCode} href={item.sourceUrl} target="_blank" rel="noreferrer" className="rounded-xl bg-[#F8F6F4] p-3 hover:bg-[#F3F0ED]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold">{item.companyName} · {item.companyCode}</span>
                      <span className="text-[9px] text-[#888]">{item.period}</span>
                    </div>
                    <div className="mt-2 text-xl font-black">{(item.revenueTwdThousand / 1_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}</div>
                    <div className="mt-1 flex gap-2 text-[10px]">
                      <span className={(item.changeMoM ?? 0) >= 0 ? "text-emerald-700" : "text-red-600"}>MoM {item.changeMoM == null ? "—" : `${item.changeMoM.toFixed(1)}%`}</span>
                      <span className={(item.changeYoY ?? 0) >= 0 ? "text-emerald-700" : "text-red-600"}>YoY {item.changeYoY == null ? "—" : `${item.changeYoY.toFixed(1)}%`}</span>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="rounded-xl bg-[#F8F6F4] p-6 text-center text-xs text-[#888]">첫 공식 데이터 수집을 기다리는 중입니다.</div>
            )}
          </div>

          <div className="rounded-2xl border bg-white p-5">
            <div className="mb-4">
              <div className="text-xs font-bold">AI·메모리 고객사 최신 공시</div>
              <div className="mt-1 text-[10px] text-[#999]">SEC EDGAR · 10-K / 10-Q / 8-K</div>
            </div>
            {market.live.secFilings.length ? (
              <div className="max-h-64 space-y-2 overflow-auto pr-1">
                {market.live.secFilings.map((filing) => (
                  <a key={`${filing.cik}-${filing.accessionNumber}`} href={filing.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-xl bg-[#F8F6F4] p-3 hover:bg-[#F3F0ED]">
                    <div>
                      <div className="text-xs font-bold">{filing.companyName}</div>
                      <div className="mt-0.5 text-[9px] text-[#888]">{filing.filedAt}</div>
                    </div>
                    <span className="rounded-full bg-blue-100 px-2 py-1 text-[9px] font-black text-blue-700">{filing.form}</span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="rounded-xl bg-[#F8F6F4] p-6 text-center text-xs text-[#888]">SEC 연락처 설정 후 자동 수집됩니다.</div>
            )}
          </div>
        </div>
      </section>

      <section className="mb-7">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-[#999]">3-FAB CAMPUS · WSPM</div>
            <div className="mt-1 text-sm font-extrabold">M20 HBM · M21 DRAM · M22 NAND</div>
          </div>
          <div className="rounded-full bg-amber-50 px-3 py-1 text-[10px] font-bold text-amber-800">{fab.version} · wafer-equivalent 학습 가정</div>
        </div>
        <div className="mb-4 grid gap-4 xl:grid-cols-3">
          {fab.fabs.map((item) => (
            <div key={item.id} className="overflow-hidden rounded-2xl border bg-white" style={{ borderColor: `${item.color}35` }}>
              <div className="h-1.5" style={{ background: item.color }} />
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div><div className="text-xl font-black" style={{ color: item.color }}>{item.id}</div><div className="mt-0.5 text-xs font-bold">{item.name}</div></div>
                  <div className="text-right"><div className="text-2xl font-black">{(item.nominalWspm / 1000).toFixed(0)}K</div><div className="text-[10px] text-[#888]">명목 WSPM</div></div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-[#F8F6F4] p-2"><span className="text-[9px] text-[#888]">가동률</span><b className="mt-1 block text-sm">{(item.utilization * 100).toFixed(0)}%</b></div>
                  <div className="rounded-xl bg-[#F8F6F4] p-2"><span className="text-[9px] text-[#888]">wafer yield</span><b className="mt-1 block text-sm">{(item.waferYield * 100).toFixed(0)}%</b></div>
                  <div className="rounded-xl bg-[#F8F6F4] p-2"><span className="text-[9px] text-[#888]">유효 WSPM</span><b className="mt-1 block text-sm">{(item.metrics.effectiveWspm / 1000).toFixed(1)}K</b></div>
                </div>
                <div className="mt-4 flex items-end justify-between">
                  <div><div className="text-[9px] font-bold text-[#888]">설계 외곽치</div><div className="mt-1 text-[11px] font-bold">{item.dimensionsM.length} × {item.dimensionsM.width} × {item.dimensionsM.height}m</div></div>
                  <div className="text-right"><div className="text-[9px] font-bold text-[#888]">{item.product} wafer-equivalent</div><div className="mt-0.5 text-xl font-black" style={{ color: item.color }}>{item.metrics.waferEquivalentSharePct.toFixed(1)}%</div><div className="text-[9px] text-[#aaa]">분모 {(item.marketReferenceWspm / 1000).toFixed(0)}K WSPM</div></div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-[#171817] p-4 text-white"><div className="text-[10px] text-white/50">캠퍼스 명목 생산능력</div><div className="mt-1 text-2xl font-black">{(fab.campus.nominalWspm / 1000).toFixed(0)}K <span className="text-xs font-normal text-white/50">WSPM</span></div></div>
          <div className="rounded-2xl border bg-white p-4"><div className="text-[10px] text-[#888]">캠퍼스 유효 생산능력</div><div className="mt-1 text-2xl font-black">{(fab.campus.effectiveWspm / 1000).toFixed(1)}K <span className="text-xs font-normal text-[#999]">WSPM</span></div></div>
          <div className="rounded-2xl border bg-white p-4"><div className="text-[10px] text-[#888]">글로벌 300mm 메모리 대비</div><div className="mt-1 text-2xl font-black text-blue-700">{fab.campus.globalMemorySharePct.toFixed(1)}%</div><div className="mt-1 text-[9px] text-[#aaa]">SEMI 2026 기준 {(fab.globalMemoryWspm / 1_000_000).toFixed(1)}M WSPM</div></div>
        </div>
      </section>

      <section className="mb-7">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs font-bold uppercase tracking-widest text-[#999]">반도체 가격 현황</div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-violet-100 px-2 py-1 text-[9px] font-black text-violet-700">DEMO</span>
            <span className="text-[9px] text-[#888]">{market.pricingMeta.notice}</span>
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-[#E8E8E8] bg-white p-5">
            <div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold text-[#333]">HBM 스팟 가격</span><span className="text-[10px] text-[#999]">per GPU stack</span></div>
            <div className="space-y-3">
              {market.hbm.spotPrices.map((price) => (
                <div key={price.product} className="flex items-center justify-between">
                  <div><div className="text-xs font-semibold text-[#333]">{price.product}</div><div className="text-[11px] text-[#999]">{price.driver ?? ""}</div></div>
                  <div className="text-right"><div className="text-sm font-bold text-[#1A1A1A]">{price.price}</div><TrendBadge change={price.change} trend={price.trend} /></div>
                </div>
              ))}
            </div>
          </div>
          {(["dram", "nand"] as const).map((kind) => {
            const item = market[kind];
            const isDram = kind === "dram";
            return (
              <div key={kind} className="rounded-2xl border border-[#E8E8E8] bg-white p-5">
                <div className="mb-1 flex items-center justify-between"><span className="text-xs font-bold text-[#333]">{isDram ? "DRAM 계약가" : "NAND Flash 계약가"}</span><TrendBadge change={`+${item.changeQoQ}% QoQ`} trend={item.trend} /></div>
                <div className="mb-3 text-[11px] text-[#999]">{item.product}</div>
                <div className="mb-1 text-3xl font-extrabold text-[#1A1A1A]">${isDram ? item.priceUSD : item.priceUSD.toFixed(3)}<span className="ml-1 text-sm font-normal text-[#999]">{item.unit}</span></div>
                <div className="mb-3 text-xs text-[#999]">전월 대비 +{item.changeMoM}%</div>
                <MiniLineChart data={item.history} color={isDram ? "#3B82F6" : "#8B5CF6"} />
                <div className="mt-2 text-[10px] text-[#999]">{item.driver}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-[#E8E8E8] bg-white p-5">
            <div className="mb-4 flex items-center justify-between"><div className="text-xs font-bold text-[#333]">HBM 공급사 시장점유율</div><span className="rounded-full bg-violet-100 px-2 py-1 text-[9px] font-black text-violet-700">DEMO</span></div>
            <div className="space-y-3">
              {market.hbm.marketShare.map((item) => (
                <div key={item.name} className="flex items-center gap-3"><span className="w-20 shrink-0 text-xs font-semibold text-[#333]">{item.name}</span><div className="h-3 flex-1 overflow-hidden rounded-full bg-[#F0EFED]"><div className="h-full rounded-full" style={{ width: `${item.share}%`, backgroundColor: item.color }} /></div><span className="w-10 text-right text-sm font-bold">{item.share}%</span></div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-[#E8E8E8] bg-white p-5">
            <div className="mb-4 flex items-center justify-between"><div className="text-xs font-bold text-[#333]">선행 지표</div><span className="rounded-full bg-violet-100 px-2 py-1 text-[9px] font-black text-violet-700">DEMO</span></div>
            <div className="space-y-3">
              {market.hbm.leadingIndicators.map((item) => (
                <div key={item.name} className="flex items-start justify-between gap-3"><div><div className="text-xs font-semibold">{item.name}</div>{item.desc && <div className="mt-0.5 text-[10px] text-[#999]">{item.desc}</div>}</div><div className="text-right"><div className="text-sm font-bold">{item.value}</div><span className="text-[10px] font-semibold text-emerald-700">Bullish</span></div></div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
