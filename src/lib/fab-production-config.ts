import type { FabId, Product } from "@/lib/db";
import {
  M20_PRODUCTION_SCENARIOS, M20_HBM_OUTPUT_MODEL, FAB_SCENARIO,
  M21_DRAM_OUTPUT_MODEL, M22_NAND_OUTPUT_MODEL, M21_CYCLE_DAYS, M22_CYCLE_DAYS, WAFERS_PER_FOUP,
} from "@/lib/fab-scenario";
import {
  M20_TARGET_OCCUPIED_FOUP, M20_DAILY_LOT_RELEASE,
  M21_TARGET_OCCUPIED_FOUP, M21_DAILY_LOT_RELEASE,
  M22_TARGET_OCCUPIED_FOUP, M22_DAILY_LOT_RELEASE,
} from "@/lib/foup-wip-model";

// 제품별 생산 config — engine.ts·lot-route.ts의 M20/HBM 하드코딩을 대체하는 단일 진실원.
// HBM은 기존 M20 상수를 그대로 반환해 M20 런타임을 바이트 단위로 보존한다. DRAM/NAND는
// docs/foup-wip-master.md에서 연동한 승인 baseline이다.
export type FabProductionConfig = {
  fabId: FabId;
  product: Product;
  cycleTimeDays: number;
  waferStartsPerMonth: number;
  wafersPerFoup: number;
  dailyLotRelease: number;
  targetOccupiedFoup: number;
  advanceBatchMax: number;
  outputModel: {
    knownGoodDiesPerWafer: number;
    assemblyYield: number;
    capacityGbPerUnit: number;
    unit: "STACK" | "CHIP" | "DIE";
    // HBM은 12-die 스택 팬아웃이 있어 별도 계산. dieToUnit은 "good die 1개가 완제품 몇 단위인가".
    dieToUnit: number;
  };
};

function wspmFor(product: Product): number {
  const fab = FAB_SCENARIO.find((f) => f.product === product);
  return fab ? Math.round(fab.nominalWspm * fab.utilization) : 0;
}

export const FAB_PRODUCTION_REGISTRY: Record<Product, FabProductionConfig> = {
  HBM: {
    fabId: "M20", product: "HBM",
    cycleTimeDays: M20_PRODUCTION_SCENARIOS.NORMAL.cycleTimeDays,
    waferStartsPerMonth: M20_PRODUCTION_SCENARIOS.NORMAL.waferStartsPerMonth,
    wafersPerFoup: WAFERS_PER_FOUP,
    dailyLotRelease: M20_DAILY_LOT_RELEASE,
    targetOccupiedFoup: M20_TARGET_OCCUPIED_FOUP,
    advanceBatchMax: M20_TARGET_OCCUPIED_FOUP + 2_000,
    outputModel: {
      knownGoodDiesPerWafer: M20_HBM_OUTPUT_MODEL.knownGoodDiesPerWafer,
      assemblyYield: M20_HBM_OUTPUT_MODEL.assemblyYield,
      capacityGbPerUnit: M20_HBM_OUTPUT_MODEL.capacityGbPerStack,
      unit: "STACK",
      dieToUnit: 1 / M20_HBM_OUTPUT_MODEL.stackDieCount, // 12 good die → 1 stack
    },
  },
  DRAM: {
    fabId: "M21", product: "DRAM", cycleTimeDays: M21_CYCLE_DAYS, waferStartsPerMonth: wspmFor("DRAM"),
    wafersPerFoup: WAFERS_PER_FOUP, dailyLotRelease: M21_DAILY_LOT_RELEASE,
    targetOccupiedFoup: M21_TARGET_OCCUPIED_FOUP, advanceBatchMax: M21_TARGET_OCCUPIED_FOUP + 2_000,
    outputModel: {
      knownGoodDiesPerWafer: M21_DRAM_OUTPUT_MODEL.knownGoodDiesPerWafer,
      assemblyYield: M21_DRAM_OUTPUT_MODEL.assemblyYield,
      capacityGbPerUnit: M21_DRAM_OUTPUT_MODEL.capacityGbPerUnit, unit: "CHIP", dieToUnit: 1,
    },
  },
  NAND: {
    fabId: "M22", product: "NAND", cycleTimeDays: M22_CYCLE_DAYS, waferStartsPerMonth: wspmFor("NAND"),
    wafersPerFoup: WAFERS_PER_FOUP, dailyLotRelease: M22_DAILY_LOT_RELEASE,
    targetOccupiedFoup: M22_TARGET_OCCUPIED_FOUP, advanceBatchMax: M22_TARGET_OCCUPIED_FOUP + 2_000,
    outputModel: {
      knownGoodDiesPerWafer: M22_NAND_OUTPUT_MODEL.knownGoodDiesPerWafer,
      assemblyYield: M22_NAND_OUTPUT_MODEL.assemblyYield,
      capacityGbPerUnit: M22_NAND_OUTPUT_MODEL.capacityGbPerUnit, unit: "DIE", dieToUnit: 1,
    },
  },
};

export const ACTIVE_PRODUCTION_PRODUCTS: readonly { fabId: FabId; product: Product }[] = [
  { fabId: "M20", product: "HBM" },
  { fabId: "M21", product: "DRAM" },
  { fabId: "M22", product: "NAND" },
];

export function getProductionConfig(fabId: FabId, product: Product): FabProductionConfig | null {
  const cfg = FAB_PRODUCTION_REGISTRY[product];
  return cfg && cfg.fabId === fabId ? cfg : null;
}
