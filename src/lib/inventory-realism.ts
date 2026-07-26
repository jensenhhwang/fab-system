import type { SupplyMode } from "@/lib/db";

export const OPERATIONAL_INVENTORY_BASELINE_VERSION = "OPERATIONAL_REALISM_V1" as const;

export const MODELED_WAREHOUSE_CAPACITY_BASELINE: Readonly<Record<string, number>> = {
  "MWH-01": 3_500,
  "PRS-01": 800,
};

export interface OperationalInventoryProfile {
  inventoryUnit: string;
  purchaseUnit?: string;
  purchaseToInventoryFactor?: number;
  inventoryToStorageFactor?: number;
  unitBasis: "UNCHANGED" | "MODELED_PHYSICAL_BASE";
}

/**
 * 기존 legacy 수량은 실측치가 아니라 LOW 신뢰도 계획량이므로 숫자를 임의로
 * 증폭하지 않고 물리 기준단위로 재해석한다. 구매·보관 환산은 별도 필드로 둔다.
 *
 * - 50 L / 200 bar 산업용 가스 실린더: 약 10 Nm³
 * - 일반 전구체 캐니스터: 계획 기준 10 L
 * - TEOS drum: 계획 기준 200 L
 */
export function operationalInventoryProfile(input: {
  materialCode: string;
  currentUnit: string;
  supplyMode: SupplyMode;
}): OperationalInventoryProfile {
  if (input.materialCode === "PKG-LBD-001") {
    return {
      inventoryUnit: "KGD_DIE",
      purchaseUnit: "TRAY",
      purchaseToInventoryFactor: 1_000,
      // 1,000 die/tray × 50 tray/pallet 계획 기준. 실측 포장 마스터로 교체 필요.
      inventoryToStorageFactor: 1 / 50_000,
      unitBasis: "MODELED_PHYSICAL_BASE",
    };
  }
  if (input.supplyMode === "BULK_GAS") {
    return {
      inventoryUnit: "Nm³",
      purchaseUnit: "BULK_DELIVERY",
      inventoryToStorageFactor: 0,
      unitBasis: "MODELED_PHYSICAL_BASE",
    };
  }
  if (input.supplyMode === "SPECIALTY_CYLINDER") {
    return {
      inventoryUnit: "Nm³",
      purchaseUnit: "CYLINDER",
      purchaseToInventoryFactor: 10,
      inventoryToStorageFactor: 0.1,
      unitBasis: "MODELED_PHYSICAL_BASE",
    };
  }
  if (input.supplyMode === "BULK_CHEMICAL") {
    return {
      inventoryUnit: "L",
      purchaseUnit: "BULK_DELIVERY",
      inventoryToStorageFactor: 0,
      unitBasis: "MODELED_PHYSICAL_BASE",
    };
  }
  if (input.supplyMode === "PRECURSOR_CANISTER") {
    const packageLiters = input.materialCode === "GAS-014" ? 200 : 10;
    return {
      inventoryUnit: "L",
      purchaseUnit: input.materialCode === "GAS-014" ? "DRUM" : "CANISTER",
      purchaseToInventoryFactor: packageLiters,
      inventoryToStorageFactor: 1 / packageLiters,
      unitBasis: "MODELED_PHYSICAL_BASE",
    };
  }
  if (input.supplyMode === "ON_SITE") {
    return {
      inventoryUnit: input.currentUnit,
      inventoryToStorageFactor: 0,
      unitBasis: "UNCHANGED",
    };
  }
  return {
    inventoryUnit: input.currentUnit,
    unitBasis: "UNCHANGED",
  };
}

export function calculateOperationalOpeningTarget(input: {
  currentQuantity: number;
  safetyStock: number;
  dailyUsage: number;
  ropDays: number;
  leadTimeDays: number;
  supplyMode: SupplyMode;
}): {
  protectedDays: number;
  targetQuantity: number;
  delta: number;
  projectedDoh: number | null;
} {
  if (input.supplyMode === "ON_SITE" || input.dailyUsage <= 0 || input.ropDays <= 0) {
    return {
      protectedDays: 0,
      targetQuantity: Math.max(0, input.currentQuantity),
      delta: 0,
      projectedDoh: null,
    };
  }
  const protectedDays = Math.max(input.ropDays, input.leadTimeDays);
  const policyTarget = Math.ceil(Math.max(input.safetyStock, input.dailyUsage * protectedDays));
  const targetQuantity = Math.ceil(Math.max(0, input.currentQuantity, policyTarget));
  return {
    protectedDays,
    targetQuantity,
    delta: targetQuantity - input.currentQuantity,
    projectedDoh: targetQuantity / input.dailyUsage,
  };
}

export function projectedStorageOccupancy(input: {
  quantity: number;
  inventoryToStorageFactor?: number;
  fallbackFactor: number;
}): number {
  const factor = input.inventoryToStorageFactor ?? input.fallbackFactor;
  return Math.max(0, input.quantity) * Math.max(0, factor);
}
