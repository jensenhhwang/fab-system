export type MarketFreshness = "FRESH" | "STALE" | "ERROR" | "DISABLED" | "NEVER_COLLECTED";

export type MarketSourceView = {
  id: "TWSE" | "SEC";
  label: string;
  officialUrl: string;
  cadence: string;
  freshness: MarketFreshness;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  error: string | null;
};

export type TwseRevenueView = {
  companyCode: string;
  companyName: string;
  period: string;
  revenueTwdThousand: number;
  changeMoM: number | null;
  changeYoY: number | null;
  publishedAt: string;
  collectedAt: string;
  sourceUrl: string;
};

export type SecFilingView = {
  cik: string;
  companyName: string;
  form: string;
  filedAt: string;
  accessionNumber: string;
  primaryDocument: string;
  collectedAt: string;
  sourceUrl: string;
};

export type MarketDashboardData = {
  hbm: {
    spotPrices: { product: string; price: string; trend: string; change: string; driver?: string }[];
    marketShare: { name: string; share: number; color: string; note?: string }[];
    leadingIndicators: { name: string; value: string; signal: string; desc?: string }[];
  };
  dram: {
    product: string;
    priceUSD: number;
    unit: string;
    changeQoQ: number;
    changeMoM: number;
    trend: string;
    driver: string;
    history: { month: string; price: number }[];
  };
  nand: {
    product: string;
    priceUSD: number;
    unit: string;
    changeQoQ: number;
    changeMoM: number;
    trend: string;
    driver: string;
    history: { month: string; price: number }[];
  };
  pricingMeta: {
    mode: "DEMO";
    asOf: string;
    notice: string;
  };
  live: {
    sources: MarketSourceView[];
    twseRevenue: TwseRevenueView[];
    secFilings: SecFilingView[];
  };
  lastRefreshedAt: string;
};

export const DEMO_PRICING = {
  hbm: {
    spotPrices: [
      { product: "HBM3 (Active)", price: "$1,200 - $1,400", trend: "up", change: "+5%" },
      { product: "HBM3E 8-Hi", price: "$1,800 - $2,000", trend: "up", change: "+10%" },
      { product: "HBM3E 12-Hi", price: "$2,600 - $2,800", trend: "up", change: "+15%" },
    ],
    marketShare: [
      { name: "SK Hynix", share: 62, color: "#10b981" },
      { name: "Samsung", share: 30, color: "#3b82f6" },
      { name: "Micron", share: 8, color: "#a855f7" },
    ],
    leadingIndicators: [
      { name: "AI 서버 수요 프록시", value: "+38% YoY", signal: "bullish" },
      { name: "한국 메모리 수출", value: "+32% YoY", signal: "bullish" },
    ],
  },
  dram: {
    product: "DDR5 16GB RDIMM",
    priceUSD: 45,
    unit: "USD/unit",
    changeQoQ: 61,
    changeMoM: 8,
    trend: "up",
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
    trend: "up",
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
  pricingMeta: {
    mode: "DEMO" as const,
    asOf: "2026-07-01T00:00:00.000Z",
    notice: "가격·점유율은 라이선스 데이터 계약 전 데모 기준값입니다.",
  },
};
