import assert from "node:assert/strict";
import {
  buildM20SteadyStateSlots,
  M20_DAILY_LOT_RELEASE,
  M20_TARGET_OCCUPIED_FOUP,
  M20_TARGET_PHYSICAL_FOUP,
  M20_TARGET_RESERVE_FOUP,
  M20_WATCHED_LOT_COUNT,
  modeledFoupCode,
  modeledWaferLotId,
  nextKstMidnight,
} from "../src/lib/foup-wip-model";
import type { RouteVisit } from "../src/lib/route-master";

const processCodes = ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09"];
const visits: RouteVisit[] = Array.from({ length: 123 }, (_, index) => ({
  nodeId: `node-${index}`,
  label: `Visit ${index}`,
  processCode: processCodes[index % processCodes.length],
  stage: "FRONT_END",
  operationCode: "GENERAL",
  visitIndex: index,
  stepIndex: index,
}));
const endAt = nextKstMidnight(new Date("2026-07-19T05:00:00.000Z"));
assert.equal(endAt.toISOString(), "2026-07-19T15:00:00.000Z", "다음 KST 자정");
const slots = buildM20SteadyStateSlots(endAt, visits);
assert.equal(slots.length, M20_TARGET_OCCUPIED_FOUP);
assert(slots.every((slot) => slot.releaseAt < endAt));
assert(slots.every((slot) => slot.currentStepIndex >= 0 && slot.currentStepIndex < visits.length));
assert.equal(new Set(slots.map((slot) => modeledWaferLotId(slot.releaseAt, slot.slotIndex % M20_DAILY_LOT_RELEASE + 1))).size, slots.length);
assert.equal(modeledFoupCode(1), "FOUP-M20-00001");
assert.equal(modeledFoupCode(M20_TARGET_PHYSICAL_FOUP - M20_WATCHED_LOT_COUNT), "FOUP-M20-15588");

assert.equal(M20_TARGET_OCCUPIED_FOUP + M20_TARGET_RESERVE_FOUP, M20_TARGET_PHYSICAL_FOUP, "Occupied + Reserve = Physical Fleet");
assert.equal(M20_TARGET_PHYSICAL_FOUP - M20_WATCHED_LOT_COUNT, 15_588, "Watched 외 원장 FOUP 수량");

console.log("✅ M20 FOUP WIP model verified: 14,040 occupied · 15,600 ledger · 12 watched live view");
