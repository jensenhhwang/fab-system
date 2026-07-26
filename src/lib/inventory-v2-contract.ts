export const INVENTORY_V2_SCHEMA_VERSION = 2 as const;

export const INVENTORY_QUALITY_STATUSES = [
  "INSPECTION_PENDING",
  "UNRESTRICTED",
  "HOLD",
  "QUARANTINE",
  "REJECTED",
] as const;

export const INVENTORY_LOGISTICS_STATUSES = [
  "STORED",
  "PICKING",
  "STAGED",
  "IN_TRANSIT",
  "PRS",
  "LINE_SIDE",
] as const;

export const INVENTORY_COMMITMENT_STATUSES = [
  "FREE",
  "RESERVED",
  "ALLOCATED",
] as const;

export const INVENTORY_MOVEMENT_TYPES = [
  "OPENING_BALANCE",
  "RECEIPT",
  "PUTAWAY",
  "QUALITY_CHANGE",
  "RESERVE",
  "RELEASE_RESERVATION",
  "ALLOCATE",
  "DEALLOCATE",
  "PICK",
  "STAGE",
  "TRANSFER",
  "LINE_SIDE_DELIVERY",
  "RETURN_TO_STOCK",
  "CONSUME",
  "DISPOSE",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "REVERSAL",
] as const;

export type InventoryQualityStatusV2 = typeof INVENTORY_QUALITY_STATUSES[number];
export type InventoryLogisticsStatusV2 = typeof INVENTORY_LOGISTICS_STATUSES[number];
export type InventoryCommitmentStatusV2 = typeof INVENTORY_COMMITMENT_STATUSES[number];
export type InventoryMovementTypeV2 = typeof INVENTORY_MOVEMENT_TYPES[number];
export type InventoryRoundingModeV2 = "HALF_UP" | "DOWN" | "UP";

/**
 * Balance의 식별 차원이다. 예약은 물리 위치가 아니라 commitmentStatus만
 * 바꾸므로 예약 전후의 물리 현재고 합계는 동일해야 한다.
 */
export interface InventoryDimensionV2 {
  materialId: string;
  siteId: string;
  facilityId: string;
  warehouseId?: string | null;
  zoneId?: string | null;
  locationId: string;
  lotId?: string | null;
  handlingUnitId?: string | null;
  qualityStatus: InventoryQualityStatusV2;
  logisticsStatus: InventoryLogisticsStatusV2;
  commitmentStatus: InventoryCommitmentStatusV2;
}

export interface InventoryMovementLineV2 {
  lineNo: number;
  sourceQuantity: string;
  sourceUom: string;
  quantityMinor: number;
  baseUom: string;
  uomScale: number;
  uomRuleId: string;
  conversionNumerator: number;
  conversionDenominator: number;
  from?: InventoryDimensionV2 | null;
  to?: InventoryDimensionV2 | null;
}

export interface InventoryMovementV2Doc {
  _id: string;
  schemaVersion: typeof INVENTORY_V2_SCHEMA_VERSION;
  requestId: string;
  requestHash: string;
  hashVersion: 1;
  type: InventoryMovementTypeV2;
  lines: InventoryMovementLineV2[];
  reasonCode: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  reversalOfMovementId?: string | null;
  actorId: string;
  occurredAt: Date;
  recordedAt: Date;
  // ERP 회계재고는 범위 밖이지만 향후 연동을 위한 키는 보존한다.
  companyCode?: string | null;
  ownerPartyId?: string | null;
  accountingPostingDate?: string | null;
}

export interface InventoryBalanceV2Doc extends InventoryDimensionV2 {
  _id: string;
  schemaVersion: typeof INVENTORY_V2_SCHEMA_VERSION;
  quantityMinor: number;
  baseUom: string;
  uomScale: number;
  version: number;
  lastMovementId: string;
  updatedAt: Date;
}

export interface UomConversionV2 {
  sourceUom: string;
  numerator: number;
  denominator: number;
  validFrom?: Date | null;
  validTo?: Date | null;
}

