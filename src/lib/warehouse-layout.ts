import { getGeneralStorageRationale, getStorageRule, getSupplyProfile, type SupplyMode } from "@/lib/warehouse-storage-rules";

export type VirtualLocationStatus = "OCCUPIED" | "AVAILABLE" | "HOLD" | "QUARANTINE";

export type VirtualStorageLocation = {
  id: string;
  code: string;
  zone: string;
  aisle: number;
  bay: number;
  level: number;
  position: [number, number, number];
  status: VirtualLocationStatus;
  materialId?: string;
  materialCode?: string;
  materialName?: string;
  category?: string;
  quantity?: number;
  unit?: string;
  doh?: number | null;
  hazard?: string;
  rationale?: string;
  controls?: string[];
  supplyMode?: SupplyMode;
  supplyLabel?: string;
  supplyFlow?: string;
  targetFacility?: string;
  relocationRequired?: boolean;
};

export type WarehouseInventoryInput = {
  materialId: string;
  quantity: number;
  dailyUsage: number;
  doh: number | null;
  material: { code: string; name: string; category: string; unit: string };
  status?: "AVAILABLE" | "HOLD" | "QUARANTINE";
};

const ZONES: Record<string, string[]> = {
  AS_RS: ["자동보관 A", "자동보관 B", "입출고 대기"],
  FLAT: ["팔레트 랙", "평치 적재", "항온 구역"],
  HAZMAT: ["특수가스", "산성 케미컬", "산화제"],
  MRO: ["정상 부품", "고가 공구", "검사·격리"],
  BULK_GAS: ["벌크가스 탱크팜"],
  BULK_CHEM: ["벌크 케미컬 탱크팜"],
  PRECURSOR: ["전구체 캐비닛", "공급 대기"],
  ON_SITE: ["UPW 생산·순환"],
};

export function buildVirtualWarehouseLayout(
  warehouseCode: string,
  warehouseType: string,
  inventory: WarehouseInventoryInput[],
): VirtualStorageLocation[] {
  const inventorySlots = Math.max(inventory.length, 1);
  const aisles = warehouseType === "HAZMAT" ? 6
    : warehouseType === "BULK_GAS" || warehouseType === "BULK_CHEM" ? inventorySlots
    : warehouseType === "ON_SITE" ? 1 : warehouseType === "PRECURSOR" ? 3 : 4;
  const bays = warehouseType === "HAZMAT" ? 4
    : warehouseType === "BULK_GAS" || warehouseType === "BULK_CHEM" || warehouseType === "ON_SITE" ? 1
    : warehouseType === "PRECURSOR" ? 2 : 6;
  const levels = warehouseType === "AS_RS" ? 5 : warehouseType === "HAZMAT" ? 3 : warehouseType === "PRECURSOR" ? 2 : warehouseType === "BULK_GAS" || warehouseType === "BULK_CHEM" || warehouseType === "ON_SITE" ? 1 : 4;
  const zones = ZONES[warehouseType] ?? ["일반 보관"];
  const slots: VirtualStorageLocation[] = [];
  let index = 0;
  const hazmatZoneOrder = ["독성·부식성 가스실", "자연발화성 가스실", "산화성·불활성 가스실", "산성 케미컬실", "알칼리 케미컬실", "산화제실"];
  const hazmatQueues = new Map(hazmatZoneOrder.map((name) => [name, inventory.filter((item) => getStorageRule(item.material.code)?.zoneName === name)]));

  const positionFor = (aisle: number, bay: number, level: number): [number, number, number] => {
    if (warehouseType === "MRO") {
      return [(aisle - 2.5) * 2.35, level * 0.58, (bay - 3.5) * 1.05];
    }
    if (warehouseType === "FLAT") {
      return [(aisle - 2.5) * 4.4, level * 0.88, (bay - 3.5) * 1.7];
    }
    if (warehouseType === "HAZMAT") {
      return [(aisle - 3.5) * 4.25, level * 0.9, (bay - 2.5) * 1.8];
    }
    if (warehouseType === "BULK_GAS" || warehouseType === "BULK_CHEM") {
      return [(aisle - (aisles + 1) / 2) * 3.25, 0, 0];
    }
    if (warehouseType === "PRECURSOR") {
      return [(aisle - 2) * 3.1, level * 1.05, (bay - 1.5) * 2.0];
    }
    if (warehouseType === "ON_SITE") return [0, 0, 0];
    return [(aisle - 2.5) * 3.2, level * 0.85, (bay - 3.5) * 1.45];
  };

  for (let aisle = 1; aisle <= aisles; aisle++) {
    for (let bay = 1; bay <= bays; bay++) {
      for (let level = 1; level <= levels; level++) {
        const hazmatZone = hazmatZoneOrder[aisle - 1];
        const item = warehouseType === "HAZMAT"
          ? hazmatQueues.get(hazmatZone)?.shift()
          : index < inventory.length ? inventory[index] : undefined;
        const restrictedStatus = item?.status === "HOLD" ? "HOLD" : item?.status === "QUARANTINE" ? "QUARANTINE" : null;
        const zone = warehouseType === "HAZMAT" ? hazmatZone : zones[Math.min(zones.length - 1, Math.floor(((aisle - 1) / aisles) * zones.length))];
        const storageRule = item ? getStorageRule(item.material.code) : null;
        const supplyProfile = item ? getSupplyProfile(item.material.code) : null;
        const code = `${warehouseCode.replace("WH-", "")}-${String(aisle).padStart(2, "0")}-${String(bay).padStart(2, "0")}-${String(level).padStart(2, "0")}`;
        slots.push({
          id: `${warehouseCode}-${aisle}-${bay}-${level}`,
          code,
          zone,
          aisle,
          bay,
          level,
          position: positionFor(aisle, bay, level),
          status: item ? (restrictedStatus ?? "OCCUPIED") : "AVAILABLE",
          materialId: item?.materialId,
          materialCode: item?.material.code,
          materialName: item?.material.name,
          category: item?.material.category,
          quantity: item?.quantity,
          unit: item?.material.unit,
          doh: item?.doh,
          hazard: storageRule?.hazard,
          rationale: storageRule?.rationale ?? (item ? getGeneralStorageRationale(warehouseType) : undefined),
          controls: storageRule?.controls,
          supplyMode: supplyProfile?.mode,
          supplyLabel: supplyProfile?.label,
          supplyFlow: supplyProfile?.flow,
          targetFacility: supplyProfile?.targetFacility,
          relocationRequired: warehouseType === "HAZMAT" && (supplyProfile?.mode === "BULK_GAS" || supplyProfile?.mode === "BULK_CHEMICAL"),
        });
        index++;
      }
    }
  }
  return slots;
}
