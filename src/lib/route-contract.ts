import type { Product } from "@/lib/db";

export const M20_HBM_ROUTE_KEY = "M20:HBM" as const;
export const M20_HBM_ROUTE_VERSION = "ROUTE_MASTER_M20_HBM_V3" as const;
export const M20_HBM_MODEL_PRODUCT = "M20-HBM4-12H-V2" as const;

export const M21_DRAM_ROUTE_KEY = "M21:DRAM" as const;
export const M21_DRAM_ROUTE_VERSION = "ROUTE_MASTER_M21_DRAM_V1" as const;
export const M21_DRAM_MODEL_PRODUCT = "M21-DDR5-16Gb-V1" as const;

export const M22_NAND_ROUTE_KEY = "M22:NAND" as const;
export const M22_NAND_ROUTE_VERSION = "ROUTE_MASTER_M22_NAND_V1" as const;
export const M22_NAND_MODEL_PRODUCT = "M22-NAND321L-1Tb-TLC-V1" as const;

export type RouteOperationCode =
  | "GENERAL"
  | "TSV_FRONT"
  | "EDGE_TRIM"
  | "BACKGRIND_THINNING"
  | "TSV_BACK"
  | "WAFER_TEST"
  | "DICING"
  | "DIE_SORT_KGD"
  | "BASE_DIE_ATTACH"
  | "DRAM_BOND_12H"
  | "MUF_MOLDING_CURE"
  | "FINAL_TEST"
  | "DIE_ATTACH"
  | "NAND_PACKAGE";

export type RouteMaterialScope = {
  fabId: string;
  product: Product;
  routeKey: string;
  routeVersion: string;
  processCode: string;
  operationCode: RouteOperationCode;
};

export function routeMaterialUsageId(scope: RouteMaterialScope, materialId: string): string {
  return [
    scope.fabId,
    scope.product,
    scope.routeVersion,
    scope.processCode,
    scope.operationCode,
    materialId,
  ].join("__");
}

export const M20_BASE_DIE_ASSUMPTION = Object.freeze({
  materialId: "PKG-LBD-001",
  materialName: "HBM4 Logic Base Die KGD",
  materialType: "DIRECT_COMPONENT",
  sourceType: "EXTERNAL_FOUNDRY_MODELED",
  supplier: "TBD",
  consumptionPoint: "P10.BASE_DIE_ATTACH",
  consumptionQtyPerGrossStack: 1,
  inventoryUom: "KGD_DIE",
  purchaseUom: "TRAY",
  incomingAcceptanceYield: 0.99,
  assumedDiesPerTray: 1_000,
  confidence: "LOW",
  assumptionStatus: "UNVALIDATED_PLANNING_ASSUMPTION",
} as const);

export const PROCESS_PRODUCT_APPLICABILITY = Object.freeze({
  "P08.EDGE_TRIM": { HBM: "CONDITIONAL_BASELINE", DRAM: "OPTIONAL_TBD", NAND: "OPTIONAL_TBD" },
  "P10.DICING": { HBM: "REQUIRED", DRAM: "REQUIRED", NAND: "REQUIRED" },
  "P10.DIE_SORT_KGD": { HBM: "REQUIRED", DRAM: "REQUIRED", NAND: "REQUIRED" },
  "P10.BASE_DIE_ATTACH": { HBM: "REQUIRED", DRAM: "NOT_APPLICABLE", NAND: "NOT_APPLICABLE" },
  "P10.DRAM_BOND_12H": { HBM: "REQUIRED", DRAM: "NOT_APPLICABLE", NAND: "NOT_APPLICABLE" },
} as const);

export function normalizeProcessCode(processCode: string): string {
  return processCode === "P11" ? "P10" : processCode;
}
