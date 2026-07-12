export const dynamic = "force-dynamic";

import { getProcessUsagesWithMaterial } from "@/lib/queries";
import MarketClient from "./MarketClient";

// 장비별 일일 웨이퍼 처리량 (wafers/day/machine) — ITRS 기준 추정치
const WPD: Record<string, number> = {
  P01: 150, P02: 200, P03: 65, P04: 180, P05: 140,
  P06: 120, P07: 160, P08: 80,  P09: 100, P10: 90,
};

// ProcessFlow3D의 PROCESSES와 동일 (서버에서 직접 사용하기 위해 재정의)
const PROCESSES = [
  { code: "P01", name: "산화막",     color: "#3B82F6", nMachines: 8  },
  { code: "P02", name: "CVD",        color: "#8B5CF6", nMachines: 12 },
  { code: "P03", name: "포토",       color: "#EC4899", nMachines: 12 },
  { code: "P04", name: "식각",       color: "#F97316", nMachines: 16 },
  { code: "P05", name: "이온주입",   color: "#EAB308", nMachines: 8  },
  { code: "P06", name: "금속배선1",  color: "#10B981", nMachines: 10 },
  { code: "P07", name: "CMP",        color: "#06B6D4", nMachines: 10 },
  { code: "P08", name: "TSV/배선2",  color: "#EF4444", nMachines: 8  },
  { code: "P09", name: "웨이퍼테스트", color: "#84CC16", nMachines: 12 },
  { code: "P10", name: "패키징",     color: "#D946EF", nMachines: 10 },
];

const DRAM_NAND_SEED = {
  dram: {
    product: "DDR5 16GB RDIMM",
    priceUSD: 45,
    unit: "USD/unit",
    changeQoQ: 61,
    changeMoM: 8,
    trend: "up" as const,
    driver: "AI 서버 수요 급증 + HBM 전용 캐파 전환",
    history: [
      { month: "2026-02", price: 28 },
      { month: "2026-03", price: 31 },
      { month: "2026-04", price: 36 },
      { month: "2026-05", price: 39 },
      { month: "2026-06", price: 43 },
      { month: "2026-07", price: 45 },
    ],
  },
  nand: {
    product: "NAND QLC 128GB",
    priceUSD: 0.082,
    unit: "USD/GB",
    changeQoQ: 72,
    changeMoM: 12,
    trend: "up" as const,
    driver: "데이터센터 SSD 수요 + 재고 정상화",
    history: [
      { month: "2026-02", price: 0.047 },
      { month: "2026-03", price: 0.053 },
      { month: "2026-04", price: 0.062 },
      { month: "2026-05", price: 0.071 },
      { month: "2026-06", price: 0.076 },
      { month: "2026-07", price: 0.082 },
    ],
  },
};

const FALLBACK_HBM = {
  spotPrices: [
    { product: "HBM3 (Active)", price: "$1,200 - $1,400", trend: "up", change: "+5%" },
    { product: "HBM3E 8-Hi",   price: "$1,800 - $2,000", trend: "up", change: "+10%" },
    { product: "HBM3E 12-Hi",  price: "$2,600 - $2,800", trend: "up", change: "+15%" },
  ],
  marketShare: [
    { name: "SK Hynix", share: 62, color: "#10b981" },
    { name: "Samsung",  share: 30, color: "#3b82f6" },
    { name: "Micron",   share: 8,  color: "#a855f7" },
  ],
  leadingIndicators: [
    { name: "AI 서버 수요 프록시", value: "+38% YoY", signal: "bullish" },
    { name: "한국 메모리 수출",    value: "+32% YoY", signal: "bullish" },
  ],
  specs: [],
};

async function getMarketData() {
  try {
    const res = await fetch("https://siliconanalysts.com/api/v1/hbm", {
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error("upstream error");
    const json = await res.json();
    const data = json.data;
    return {
      hbm: {
        spotPrices: data.spotPrices ?? [],
        marketShare: data.marketShare ?? [],
        leadingIndicators: data.leadingIndicators ?? [],
        specs: data.specs ?? [],
      },
      ...DRAM_NAND_SEED,
      lastUpdated: json.meta?.updated ?? new Date().toISOString(),
    };
  } catch {
    return {
      hbm: FALLBACK_HBM,
      ...DRAM_NAND_SEED,
      lastUpdated: new Date().toISOString(),
    };
  }
}

async function getFabCapacity() {
  const usages = await getProcessUsagesWithMaterial();

  // 공정별 월 처리량 (wafers)
  const procCapacity = PROCESSES.map((p) => {
    const monthly = (WPD[p.code] ?? 100) * p.nMachines * 30;
    return { code: p.code, name: p.name, nMachines: p.nMachines, monthly, color: p.color };
  });

  const bottleneck = procCapacity.reduce((a, b) => (a.monthly < b.monthly ? a : b));

  // 제품별 월 소비량 집계 (자재 관점)
  const byProduct: Record<string, number> = {};
  for (const u of usages) {
    byProduct[u.product] = (byProduct[u.product] ?? 0) + u.monthlyQty;
  }
  const totalUsage = Object.values(byProduct).reduce((a, b) => a + b, 0);
  const productRatio = {
    HBM:  totalUsage > 0 ? Math.round((byProduct.HBM  ?? 0) / totalUsage * 100) : 0,
    DRAM: totalUsage > 0 ? Math.round((byProduct.DRAM ?? 0) / totalUsage * 100) : 0,
    NAND: totalUsage > 0 ? Math.round((byProduct.NAND ?? 0) / totalUsage * 100) : 0,
  };

  return {
    procCapacity,
    bottleneck,
    monthlyWspm: bottleneck.monthly,
    productRatio,
  };
}

export default async function MarketPage() {
  const [market, fab] = await Promise.all([getMarketData(), getFabCapacity()]);
  return <MarketClient market={market} fab={fab} />;
}
