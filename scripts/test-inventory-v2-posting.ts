import assert from "node:assert/strict";
import {
  InventoryPostingError,
  assertPostingTransition,
  buildBalanceMutationPlan,
  normalizeDecimalQuantity,
  prepareInventoryMovementV2,
  type PostInventoryCommand,
} from "../src/lib/inventory-v2-posting";
import type {
  InventoryDimensionV2,
  MaterialUomRuleV2Doc,
} from "../src/lib/inventory-v2-contract";

const occurredAt = new Date("2026-07-26T12:00:00.000Z");
const recordedAt = new Date("2026-07-26T12:00:01.000Z");

const rule: MaterialUomRuleV2Doc = {
  _id: "UOM-CHM-001-2026",
  schemaVersion: 2,
  materialId: "CHM-001",
  baseUom: "L",
  quantityScale: 3,
  roundingMode: "HALF_UP",
  conversions: [{
    sourceUom: "DRUM",
    numerator: 200,
    denominator: 1,
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
  }],
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  approvedBy: "QA-001",
  approvedAt: new Date("2025-12-20T00:00:00.000Z"),
};

const inspection: InventoryDimensionV2 = {
  materialId: "CHM-001",
  siteId: "M20",
  facilityId: "WMS-CENTRAL",
  warehouseId: "HZW-01",
  locationId: "HZW-01-A01",
  lotId: "LOT-001",
  handlingUnitId: "HU-001",
  qualityStatus: "INSPECTION_PENDING",
  logisticsStatus: "STORED",
  commitmentStatus: "FREE",
};
const unrestricted: InventoryDimensionV2 = { ...inspection, qualityStatus: "UNRESTRICTED" };
const held: InventoryDimensionV2 = { ...inspection, qualityStatus: "HOLD" };
const reserved: InventoryDimensionV2 = { ...unrestricted, commitmentStatus: "RESERVED" };

const receipt: PostInventoryCommand = {
  requestId: "REQ-RECEIPT-001",
  type: "RECEIPT",
  lines: [{ quantity: "001.2500", sourceUom: "DRUM", to: inspection }],
  reasonCode: "INBOUND_RECEIPT",
  sourceDocumentType: "INBOUND_PLAN",
  sourceDocumentId: "IB-001",
  occurredAt,
};

const preparedReceipt = prepareInventoryMovementV2(
  receipt,
  { actorId: "USER-001" },
  [rule],
  { movementId: "MV2-001", recordedAt },
);
assert.equal(preparedReceipt.lines[0].sourceQuantity, "1.25");
assert.equal(preparedReceipt.lines[0].quantityMinor, 250_000);
assert.equal(preparedReceipt.lines[0].baseUom, "L");
assert.match(preparedReceipt.requestHash, /^[a-f0-9]{64}$/);

const reordered: PostInventoryCommand = {
  ...receipt,
  requestId: "REQ-RECEIPT-MULTI",
  lines: [
    { quantity: "2", sourceUom: "L", to: { ...inspection, handlingUnitId: "HU-002" } },
    { quantity: "1", sourceUom: "L", to: inspection },
  ],
};
const reorderedReverse = { ...reordered, lines: [...reordered.lines].reverse() };
const hashA = prepareInventoryMovementV2(
  reordered,
  { actorId: "USER-001" },
  [rule],
  { movementId: "MV2-A", recordedAt },
).requestHash;
const hashB = prepareInventoryMovementV2(
  reorderedReverse,
  { actorId: "USER-001" },
  [rule],
  { movementId: "MV2-B", recordedAt: new Date(recordedAt.getTime() + 1_000) },
).requestHash;
assert.equal(hashA, hashB, "line 순서와 서버 생성 필드는 요청 해시에 영향을 주지 않는다");

