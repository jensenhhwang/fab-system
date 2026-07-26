import {
  calculateInventoryMetricsV2,
  convertToBaseMinorUnits,
  formatMinorUnits,
  inventoryBalanceKey,
  movementPhysicalDeltaMinor,
  validateInventoryMovementV2,
  type InventoryDimensionV2,
  type InventoryMovementV2Doc,
} from "../src/lib/inventory-v2-contract";
import { createHash } from "crypto";

const free: InventoryDimensionV2 = {
  materialId: "CHM-001",
  siteId: "M20",
  facilityId: "WMS-CENTRAL",
  warehouseId: "HZW-01",
  locationId: "HZW-01-A01",
  lotId: "LOT-001",
  handlingUnitId: "HU-001",
  qualityStatus: "UNRESTRICTED",
  logisticsStatus: "STORED",
  commitmentStatus: "FREE",
};
const reserved: InventoryDimensionV2 = { ...free, commitmentStatus: "RESERVED" };

const reservation: InventoryMovementV2Doc = {
  _id: "MV2-RESERVE-001",
  schemaVersion: 2,
  requestId: "REQ-RESERVE-001",
  requestHash: createHash("sha256").update("reservation").digest("hex"),
  hashVersion: 1,
  type: "RESERVE",
  lines: [{
    lineNo: 1,
    sourceQuantity: "2.500",
    sourceUom: "L",
    quantityMinor: 2_500,
    baseUom: "L",
    uomScale: 3,
    uomRuleId: "UOM-CHM-001",
    conversionNumerator: 1,
    conversionDenominator: 1,
    from: free,
    to: reserved,
  }],
  reasonCode: "WORK_ORDER_RESERVATION",
  sourceDocumentType: "WORK_ORDER",
  sourceDocumentId: "WO-001",
  actorId: "USER-001",
  occurredAt: new Date("2026-07-26T00:00:00.000Z"),
  recordedAt: new Date("2026-07-26T00:00:01.000Z"),
};

console.assert(validateInventoryMovementV2(reservation).length === 0, "정상 예약 Movement 계약");
console.assert(movementPhysicalDeltaMinor(reservation) === 0, "예약은 물리 현재고를 바꾸지 않는다");
console.assert(inventoryBalanceKey(free) !== inventoryBalanceKey(reserved), "예약은 별도 Balance bucket으로 이동한다");

const metrics = calculateInventoryMetricsV2([
  { quantityMinor: 7_500, qualityStatus: "UNRESTRICTED", commitmentStatus: "FREE" },
  { quantityMinor: 2_500, qualityStatus: "UNRESTRICTED", commitmentStatus: "RESERVED" },
  { quantityMinor: 1_000, qualityStatus: "HOLD", commitmentStatus: "FREE" },
], 3_000);
console.assert(metrics.physicalOnHandMinor === 11_000, "보류를 포함한 물리 현재고");
console.assert(metrics.unrestrictedOnHandMinor === 10_000, "가용 품질 현재고");
console.assert(metrics.committedMinor === 2_500, "예약·할당량");
console.assert(metrics.availableOnHandMinor === 7_500, "예약 차감 가용량");
console.assert(metrics.atpMinor === 10_500, "ATP는 자유 가용량과 확정입고의 합");

const receipt = {
  ...reservation,
  _id: "MV2-RECEIPT-001",
  requestId: "REQ-RECEIPT-001",
  type: "RECEIPT" as const,
  lines: [{
    lineNo: 1,
    sourceQuantity: "5.000",
    sourceUom: "L",
    quantityMinor: 5_000,
    baseUom: "L",
    uomScale: 3,
    uomRuleId: "UOM-CHM-001",
    conversionNumerator: 1,
    conversionDenominator: 1,
    to: free,
  }],
};
console.assert(validateInventoryMovementV2(receipt).length === 0, "정상 입고 Movement 계약");
console.assert(movementPhysicalDeltaMinor(receipt) === 5_000, "입고는 물리 현재고를 늘린다");

const invalidHoldReservation = {
  ...reservation,
  lines: [{
    ...reservation.lines[0],
    to: { ...reserved, qualityStatus: "HOLD" as const },
  }],
};
console.assert(
  validateInventoryMovementV2(invalidHoldReservation).some((error) => error.includes("blocked quality stock")),
  "보류재고 예약 차단",
);

const uomRule = { quantityScale: 3, roundingMode: "HALF_UP" as const };
console.assert(convertToBaseMinorUnits("1.25", uomRule, { numerator: 200, denominator: 1 }) === 250_000, "드럼→L 환산");
console.assert(convertToBaseMinorUnits("1.2345", uomRule) === 1_235, "HALF_UP 정밀도");
console.assert(formatMinorUnits(250_000, 3) === "250.000", "최소단위 표시");

console.log("✅ operational inventory V2 contract passed");
