export const FAB_IDS = ["M20", "M21", "M22"] as const;
export type FabId = (typeof FAB_IDS)[number];
export type FabProduct = "HBM" | "DRAM" | "NAND";

export type FacilityRole =
  | "CENTRAL_WMS"
  | "FAB"
  | "FAB_LOCAL"
  | "PRS"
  | "LINE_SIDE"
  | "PROCESS";

export const PRODUCT_TO_FAB: Record<FabProduct, FabId> = {
  HBM: "M20",
  DRAM: "M21",
  NAND: "M22",
};

export function fabForProduct(product: FabProduct): FabId {
  return PRODUCT_TO_FAB[product];
}
