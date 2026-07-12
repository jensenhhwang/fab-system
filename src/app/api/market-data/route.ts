export const dynamic = "force-dynamic";

// DRAM/NAND 시드 데이터 (TrendForce Q2 2026 기준)
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

export async function GET() {
  try {
    const res = await fetch("https://siliconanalysts.com/api/v1/hbm", {
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error("upstream error");
    const json = await res.json();
    const data = json.data;

    return Response.json({
      hbm: {
        spotPrices: data.spotPrices ?? [],
        marketShare: data.marketShare ?? [],
        leadingIndicators: data.leadingIndicators ?? [],
        specs: data.specs ?? [],
      },
      ...DRAM_NAND_SEED,
      lastUpdated: json.meta?.updated ?? new Date().toISOString(),
    });
  } catch {
    // fallback — upstream 불가 시 시드만 반환
    return Response.json({
      hbm: {
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
      },
      ...DRAM_NAND_SEED,
      lastUpdated: new Date().toISOString(),
    });
  }
}
