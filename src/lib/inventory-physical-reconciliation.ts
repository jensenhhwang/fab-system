import type {
  HandlingUnitDoc,
  InventoryDoc,
  InventoryLotDoc,
  MaterialDoc,
  StorageLocationDoc,
  TransferOrderDoc,
  WorkOrderDoc,
} from "@/lib/db";

export const OPENING_RECONCILIATION_VERSION = "OPENING_RECONCILIATION_V1" as const;
export const RECONCILIATION_TOLERANCE = 1e-6;

export const UNCALIBRATED_ZERO_BASELINE_MATERIALS = new Set([
  "CSM-016",
  "CSM-017",
  "CSM-018",
  "CSM-019",
]);

const OUTSIDE_WAREHOUSE = new Set(["IN_TRANSIT", "RECEIVED", "LINE_SIDE", "CONSUMED"]);
const RESERVED_IN_WAREHOUSE = new Set(["RESERVED", "STAGED"]);

export type ReconciliationBlockCode =
  | "INVALID_QUANTITY"
  | "MULTIPLE_AGGREGATE_WAREHOUSES"
  | "HU_REFERENCE_CONFLICT"
  | "HU_LOCATION_INVALID"
  | "RESERVATION_REFERENCE_INVALID"
  | "HU_EXCEEDS_LOT_PHYSICAL"
  | "LOT_PHYSICAL_EXCEEDS_AGGREGATE"
  | "UNCALIBRATED_NONZERO_PHYSICAL";

export interface ReconciliationBlock {
  code: ReconciliationBlockCode;
  materialId: string;
  referenceId?: string;
  detail: string;
}

export interface RecoveryLotPlan {
  kind: "RECOVER_ORPHAN_HU_LOT";
  lotId: string;
  materialId: string;
  warehouseId: string;
  locationId?: string;
  quantity: number;
  availableQuantity: number;
  sourceHandlingUnitIds: string[];
}

export interface ReconciliationHuPlan {
  kind: "FILL_EXISTING_LOT_HU";
  handlingUnitId: string;
  lotId: string;
  materialId: string;
  warehouseId: string;
  quantity: number;
}

export interface OpeningPositionPlan {
  kind: "OPENING_POSITION";
  lotId: string;
  handlingUnitId: string;
  materialId: string;
  warehouseId: string;
  sourceInventoryIds: string[];
  quantity: number;
}

export interface MaterialPhysicalSummary {
  materialId: string;
  aggregateOnHand: number;
  lotPhysicalBefore: number;
  huPhysicalBefore: number;
  lotPhysicalAfter: number;
  huPhysicalAfter: number;
  status: "MATCHED" | "PLANNED" | "SKIPPED_ZERO_BASELINE" | "SKIPPED_UNCALIBRATED_ZERO_BASELINE" | "BLOCKED";
}

export interface OpeningReconciliationPlan {
  version: typeof OPENING_RECONCILIATION_VERSION;
  recoveryLots: RecoveryLotPlan[];
  fillHandlingUnits: ReconciliationHuPlan[];
  openingPositions: OpeningPositionPlan[];
  requiredHoldWarehouses: string[];
  blocks: ReconciliationBlock[];
  summaries: MaterialPhysicalSummary[];
}

export interface OpeningReconciliationInput {
  materials: MaterialDoc[];
  inventory: InventoryDoc[];
  lots: InventoryLotDoc[];
  handlingUnits: HandlingUnitDoc[];
  locations: StorageLocationDoc[];
  transfers: TransferOrderDoc[];
  workOrders: WorkOrderDoc[];
}

