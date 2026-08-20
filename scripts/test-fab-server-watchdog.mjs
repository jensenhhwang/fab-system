import assert from "node:assert/strict";
import {
  FAILURE_LIMIT,
  nextServerCommand,
  nextWatchdogDecision,
  restartDelayMs,
} from "./fab-server-watchdog.mjs";

let state = { consecutiveFailures: 0, restartAttempt: 0 };
state = nextWatchdogDecision(state, "HEALTH_FAILED");
assert.equal(state.action, "WAIT");
assert.equal(state.consecutiveFailures, 1);
state = nextWatchdogDecision(state, "HEALTH_FAILED");
assert.equal(state.action, "WAIT");
state = nextWatchdogDecision(state, "HEALTH_FAILED");
assert.equal(state.action, "RESTART");
assert.equal(state.consecutiveFailures, FAILURE_LIMIT);

state = nextWatchdogDecision(state, "HEALTH_OK");
assert.equal(state.action, "WAIT");
assert.equal(state.consecutiveFailures, 0);
assert.equal(state.restartAttempt, 0);

state = nextWatchdogDecision(state, "CHILD_EXITED");
assert.equal(state.action, "RESTART");
assert.equal(state.restartAttempt, 1);

assert.equal(restartDelayMs(0), 1_000);
assert.equal(restartDelayMs(3), 8_000);
assert.equal(restartDelayMs(99), 60_000);

assert.deepEqual(
  nextServerCommand("/Fab/fab-system", "/opt/node", 3000),
  {
    command: "/opt/node",
    args: ["/Fab/fab-system/node_modules/next/dist/bin/next", "dev", "-p", "3000"],
  },
  "npm 셸이 아니라 Next CLI를 직접 소유해야 한다",
);

console.log("✅ FAB watchdog 상태 머신 테스트 통과");