const quality = prepareInventoryMovementV2({
  requestId: "REQ-QA-001",
  type: "QUALITY_CHANGE",
  lines: [{ quantity: "50", sourceUom: "L", from: inspection, to: unrestricted }],
  reasonCode: "QA_RELEASE",
  sourceDocumentType: "INSPECTION_RESULT",
  sourceDocumentId: "QA-001",
  occurredAt,
}, { actorId: "QA-001" }, [rule], { movementId: "MV2-QA", recordedAt });
const qualityPlan = buildBalanceMutationPlan(quality.lines);
assert.equal(qualityPlan.length, 2);
assert.equal(qualityPlan.reduce((sum, item) => sum + item.totalDebitMinor, 0), 50_000);
assert.equal(qualityPlan.reduce((sum, item) => sum + item.totalCreditMinor, 0), 50_000);

const repeatedLinePlan = buildBalanceMutationPlan([...quality.lines, ...quality.lines]);
assert.equal(repeatedLinePlan.reduce((sum, item) => sum + item.totalDebitMinor, 0), 100_000);
assert.equal(repeatedLinePlan.reduce((sum, item) => sum + item.totalCreditMinor, 0), 100_000);

assert.doesNotThrow(() => assertPostingTransition("RESERVE", { from: unrestricted, to: reserved }));
assert.throws(
  () => assertPostingTransition("RESERVE", { from: reserved, to: unrestricted }),
  (error: unknown) => error instanceof InventoryPostingError && error.code === "TRANSITION_NOT_ALLOWED",
);
assert.throws(
  () => assertPostingTransition("QUALITY_CHANGE", { from: reserved, to: held }),
  (error: unknown) => error instanceof InventoryPostingError && error.code === "TRANSITION_NOT_ALLOWED",
);

assert.equal(normalizeDecimalQuantity("00012.3400"), "12.34");
assert.throws(() => normalizeDecimalQuantity("1e3"), /plain decimal/);
assert.throws(() => normalizeDecimalQuantity("0.000"), /greater than zero/);

assert.throws(
  () => prepareInventoryMovementV2(
    { ...receipt, type: "TRANSFER" },
    { actorId: "USER-001" },
    [rule],
    { movementId: "MV2-UNSUPPORTED", recordedAt },
  ),
  (error: unknown) => error instanceof InventoryPostingError && error.code === "UNSUPPORTED_MOVEMENT_TYPE",
);

assert.throws(
  () => prepareInventoryMovementV2(
    { ...receipt, occurredAt: new Date("2025-12-31T23:59:59.999Z") },
    { actorId: "USER-001" },
    [rule],
    { movementId: "MV2-NO-RULE", recordedAt },
  ),
  (error: unknown) => error instanceof InventoryPostingError && error.code === "UOM_RULE_NOT_FOUND",
);

assert.throws(
  () => prepareInventoryMovementV2(
    receipt,
    { actorId: "USER-001" },
    [rule, { ...rule, _id: "UOM-CHM-001-OVERLAP", effectiveFrom: occurredAt }],
    { movementId: "MV2-OVERLAP", recordedAt },
  ),
  (error: unknown) => error instanceof InventoryPostingError && error.code === "UOM_RULE_AMBIGUOUS",
);

assert.throws(
  () => prepareInventoryMovementV2(
    { ...receipt, lines: [{ ...receipt.lines[0], sourceUom: "IBC" }] },
    { actorId: "USER-001" },
    [rule],
    { movementId: "MV2-NO-CONVERSION", recordedAt },
  ),
  (error: unknown) => error instanceof InventoryPostingError && error.code === "UOM_CONVERSION_NOT_FOUND",
);

assert.throws(
  () => prepareInventoryMovementV2(
    { ...receipt, lines: Array.from({ length: 101 }, () => receipt.lines[0]) },
    { actorId: "USER-001" },
    [rule],
    { movementId: "MV2-TOO-MANY", recordedAt },
  ),
  (error: unknown) => error instanceof InventoryPostingError && error.code === "INVALID_COMMAND",
);

console.log("✅ operational inventory V2 posting rules passed");