function finiteQuantity(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function isWarehousePhysicalHandlingUnit(unit: HandlingUnitDoc): boolean {
  return unit.status !== "CONSUMED" && !OUTSIDE_WAREHOUSE.has(unit.logisticsStatus ?? "");
}

export function isReservedWarehouseHandlingUnit(unit: HandlingUnitDoc): boolean {
  return RESERVED_IN_WAREHOUSE.has(unit.logisticsStatus ?? "");
}

function reconciliationIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function reconciliationHoldZoneId(warehouseId: string): string {
  return `RECON-HOLD-ZONE__${reconciliationIdPart(warehouseId)}`;
}

export function reconciliationHoldLocationId(warehouseId: string): string {
  return `RECON-HOLD__${reconciliationIdPart(warehouseId)}`;
}

export function buildOpeningReconciliationPlan(input: OpeningReconciliationInput): OpeningReconciliationPlan {
  const activeLots = input.lots.filter((lot) => lot.simulated !== true && lot.qualityStatus !== "CONSUMED");
  const physicalUnits = input.handlingUnits.filter(isWarehousePhysicalHandlingUnit);
  const activeLotById = new Map(activeLots.map((lot) => [lot._id, lot]));
  const locationById = new Map(input.locations.map((location) => [location._id, location]));
  const activeTransferById = new Map(
    input.transfers
      .filter((transfer) => ["PICKING", "STAGED", "IN_TRANSIT", "RECEIVED"].includes(transfer.status))
      .map((transfer) => [transfer._id, transfer]),
  );
  const activeWorkOrderIds = new Set(
    input.workOrders
      .filter((workOrder) => !["DONE"].includes(workOrder.status))
      .map((workOrder) => workOrder._id),
  );
  const blocks: ReconciliationBlock[] = [];

  for (const row of [...input.inventory, ...activeLots, ...physicalUnits]) {
    const quantity = "availableQuantity" in row
      ? row.availableQuantity
      : row.quantity;
    if (!finiteQuantity(quantity)) {
      blocks.push({
        code: "INVALID_QUANTITY",
        materialId: row.materialId,
        referenceId: row._id,
        detail: `유효하지 않은 수량 ${String(quantity)}`,
      });
    }
  }

  for (const unit of physicalUnits) {
    const currentLocationId = unit.currentLocationId ?? unit.locationId;
    const currentWarehouseId = unit.currentFacilityId ?? unit.warehouseId;
    const location = locationById.get(currentLocationId);
    if (!location || location.warehouseId !== currentWarehouseId) {
      blocks.push({
        code: "HU_LOCATION_INVALID",
        materialId: unit.materialId,
        referenceId: unit._id,
        detail: `${currentWarehouseId}/${currentLocationId} 위치 참조가 유효하지 않음`,
      });
    }
    if (isReservedWarehouseHandlingUnit(unit)) {
      const transfer = unit.reservedTransferOrderId
        ? activeTransferById.get(unit.reservedTransferOrderId)
        : undefined;
      const validTransfer = transfer
        && transfer.handlingUnitId === unit._id
        && transfer.materialId === unit.materialId
        && transfer.lotId === unit.inventoryLotId;
      const validWorkOrder = !unit.reservedWorkOrderId || activeWorkOrderIds.has(unit.reservedWorkOrderId);
      if (!validTransfer || !validWorkOrder) {
        blocks.push({
          code: "RESERVATION_REFERENCE_INVALID",
          materialId: unit.materialId,
          referenceId: unit._id,
          detail: "RESERVED/STAGED HU의 활성 Transfer/WorkOrder 참조가 일치하지 않음",
        });
      }
    }
  }

  const orphanGroups = new Map<string, HandlingUnitDoc[]>();
  for (const unit of physicalUnits) {
    if (activeLotById.has(unit.inventoryLotId)) continue;
    const allLot = input.lots.find((lot) => lot._id === unit.inventoryLotId);
    if (allLot?.qualityStatus === "CONSUMED") {
      blocks.push({
        code: "HU_REFERENCE_CONFLICT",
        materialId: unit.materialId,
        referenceId: unit._id,
        detail: `HU가 소비 완료 Lot ${allLot._id}을 참조함`,
      });
      continue;
    }
    const group = orphanGroups.get(unit.inventoryLotId) ?? [];
    group.push(unit);
    orphanGroups.set(unit.inventoryLotId, group);
  }

  const recoveryLots: RecoveryLotPlan[] = [];
  for (const [lotId, units] of orphanGroups) {
    const materialIds = new Set(units.map((unit) => unit.materialId));
    const warehouseIds = new Set(units.map((unit) => unit.currentFacilityId ?? unit.warehouseId));
    if (materialIds.size !== 1 || warehouseIds.size !== 1) {
      blocks.push({
        code: "HU_REFERENCE_CONFLICT",
        materialId: units[0]?.materialId ?? "UNKNOWN",
        referenceId: lotId,
        detail: "동일 누락 Lot을 서로 다른 자재 또는 창고 HU가 참조함",
      });
      continue;
    }
    const quantity = sum(units.map((unit) => unit.quantity));
    const reserved = sum(units.filter(isReservedWarehouseHandlingUnit).map((unit) => unit.quantity));
    recoveryLots.push({
      kind: "RECOVER_ORPHAN_HU_LOT",
      lotId,
      materialId: units[0].materialId,
      warehouseId: units[0].currentFacilityId ?? units[0].warehouseId,
      locationId: units[0].currentLocationId ?? units[0].locationId,
      quantity,
      availableQuantity: quantity - reserved,
      sourceHandlingUnitIds: units.map((unit) => unit._id).sort(),
    });
  }

  const fillHandlingUnits: ReconciliationHuPlan[] = [];
  for (const lot of activeLots) {
    const lotUnits = physicalUnits.filter((unit) => unit.inventoryLotId === lot._id);
    const reservedQuantity = sum(lotUnits.filter(isReservedWarehouseHandlingUnit).map((unit) => unit.quantity));
    const expectedPhysical = lot.availableQuantity + reservedQuantity;
    const huPhysical = sum(lotUnits.map((unit) => unit.quantity));
    if (huPhysical > expectedPhysical + RECONCILIATION_TOLERANCE) {
      blocks.push({
        code: "HU_EXCEEDS_LOT_PHYSICAL",
        materialId: lot.materialId,
        referenceId: lot._id,
        detail: `HU ${huPhysical} > Lot physical ${expectedPhysical}`,
      });
      continue;
    }
    const delta = expectedPhysical - huPhysical;
    if (delta > RECONCILIATION_TOLERANCE) {
      const warehouseId = lot.warehouseId
        ?? input.inventory.find((row) => row.materialId === lot.materialId)?.warehouseId;
      if (!warehouseId) {
        blocks.push({
          code: "HU_REFERENCE_CONFLICT",
          materialId: lot.materialId,
          referenceId: lot._id,
          detail: "Lot의 창고를 결정할 수 없음",
        });
        continue;
      }
      fillHandlingUnits.push({
        kind: "FILL_EXISTING_LOT_HU",
        handlingUnitId: `RECON-HU-FILL__${reconciliationIdPart(lot._id)}`,
        lotId: lot._id,
        materialId: lot.materialId,
        warehouseId,
        quantity: delta,
      });
    }
  }

  const recoveryByMaterial = Map.groupBy(recoveryLots, (lot) => lot.materialId);
  const fillByMaterial = Map.groupBy(fillHandlingUnits, (unit) => unit.materialId);
  const activeLotsByMaterial = Map.groupBy(activeLots, (lot) => lot.materialId);
  const physicalUnitsByMaterial = Map.groupBy(physicalUnits, (unit) => unit.materialId);
  const inventoryByMaterial = Map.groupBy(
    input.inventory.filter((row) => row.status !== "CONSUMED"),
    (row) => row.materialId,
  );
  const openingPositions: OpeningPositionPlan[] = [];
  const summaries: MaterialPhysicalSummary[] = [];

  for (const material of input.materials) {
    const inventoryRows = inventoryByMaterial.get(material._id) ?? [];
    const warehouseIds = new Set(inventoryRows.map((row) => row.warehouseId));
    const aggregateOnHand = sum(inventoryRows.map((row) => row.quantity));
    const materialLots = activeLotsByMaterial.get(material._id) ?? [];
    const materialUnits = physicalUnitsByMaterial.get(material._id) ?? [];
    const materialRecovery = recoveryByMaterial.get(material._id) ?? [];
    const materialFill = fillByMaterial.get(material._id) ?? [];
    const reservedByLot = new Map<string, number>();
    for (const unit of materialUnits.filter(isReservedWarehouseHandlingUnit)) {
      reservedByLot.set(unit.inventoryLotId, (reservedByLot.get(unit.inventoryLotId) ?? 0) + unit.quantity);
    }
    const lotPhysicalBefore = sum(materialLots.map(
      (lot) => lot.availableQuantity + (reservedByLot.get(lot._id) ?? 0),
    ));
    const huPhysicalBefore = sum(materialUnits.map((unit) => unit.quantity));
    const recoveredPhysical = sum(materialRecovery.map((lot) => lot.quantity));
    const filledPhysical = sum(materialFill.map((unit) => unit.quantity));
    const lotPhysicalAfterExisting = lotPhysicalBefore + recoveredPhysical;
    const huPhysicalAfterExisting = huPhysicalBefore + filledPhysical;

    if (warehouseIds.size > 1) {
      blocks.push({
        code: "MULTIPLE_AGGREGATE_WAREHOUSES",
        materialId: material._id,
        detail: `aggregate 창고가 ${[...warehouseIds].join(", ")}로 중복됨`,
      });
    }

    if (UNCALIBRATED_ZERO_BASELINE_MATERIALS.has(material._id)) {
      const isZero = Math.abs(aggregateOnHand) <= RECONCILIATION_TOLERANCE
        && Math.abs(lotPhysicalAfterExisting) <= RECONCILIATION_TOLERANCE
        && Math.abs(huPhysicalAfterExisting) <= RECONCILIATION_TOLERANCE;
      if (!isZero) {
        blocks.push({
          code: "UNCALIBRATED_NONZERO_PHYSICAL",
          materialId: material._id,
          detail: `미보정 자재에 aggregate=${aggregateOnHand}, lot=${lotPhysicalAfterExisting}, hu=${huPhysicalAfterExisting}`,
        });
      }
      summaries.push({
        materialId: material._id,
        aggregateOnHand,
        lotPhysicalBefore,
        huPhysicalBefore,
        lotPhysicalAfter: lotPhysicalAfterExisting,
        huPhysicalAfter: huPhysicalAfterExisting,
        status: isZero ? "SKIPPED_UNCALIBRATED_ZERO_BASELINE" : "BLOCKED",
      });
      continue;
    }

    if (lotPhysicalAfterExisting > aggregateOnHand + RECONCILIATION_TOLERANCE) {
      blocks.push({
        code: "LOT_PHYSICAL_EXCEEDS_AGGREGATE",
        materialId: material._id,
        detail: `Lot physical ${lotPhysicalAfterExisting} > aggregate ${aggregateOnHand}`,
      });
      summaries.push({
        materialId: material._id,
        aggregateOnHand,
        lotPhysicalBefore,
        huPhysicalBefore,
        lotPhysicalAfter: lotPhysicalAfterExisting,
        huPhysicalAfter: huPhysicalAfterExisting,
        status: "BLOCKED",
      });
      continue;
    }

    const openingDelta = aggregateOnHand - lotPhysicalAfterExisting;
    if (openingDelta > RECONCILIATION_TOLERANCE) {
      const warehouseId = inventoryRows[0]?.warehouseId;
      if (!warehouseId) {
        blocks.push({
          code: "HU_REFERENCE_CONFLICT",
          materialId: material._id,
          detail: "양수 보정량의 기준 aggregate 창고가 없음",
        });
      } else {
        openingPositions.push({
          kind: "OPENING_POSITION",
          lotId: `RECON-LOT-OPENING__${reconciliationIdPart(material._id)}`,
          handlingUnitId: `RECON-HU-OPENING__${reconciliationIdPart(material._id)}`,
          materialId: material._id,
          warehouseId,
          sourceInventoryIds: inventoryRows.map((row) => row._id).sort(),
          quantity: openingDelta,
        });
      }
    }
    const lotPhysicalAfter = lotPhysicalAfterExisting + Math.max(0, openingDelta);
    const huPhysicalAfter = huPhysicalAfterExisting + Math.max(0, openingDelta);
    summaries.push({
      materialId: material._id,
      aggregateOnHand,
      lotPhysicalBefore,
      huPhysicalBefore,
      lotPhysicalAfter,
      huPhysicalAfter,
      status: aggregateOnHand <= RECONCILIATION_TOLERANCE
        ? "SKIPPED_ZERO_BASELINE"
        : openingDelta > RECONCILIATION_TOLERANCE || filledPhysical > RECONCILIATION_TOLERANCE || recoveredPhysical > RECONCILIATION_TOLERANCE
          ? "PLANNED"
          : "MATCHED",
    });
  }

  const requiredHoldWarehouses = [...new Set([
    ...fillHandlingUnits.map((unit) => unit.warehouseId),
    ...openingPositions.map((position) => position.warehouseId),
  ])].sort();

  const blockedMaterials = new Set(blocks.map((block) => block.materialId));
  for (const summary of summaries) {
    if (blockedMaterials.has(summary.materialId)) summary.status = "BLOCKED";
  }

  return {
    version: OPENING_RECONCILIATION_VERSION,
    recoveryLots,
    fillHandlingUnits,
    openingPositions,
    requiredHoldWarehouses,
    blocks,
    summaries,
  };
}
