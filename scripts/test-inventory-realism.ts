import assert from "node:assert/strict";
import {
  MODELED_WAREHOUSE_CAPACITY_BASELINE,
  calculateOperationalOpeningTarget,
  operationalInventoryProfile,
  projectedStorageOccupancy,
} from "../src/lib/inventory-realism";

const nitrogen = operationalInventoryProfile({
  materialCode: "GAS-001",
  currentUnit: "봄베",
  supplyMode: "BULK_GAS",
});
assert.equal(nitrogen.inventoryUnit, "Nm³");
assert.equal(nitrogen.inventoryToStorageFactor, 0);

const silane = operationalInventoryProfile({
  materialCode: "GAS-004",
  currentUnit: "봄베",
  supplyMode: "SPECIALTY_CYLINDER",
});
assert.equal(silane.inventoryUnit, "Nm³");
assert.equal(silane.purchaseToInventoryFactor, 10);
assert.equal(projectedStorageOccupancy({
  quantity: 1_000,
  inventoryToStorageFactor: silane.inventoryToStorageFactor,
  fallbackFactor: 1,
}), 100);

const precursor = operationalInventoryProfile({
  materialCode: "GAS-019",
  currentUnit: "봄베",
  supplyMode: "PRECURSOR_CANISTER",
});
assert.equal(precursor.inventoryUnit, "L");
assert.equal(precursor.purchaseToInventoryFactor, 10);

const baseDie = operationalInventoryProfile({
  materialCode: "PKG-LBD-001",
  currentUnit: "KGD_DIE",
  supplyMode: "GENERAL_STORAGE",
});
assert.equal(baseDie.purchaseToInventoryFactor, 1_000);
assert.equal(projectedStorageOccupancy({
  quantity: 6_400_000,
  inventoryToStorageFactor: baseDie.inventoryToStorageFactor,
  fallbackFactor: 0.1,
}), 128);
assert.equal(MODELED_WAREHOUSE_CAPACITY_BASELINE["MWH-01"], 3_500);

const shortage = calculateOperationalOpeningTarget({
  currentQuantity: 100,
  safetyStock: 120,
  dailyUsage: 20,
  ropDays: 7,
  leadTimeDays: 10,
  supplyMode: "GENERAL_STORAGE",
});
assert.deepEqual(shortage, {
  protectedDays: 10,
  targetQuantity: 200,
  delta: 100,
  projectedDoh: 10,
});

const currentPreserved = calculateOperationalOpeningTarget({
  currentQuantity: 300,
  safetyStock: 120,
  dailyUsage: 20,
  ropDays: 7,
  leadTimeDays: 10,
  supplyMode: "GENERAL_STORAGE",
});
assert.equal(currentPreserved.targetQuantity, 300);

const onSite = calculateOperationalOpeningTarget({
  currentQuantity: 0,
  safetyStock: 0,
  dailyUsage: 5_000,
  ropDays: 7,
  leadTimeDays: 0,
  supplyMode: "ON_SITE",
});
assert.equal(onSite.targetQuantity, 0);
assert.equal(onSite.projectedDoh, null);

console.log("✅ operational inventory realism rules passed");
