import type { Product, TwinDailySnapshotDoc } from "@/lib/db";

// 운영일 1일치 스냅샷을 만드는 순수 함수. DB를 만지지 않으므로 테스트가 쉽고, 엔진 tick은
// 값을 모아 넘기기만 한다.

export type DailySnapshotInput = {
  operatingDay: number;
  /** 벽시계 사실 기록 */
  recordedAt: Date;
  producedByProduct: Partial<Record<Product, number>>;
  designDailyByProduct: Partial<Record<Product, number>>;
  shippedByProduct: Partial<Record<Product, number>>;
  contractDailyByProduct: Partial<Record<Product, number>>;
  materialDohs: { materialCode: string; doh: number }[];
  criticalCount: number;
  warehouses: { code: string; utilization: number; baselineUtilization: number }[];
  policy: { r1: number; r2: number; r3: number; r4: number };
  engine: { ticks: number; elapsedOperatingMs: number; clampedCatchUps: number };
};

const PRODUCTS: Product[] = ["HBM", "DRAM", "NAND"];

/** 분모가 0이면 100%가 아니라 0%다 — 설계 산출이 없는 제품을 "완벽 달성"으로 읽으면 안 된다. */
function pctOf(actual: number, target: number): number {
  if (target <= 0) return 0;
  return Math.round((actual / target) * 1000) / 10;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function buildDailySnapshot(input: DailySnapshotInput): TwinDailySnapshotDoc {
  const byDoh = [...input.materialDohs].sort((a, b) => a.doh - b.doh);
  return {
    _id: `OP-${input.operatingDay}`,
    operatingDay: input.operatingDay,
    wallDayKey: input.recordedAt.toISOString().slice(0, 10),
    recordedAt: input.recordedAt,
    production: PRODUCTS.map((product) => {
      const producedQty = input.producedByProduct[product] ?? 0;
      const designDailyQty = input.designDailyByProduct[product] ?? 0;
      return { product, producedQty, designDailyQty, ratePct: pctOf(producedQty, designDailyQty) };
    }),
    materials: {
      stockoutCount: byDoh.filter((m) => m.doh <= 0).length,
      criticalCount: input.criticalCount,
      medianDoh: medianOf(byDoh.map((m) => m.doh)),
      worst: byDoh.slice(0, 5),
    },
    warehouses: input.warehouses,
    shipments: PRODUCTS.map((product) => {
      const shippedQty = input.shippedByProduct[product] ?? 0;
      const contractDailyQty = input.contractDailyByProduct[product] ?? 0;
      return { product, shippedQty, contractDailyQty, fulfillmentPct: pctOf(shippedQty, contractDailyQty) };
    }),
    policy: input.policy,
    engine: input.engine,
  };
}
