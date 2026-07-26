import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import { installInventoryV2Indexes } from "../src/lib/inventory-v2-indexes";
import {
  InventoryPostingError,
  postInventoryV2,
  type InventoryPostingDependencies,
  type PostInventoryCommand,
} from "../src/lib/inventory-v2-posting";
import type {
  InventoryBalanceV2Doc,
  InventoryDimensionV2,
  InventoryMovementV2Doc,
  MaterialUomLockV2Doc,
  MaterialUomRuleV2Doc,
} from "../src/lib/inventory-v2-contract";

const uri = process.env.INVENTORY_V2_TEST_DATABASE_URL;
if (!uri) throw new Error("INVENTORY_V2_TEST_DATABASE_URL is required");
const databaseName = uri.split("?")[0].split("/").at(-1) ?? "";
if (!/(?:^|[-_])test$/i.test(databaseName)) {
  throw new Error("Integration test database name must end with -test or _test");
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db();
const suffix = `${Date.now()}_${process.pid}`;
const balances = db.collection<InventoryBalanceV2Doc>(`inventoryBalancesV2_it_${suffix}`);
const movements = db.collection<InventoryMovementV2Doc>(`inventoryMovementsV2_it_${suffix}`);
const locks = db.collection<MaterialUomLockV2Doc>(`materialUomLocksV2_it_${suffix}`);
const rules = db.collection<MaterialUomRuleV2Doc>(`materialUomRulesV2_it_${suffix}`);

const dependencies: InventoryPostingDependencies = {
  client,
  store: {
    inventoryBalancesV2: balances,
    inventoryMovementsV2: movements,
    materialUomLocksV2: locks,
    materialUomRulesV2: rules,
  },
};

const occurredAt = new Date("2026-07-26T12:00:00.000Z");
const inspection: InventoryDimensionV2 = {
  materialId: "CHM-IT-001",
  siteId: "M20",
  facilityId: "WMS-CENTRAL",
  warehouseId: "HZW-01",
  locationId: "HZW-01-IT",
  lotId: "LOT-IT-001",
  handlingUnitId: "HU-IT-001",
  qualityStatus: "INSPECTION_PENDING",
  logisticsStatus: "STORED",
  commitmentStatus: "FREE",
};
const unrestricted: InventoryDimensionV2 = { ...inspection, qualityStatus: "UNRESTRICTED" };
const reserved: InventoryDimensionV2 = { ...unrestricted, commitmentStatus: "RESERVED" };

const receipt: PostInventoryCommand = {
  requestId: `REQ-IT-RECEIPT-${suffix}`,
  type: "RECEIPT",
  lines: [{ quantity: "10", sourceUom: "L", to: inspection }],
  reasonCode: "INTEGRATION_TEST",
  sourceDocumentType: "TEST",
  sourceDocumentId: suffix,
  occurredAt,
};

async function ignoreNamespaceMissing(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if ((error as { code?: number }).code !== 26) throw error;
  }
}

try {
  const firstIndexRun = await installInventoryV2Indexes({
    inventoryBalancesV2: balances,
    inventoryMovementsV2: movements,
    materialUomRulesV2: rules,
  }, { apply: true });
  assert.ok(firstIndexRun.created.length > 0);
  const secondIndexRun = await installInventoryV2Indexes({
    inventoryBalancesV2: balances,
    inventoryMovementsV2: movements,
    materialUomRulesV2: rules,
  }, { apply: true });
  assert.equal(secondIndexRun.created.length, 0);
  assert.ok(secondIndexRun.existing.length > 0);

  await rules.insertOne({
    _id: `UOM-IT-${suffix}`,
    schemaVersion: 2,
    materialId: inspection.materialId,
    baseUom: "L",
    quantityScale: 3,
    roundingMode: "HALF_UP",
    conversions: [],
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    approvedBy: "QA-IT",
    approvedAt: new Date("2025-12-01T00:00:00.000Z"),
  });

  const postedReceipt = await postInventoryV2(receipt, { actorId: "USER-IT" }, dependencies);
  assert.equal(postedReceipt.duplicate, false);
  const duplicateReceipt = await postInventoryV2(receipt, { actorId: "USER-IT" }, dependencies);
  assert.equal(duplicateReceipt.duplicate, true);
  assert.equal(await movements.countDocuments({ requestId: receipt.requestId }), 1);

  await assert.rejects(
    postInventoryV2(
      { ...receipt, lines: [{ quantity: "11", sourceUom: "L", to: inspection }] },
      { actorId: "USER-IT" },
      dependencies,
    ),
    (error: unknown) => error instanceof InventoryPostingError && error.code === "IDEMPOTENCY_CONFLICT",
  );

  await postInventoryV2({
    requestId: `REQ-IT-QA-${suffix}`,
    type: "QUALITY_CHANGE",
    lines: [{ quantity: "4", sourceUom: "L", from: inspection, to: unrestricted }],
    reasonCode: "QA_RELEASE",
    sourceDocumentType: "TEST_QA",
    sourceDocumentId: suffix,
    occurredAt,
  }, { actorId: "QA-IT" }, dependencies);

  const reservations = await Promise.allSettled([
    postInventoryV2({
      requestId: `REQ-IT-RESERVE-A-${suffix}`,
      type: "RESERVE",
      lines: [{ quantity: "3", sourceUom: "L", from: unrestricted, to: reserved }],
      reasonCode: "WORK_ORDER",
      sourceDocumentType: "TEST_WO",
      sourceDocumentId: `${suffix}-A`,
      occurredAt,
    }, { actorId: "MES-IT" }, dependencies),
    postInventoryV2({
      requestId: `REQ-IT-RESERVE-B-${suffix}`,
      type: "RESERVE",
      lines: [{ quantity: "3", sourceUom: "L", from: unrestricted, to: reserved }],
      reasonCode: "WORK_ORDER",
      sourceDocumentType: "TEST_WO",
      sourceDocumentId: `${suffix}-B`,
      occurredAt,
    }, { actorId: "MES-IT" }, dependencies),
  ]);
  assert.equal(reservations.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(reservations.filter((result) => (
    result.status === "rejected"
    && result.reason instanceof InventoryPostingError
    && result.reason.code === "INSUFFICIENT_BALANCE"
  )).length, 1);

  const allBalances = await balances.find({}).toArray();
  assert.equal(allBalances.reduce((sum, balance) => sum + balance.quantityMinor, 0), 10_000);
  assert.ok(allBalances.every((balance) => balance.quantityMinor >= 0));
  assert.equal(await movements.countDocuments({}), 3);
  console.log("✅ operational inventory V2 replica-set integration passed");
} finally {
  await Promise.all([
    ignoreNamespaceMissing(() => balances.drop()),
    ignoreNamespaceMissing(() => movements.drop()),
    ignoreNamespaceMissing(() => locks.drop()),
    ignoreNamespaceMissing(() => rules.drop()),
  ]);
  await client.close();
}