export interface MaterialUomRuleV2Doc {
  _id: string;
  schemaVersion: typeof INVENTORY_V2_SCHEMA_VERSION;
  materialId: string;
  baseUom: string;
  quantityScale: number;
  roundingMode: InventoryRoundingModeV2;
  conversions: UomConversionV2[];
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  approvedBy: string;
  approvedAt: Date;
}

export interface MaterialUomLockV2Doc {
  _id: string;
  schemaVersion: typeof INVENTORY_V2_SCHEMA_VERSION;
  materialId: string;
  baseUom: string;
  quantityScale: number;
  firstMovementId: string;
  lockedAt: Date;
}

export interface InventoryMetricsV2 {
  physicalOnHandMinor: number;
  unrestrictedOnHandMinor: number;
  committedMinor: number;
  availableOnHandMinor: number;
  confirmedInboundMinor: number;
  atpMinor: number;
}

const QUALITY_SET = new Set<string>(INVENTORY_QUALITY_STATUSES);
const LOGISTICS_SET = new Set<string>(INVENTORY_LOGISTICS_STATUSES);
const COMMITMENT_SET = new Set<string>(INVENTORY_COMMITMENT_STATUSES);
const MOVEMENT_SET = new Set<string>(INVENTORY_MOVEMENT_TYPES);

const INBOUND_TYPES = new Set<InventoryMovementTypeV2>([
  "OPENING_BALANCE",
  "RECEIPT",
  "ADJUSTMENT_IN",
]);

const OUTBOUND_TYPES = new Set<InventoryMovementTypeV2>([
  "CONSUME",
  "DISPOSE",
  "ADJUSTMENT_OUT",
]);

const DIMENSION_FIELDS: readonly (keyof InventoryDimensionV2)[] = [
  "materialId",
  "siteId",
  "facilityId",
  "warehouseId",
  "zoneId",
  "locationId",
  "lotId",
  "handlingUnitId",
  "qualityStatus",
  "logisticsStatus",
  "commitmentStatus",
];

