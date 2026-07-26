import { createHash } from "node:crypto";
import type {
  HandlingUnitDoc,
  InventoryLotDoc,
  InventoryReconciliationBatchDoc,
  MaterialDoc,
  StorageLocationDoc,
} from "@/lib/db";

export const INVENTORY_VERIFICATION_VERSION = "INVENTORY_VERIFICATION_V1" as const;
export const VERIFICATION_READ_ROLES = ["ADMIN", "MATERIALS", "LOGISTICS"] as const;
export const VERIFICATION_OBSERVE_ROLES = ["LOGISTICS"] as const;

const UNCALIBRATED = new Set(["CSM-016", "CSM-017", "CSM-018", "CSM-019"]);
const DECIMAL_PATTERN = /^(0|[1-9]\d*)(\.\d+)?$/;

export class InventoryVerificationError extends Error {
  constructor(
    public readonly code:
      | "INVALID_OBSERVATION"
      | "UOM_MISMATCH"
      | "ACTUAL_LOCATION_INVALID"
      | "RECONCILIATION_HOLD_LOCATION_FORBIDDEN"
      | "IDEMPOTENCY_CONFLICT"
      | "CASE_NOT_FOUND"
      | "CASE_NOT_AWAITING_OBSERVATION"
      | "CASE_VERSION_CONFLICT"
      | "CASE_SOURCE_DRIFT",
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "InventoryVerificationError";
  }
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function isUncalibratedVerificationMaterial(materialId: string): boolean {
  return UNCALIBRATED.has(materialId);
}

export function inventoryVerificationCaseId(batchId: string, handlingUnitId: string): string {
  return `IVC-${hash([batchId, handlingUnitId]).slice(0, 32)}`;
}

export function verificationSourceSnapshotHash(input: {
  batch: InventoryReconciliationBatchDoc;
  material: MaterialDoc;
  lot: InventoryLotDoc;
  handlingUnit: HandlingUnitDoc;
  holdLocation: StorageLocationDoc;
}): string {
  return hash({
    version: INVENTORY_VERIFICATION_VERSION,
    batch: {
      _id: input.batch._id,
      status: input.batch.status,
      fingerprint: input.batch.fingerprint,
    },
    material: {
      _id: input.material._id,
      code: input.material.code,
      name: input.material.name,
      unit: input.material.unit,
    },
    lot: {
      _id: input.lot._id,
      materialId: input.lot.materialId,
      quantity: input.lot.quantity,
      availableQuantity: input.lot.availableQuantity,
      qualityStatus: input.lot.qualityStatus,
      warehouseId: input.lot.warehouseId,
      slotId: input.lot.slotId,
      updatedAt: input.lot.updatedAt,
      reconciliation: input.lot.reconciliation,
    },
    handlingUnit: {
      _id: input.handlingUnit._id,
      inventoryLotId: input.handlingUnit.inventoryLotId,
      materialId: input.handlingUnit.materialId,
      warehouseId: input.handlingUnit.warehouseId,
      locationId: input.handlingUnit.locationId,
      currentFacilityId: input.handlingUnit.currentFacilityId,
      currentLocationId: input.handlingUnit.currentLocationId,
      containerType: input.handlingUnit.containerType,
      quantity: input.handlingUnit.quantity,
      status: input.handlingUnit.status,
      logisticsStatus: input.handlingUnit.logisticsStatus,
      version: input.handlingUnit.version,
      updatedAt: input.handlingUnit.updatedAt,
      reconciliation: input.handlingUnit.reconciliation,
    },
    holdLocation: {
      _id: input.holdLocation._id,
      warehouseId: input.holdLocation.warehouseId,
      status: input.holdLocation.status,
      operationalPurpose: input.holdLocation.operationalPurpose,
    },
  });
}

export interface ParsedInventoryObservation {
  requestId: string;
  expectedVersion: number;
  observedQuantity: string;
  uom: string;
  actualLocationId: string;
  evidenceReference: string;
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new InventoryVerificationError("INVALID_OBSERVATION", `${field}는 문자열이어야 합니다.`, 400);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new InventoryVerificationError("INVALID_OBSERVATION", `${field} 길이가 올바르지 않습니다.`, 400);
  }
  return normalized;
}

export function normalizeObservedQuantity(value: unknown): string {
  const text = requiredText(value, "observedQuantity", 64);
  if (!DECIMAL_PATTERN.test(text)) {
    throw new InventoryVerificationError(
      "INVALID_OBSERVATION",
      "관측수량은 0 이상의 평문 십진 문자열이어야 합니다.",
      400,
    );
  }
  if (!text.includes(".")) return text;
  const [integer, fraction] = text.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
}

export function parseInventoryObservation(value: unknown): ParsedInventoryObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InventoryVerificationError("INVALID_OBSERVATION", "요청 본문이 올바르지 않습니다.", 400);
  }
  const body = value as Record<string, unknown>;
  if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
    throw new InventoryVerificationError("INVALID_OBSERVATION", "expectedVersion은 1 이상의 정수여야 합니다.", 400);
  }
  return {
    requestId: requiredText(body.requestId, "requestId", 120),
    expectedVersion: Number(body.expectedVersion),
    observedQuantity: normalizeObservedQuantity(body.observedQuantity),
    uom: requiredText(body.uom, "uom", 40),
    actualLocationId: requiredText(body.actualLocationId, "actualLocationId", 160),
    evidenceReference: requiredText(body.evidenceReference, "evidenceReference", 500),
  };
}

export function inventoryObservationRequestHash(input: {
  caseId: string;
  actorId: string;
  observation: ParsedInventoryObservation;
}): string {
  return hash({
    version: INVENTORY_VERIFICATION_VERSION,
    caseId: input.caseId,
    actorId: input.actorId,
    ...input.observation,
  });
}
