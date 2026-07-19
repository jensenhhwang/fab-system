import assert from "node:assert/strict";
import {
  buildM20FabEquipmentMaster,
  M20_DEFINED_EQUIPMENT_COUNTS,
  M20_NORMAL_MAX_PLANNED_LOAD,
} from "../src/lib/m20-equipment-capacity-plan";

const master = buildM20FabEquipmentMaster();

assert.equal(master.version, "FAB_EQUIPMENT_MASTER_M20_V3");
assert.equal(master.previousBaselineTotal, 452);
assert.equal(master.totalEquipment, 494);
assert.equal(master.totalGap, 42);
assert.equal(M20_DEFINED_EQUIPMENT_COUNTS.P02, 58);
assert.equal(M20_DEFINED_EQUIPMENT_COUNTS.P03, 66);
assert.equal(M20_DEFINED_EQUIPMENT_COUNTS.P07, 62);
assert(master.supportedWspm >= 117_000 / M20_NORMAL_MAX_PLANNED_LOAD);
assert(master.normalPlannedLoad <= M20_NORMAL_MAX_PLANNED_LOAD);
assert(master.normalReservedHeadroom >= 0.15);
assert.equal(master.scenarioGates.find((scenario) => scenario.scenarioId === "NORMAL")?.status, "NORMAL_WITH_RESERVE");
assert.equal(master.scenarioGates.find((scenario) => scenario.scenarioId === "NAMEPLATE")?.status, "NAMEPLATE_STRESS");
assert.equal(master.scenarioGates.find((scenario) => scenario.scenarioId === "EXPANSION")?.status, "OVER_CAPACITY");
assert((master.processes.find((process) => process.processCode === "P05")?.supportedWspm ?? 0) > 0);
assert.equal(M20_DEFINED_EQUIPMENT_COUNTS.P10, 36);
assert.equal(master.processes.find((process) => process.processCode === "P10")?.capacityStages.length, 5);
assert(!master.processes.some((process) => process.processCode === ("P11" as never)));
assert.equal(master.p10OutputContract.baseDieConsumptionPerGrossStack, 1);
assert.equal(master.p10OutputContract.baseDieCapacityStatus, "CAPACITY_PENDING");
assert.deepEqual(master.fabDefinitions.slice(1).map((fab) => [fab.fabId, fab.totalEquipment, fab.status]), [
  ["M21", null, "NOT_MODELED"],
  ["M22", null, "NOT_MODELED"],
]);

console.log("✅ Fab Equipment Master verified: M20 494 modeled tools / 15% reserve policy / M21·M22 TBD");