function nonEmpty(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafePositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function dimensionErrors(dimension: InventoryDimensionV2, label: string): string[] {
  const errors: string[] = [];
  for (const field of ["materialId", "siteId", "facilityId", "locationId"] as const) {
    if (!nonEmpty(dimension[field])) errors.push(`${label}.${field} is required`);
  }
  if (!QUALITY_SET.has(dimension.qualityStatus)) errors.push(`${label}.qualityStatus is invalid`);
  if (!LOGISTICS_SET.has(dimension.logisticsStatus)) errors.push(`${label}.logisticsStatus is invalid`);
  if (!COMMITMENT_SET.has(dimension.commitmentStatus)) errors.push(`${label}.commitmentStatus is invalid`);
  if (dimension.qualityStatus !== "UNRESTRICTED" && dimension.commitmentStatus !== "FREE") {
    errors.push(`${label}: blocked quality stock cannot be reserved or allocated`);
  }
  return errors;
}

function changedDimensionFields(
  from: InventoryDimensionV2,
  to: InventoryDimensionV2,
): (keyof InventoryDimensionV2)[] {
  return DIMENSION_FIELDS.filter((field) => (from[field] ?? null) !== (to[field] ?? null));
}

function validateTransition(
  type: InventoryMovementTypeV2,
  from: InventoryDimensionV2,
  to: InventoryDimensionV2,
  label: string,
): string[] {
  const changed = changedDimensionFields(from, to);
  const errors: string[] = [];
  if (from.materialId !== to.materialId) errors.push(`${label}: materialId cannot change`);
  if (!changed.length) errors.push(`${label}: from and to balances must differ`);

  const only = (allowed: readonly (keyof InventoryDimensionV2)[]) => (
    changed.every((field) => allowed.includes(field))
  );
  if (type === "QUALITY_CHANGE" && !only(["qualityStatus"])) {
    errors.push(`${label}: QUALITY_CHANGE may only change qualityStatus`);
  }
  if (
    ["RESERVE", "RELEASE_RESERVATION", "ALLOCATE", "DEALLOCATE"].includes(type)
    && !only(["commitmentStatus"])
  ) {
    errors.push(`${label}: ${type} may only change commitmentStatus`);
  }
  return errors;
}

/**
 * Posting 전에 호출하는 런타임 계약 검증이다. 빈 배열이면 유효하다.
 */
export function validateInventoryMovementV2(movement: InventoryMovementV2Doc): string[] {
  const errors: string[] = [];
  if (movement.schemaVersion !== INVENTORY_V2_SCHEMA_VERSION) errors.push("schemaVersion must be 2");
  if (!nonEmpty(movement._id)) errors.push("_id is required");
  if (!nonEmpty(movement.requestId)) errors.push("requestId is required");
  if (!/^[a-f0-9]{64}$/.test(movement.requestHash)) errors.push("requestHash must be a SHA-256 hex digest");
  if (movement.hashVersion !== 1) errors.push("hashVersion must be 1");
  if (!MOVEMENT_SET.has(movement.type)) errors.push("type is invalid");
  if (!movement.lines.length) errors.push("at least one movement line is required");
  if (!nonEmpty(movement.reasonCode)) errors.push("reasonCode is required");
  if (!nonEmpty(movement.sourceDocumentType) || !nonEmpty(movement.sourceDocumentId)) {
    errors.push("source document type and id are required");
  }
  if (!nonEmpty(movement.actorId)) errors.push("actorId is required");
  if (movement.type === "REVERSAL" && !nonEmpty(movement.reversalOfMovementId)) {
    errors.push("REVERSAL requires reversalOfMovementId");
  }

  const lineNumbers = new Set<number>();
  for (const line of movement.lines) {
    const label = `lines[${line.lineNo}]`;
    if (!Number.isSafeInteger(line.lineNo) || line.lineNo < 1) errors.push(`${label}.lineNo must be a positive integer`);
    if (lineNumbers.has(line.lineNo)) errors.push(`${label}.lineNo is duplicated`);
    lineNumbers.add(line.lineNo);
    if (!isSafePositiveInteger(line.quantityMinor)) errors.push(`${label}.quantityMinor must be a safe positive integer`);
    if (!nonEmpty(line.sourceQuantity)) errors.push(`${label}.sourceQuantity is required`);
    if (!nonEmpty(line.sourceUom)) errors.push(`${label}.sourceUom is required`);
    if (!nonEmpty(line.baseUom)) errors.push(`${label}.baseUom is required`);
    if (!nonEmpty(line.uomRuleId)) errors.push(`${label}.uomRuleId is required`);
    if (!isSafePositiveInteger(line.conversionNumerator)) errors.push(`${label}.conversionNumerator must be a safe positive integer`);
    if (!isSafePositiveInteger(line.conversionDenominator)) errors.push(`${label}.conversionDenominator must be a safe positive integer`);
    if (!Number.isSafeInteger(line.uomScale) || line.uomScale < 0 || line.uomScale > 6) {
      errors.push(`${label}.uomScale must be an integer between 0 and 6`);
    }
    if (!line.from && !line.to) errors.push(`${label} requires from or to`);
    if (line.from) errors.push(...dimensionErrors(line.from, `${label}.from`));
    if (line.to) errors.push(...dimensionErrors(line.to, `${label}.to`));

    if (movement.type !== "REVERSAL") {
      if (INBOUND_TYPES.has(movement.type) && (line.from || !line.to)) {
        errors.push(`${label}: ${movement.type} requires only a to balance`);
      } else if (OUTBOUND_TYPES.has(movement.type) && (!line.from || line.to)) {
        errors.push(`${label}: ${movement.type} requires only a from balance`);
      } else if (!INBOUND_TYPES.has(movement.type) && !OUTBOUND_TYPES.has(movement.type)) {
        if (!line.from || !line.to) errors.push(`${label}: ${movement.type} requires from and to balances`);
      }
    }
    if (line.from && line.to) errors.push(...validateTransition(movement.type, line.from, line.to, label));
  }
  return errors;
}

export function inventoryBalanceKey(dimension: InventoryDimensionV2): string {
  return JSON.stringify(DIMENSION_FIELDS.map((field) => dimension[field] ?? null));
}

export function movementPhysicalDeltaMinor(movement: InventoryMovementV2Doc): number {
  return movement.lines.reduce((total, line) => (
    total + (line.to ? line.quantityMinor : 0) - (line.from ? line.quantityMinor : 0)
  ), 0);
}

export function calculateInventoryMetricsV2(
  balances: readonly Pick<InventoryBalanceV2Doc, "quantityMinor" | "qualityStatus" | "commitmentStatus">[],
  confirmedInboundMinor = 0,
): InventoryMetricsV2 {
  if (!Number.isSafeInteger(confirmedInboundMinor) || confirmedInboundMinor < 0) {
    throw new Error("confirmedInboundMinor must be a safe non-negative integer");
  }
  let physicalOnHandMinor = 0;
  let unrestrictedOnHandMinor = 0;
  let committedMinor = 0;
  for (const balance of balances) {
    if (!Number.isSafeInteger(balance.quantityMinor) || balance.quantityMinor < 0) {
      throw new Error("balance quantityMinor must be a safe non-negative integer");
    }
    physicalOnHandMinor += balance.quantityMinor;
    if (balance.qualityStatus === "UNRESTRICTED") {
      unrestrictedOnHandMinor += balance.quantityMinor;
      if (balance.commitmentStatus !== "FREE") committedMinor += balance.quantityMinor;
    }
  }
  const availableOnHandMinor = unrestrictedOnHandMinor - committedMinor;
  return {
    physicalOnHandMinor,
    unrestrictedOnHandMinor,
    committedMinor,
    availableOnHandMinor,
    confirmedInboundMinor,
    atpMinor: Math.max(0, availableOnHandMinor + confirmedInboundMinor),
  };
}

function decimalFraction(value: string): { numerator: bigint; denominator: bigint } {
  const normalized = value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) throw new Error("quantity must be a non-negative plain decimal string");
  const fraction = match[2] ?? "";
  return {
    numerator: BigInt(`${match[1]}${fraction}`),
    denominator: BigInt(10) ** BigInt(fraction.length),
  };
}

