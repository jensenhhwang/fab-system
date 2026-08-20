import assert from "node:assert/strict";
import { evaluateServerReadiness } from "../src/lib/server-health";

const now = new Date("2026-08-20T12:00:00.000Z");

assert.equal(
  evaluateServerReadiness({
    now,
    dbConnected: true,
    state: {
      status: "RUNNING",
      lastTickAt: new Date("2026-08-20T11:59:30.000Z"),
      tickIntervalMs: 5_000,
    },
  }).status,
  "READY",
  "최근 tick이 있으면 준비 상태여야 한다",
);

{
  const stale = evaluateServerReadiness({
    now,
    dbConnected: true,
    state: {
      status: "RUNNING",
      lastTickAt: new Date("2026-08-20T11:56:59.999Z"),
      tickIntervalMs: 5_000,
    },
  });
  assert.equal(stale.status, "NOT_READY");
  assert.equal(stale.reason, "TICK_STALE");
  assert.equal(stale.staleAfterMs, 180_000, "최소 신선도 여유는 실제 180초다");
}

{
  const inProgress = evaluateServerReadiness({
    now,
    dbConnected: true,
    state: {
      status: "RUNNING",
      lastTickAt: new Date("2026-08-20T11:55:00.000Z"),
      tickIntervalMs: 5_000,
      lockedBy: "tick-owner",
      lockExpiresAt: new Date("2026-08-20T12:01:00.000Z"),
    },
  });
  assert.equal(inProgress.status, "READY", "활성 tick lease 중에는 재시작하면 안 된다");
  assert.equal(inProgress.reason, "TICK_IN_PROGRESS");
}

{
  const paused = evaluateServerReadiness({
    now,
    dbConnected: true,
    state: {
      status: "PAUSED",
      lastTickAt: new Date("2026-08-19T00:00:00.000Z"),
      tickIntervalMs: 5_000,
    },
  });
  assert.equal(paused.status, "READY", "의도된 PAUSED는 서버 장애가 아니다");
  assert.equal(paused.reason, "PAUSED");
}

{
  const unavailable = evaluateServerReadiness({ now, dbConnected: false, state: null });
  assert.equal(unavailable.status, "NOT_READY");
  assert.equal(unavailable.reason, "DB_UNAVAILABLE");
}

{
  const missing = evaluateServerReadiness({ now, dbConnected: true, state: null });
  assert.equal(missing.status, "NOT_READY");
  assert.equal(missing.reason, "STATE_MISSING");
}

console.log("✅ 서버 ready 정책 테스트 통과");
