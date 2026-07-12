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

async function getMarketData() {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const res = await fetch(`${base}/api/market-data`, { cache: "no-store" });
  if (!res.ok) throw new Error("market-data fetch failed");
  return res.json();
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