function divideRounded(
  numerator: bigint,
  denominator: bigint,
  mode: InventoryRoundingModeV2,
): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === BigInt(0) || mode === "DOWN") return quotient;
  if (mode === "UP") return quotient + BigInt(1);
  return remainder * BigInt(2) >= denominator ? quotient + BigInt(1) : quotient;
}

/**
 * API 경계에서는 수량을 JSON number가 아닌 문자열로 받아 이 함수로 변환한다.
 * numerator/denominator는 sourceUom 1단위를 baseUom으로 바꾸는 유리수다.
 */
export function convertToBaseMinorUnits(
  quantity: string,
  rule: Pick<MaterialUomRuleV2Doc, "quantityScale" | "roundingMode">,
  conversion: Pick<UomConversionV2, "numerator" | "denominator"> = { numerator: 1, denominator: 1 },
): number {
  if (!Number.isSafeInteger(rule.quantityScale) || rule.quantityScale < 0 || rule.quantityScale > 6) {
    throw new Error("quantityScale must be an integer between 0 and 6");
  }
  if (!Number.isSafeInteger(conversion.numerator) || conversion.numerator <= 0) {
    throw new Error("conversion numerator must be a safe positive integer");
  }
  if (!Number.isSafeInteger(conversion.denominator) || conversion.denominator <= 0) {
    throw new Error("conversion denominator must be a safe positive integer");
  }
  const decimal = decimalFraction(quantity);
  const numerator = decimal.numerator
    * BigInt(conversion.numerator)
    * (BigInt(10) ** BigInt(rule.quantityScale));
  const denominator = decimal.denominator * BigInt(conversion.denominator);
  const minor = divideRounded(numerator, denominator, rule.roundingMode);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("converted quantity exceeds safe integer range");
  return Number(minor);
}

export function formatMinorUnits(quantityMinor: number, scale: number): string {
  if (!Number.isSafeInteger(quantityMinor) || quantityMinor < 0) {
    throw new Error("quantityMinor must be a safe non-negative integer");
  }
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > 6) {
    throw new Error("scale must be an integer between 0 and 6");
  }
  if (scale === 0) return String(quantityMinor);
  const raw = String(quantityMinor).padStart(scale + 1, "0");
  return `${raw.slice(0, -scale)}.${raw.slice(-scale)}`;
}
