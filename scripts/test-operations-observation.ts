import "dotenv/config";
import assert from "node:assert/strict";
import { getMongoClient } from "../src/lib/db";
import { buildOperationObservation } from "../src/lib/operations-observation-server";

async function main() {
  const observed = await buildOperationObservation(new Date());
  assert.ok(Number.isFinite(observed.operatingEpochMs));
  assert.ok(["RUNNING", "PAUSED"].includes(observed.engine.status));
  assert.ok(Array.isArray(observed.materials));
  assert.ok(Array.isArray(observed.warehouses));
  assert.ok(Array.isArray(observed.shipments));
  assert.ok(observed.materials.every((material) => (
    material.coverageDays === null || Number.isFinite(material.coverageDays)
  )));
  assert.ok(observed.shipments.every((shipment) => shipment.dueRemainingQty >= 0));
  console.log("✅ 운영 공통 관측 스냅샷 테스트 통과");
  await (await getMongoClient()).close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
