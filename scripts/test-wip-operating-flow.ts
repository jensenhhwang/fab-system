import assert from "node:assert/strict";
import {
  WIP_FLOW_QUANTUM_MS,
  planWipFlowWindow,
  stableOperatingPhaseMs,
  stepDwellOperatingMs,
} from "../src/lib/twin/wip-flow";
import { operatingDaysToMs } from "../src/lib/twin/operating-clock";

assert.equal(WIP_FLOW_QUANTUM_MS, 5 * 60_000, "운영 5분 퀀텀");
assert.equal(stepDwellOperatingMs(105, 140), operatingDaysToMs(0.75));
assert.throws(() => stepDwellOperatingMs(0, 140), /cycleTimeDays/);
assert.throws(() => stepDwellOperatingMs(105, 0), /totalSteps/);

const once = planWipFlowWindow({ elapsedOperatingMs: 17 * 60_000, carryMs: 0 });
const first = planWipFlowWindow({ elapsedOperatingMs: 7 * 60_000, carryMs: 0 });
const second = planWipFlowWindow({ elapsedOperatingMs: 10 * 60_000, carryMs: first.nextCarryMs });
assert.equal(once.quantumCount, first.quantumCount + second.quantumCount);
assert.equal(once.nextCarryMs, second.nextCarryMs);
assert.equal(once.processedOperatingMs + once.nextCarryMs, 17 * 60_000);

const dwellMs = operatingDaysToMs(0.75);
const phaseA = stableOperatingPhaseMs("WLOT-A", dwellMs);
assert.equal(phaseA, stableOperatingPhaseMs("WLOT-A", dwellMs));
assert.ok(phaseA > 0 && phaseA < dwellMs);
assert.notEqual(phaseA, stableOperatingPhaseMs("WLOT-B", dwellMs));

console.log("✅ WIP 운영시간 흐름 계산 통과");
