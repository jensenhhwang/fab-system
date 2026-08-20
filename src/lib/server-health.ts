export const MIN_READY_TICK_STALE_MS = 180_000;

export type ServerReadinessInput = {
  now: Date;
  dbConnected: boolean;
  state: {
    status: "RUNNING" | "PAUSED";
    lastTickAt: Date;
    tickIntervalMs: number;
    lockedBy?: string | null;
    lockExpiresAt?: Date | null;
  } | null;
};

export type ServerReadinessReason =
  | "OK"
  | "PAUSED"
  | "DB_UNAVAILABLE"
  | "STATE_MISSING"
  | "TICK_IN_PROGRESS"
  | "TICK_STALE";

export type ServerReadinessResult = {
  status: "READY" | "NOT_READY";
  reason: ServerReadinessReason;
  checkedAt: string;
  engineStatus: "RUNNING" | "PAUSED" | null;
  secondsSinceTick: number | null;
  staleAfterMs: number | null;
};

function unavailable(
  now: Date,
  reason: "DB_UNAVAILABLE" | "STATE_MISSING",
): ServerReadinessResult {
  return {
    status: "NOT_READY",
    reason,
    checkedAt: now.toISOString(),
    engineStatus: null,
    secondsSinceTick: null,
    staleAfterMs: null,
  };
}

export function evaluateServerReadiness(
  input: ServerReadinessInput,
): ServerReadinessResult {
  if (!input.dbConnected) return unavailable(input.now, "DB_UNAVAILABLE");
  if (!input.state) return unavailable(input.now, "STATE_MISSING");

  const elapsedMs = Math.max(0, input.now.getTime() - input.state.lastTickAt.getTime());
  const staleAfterMs = Math.max(
    MIN_READY_TICK_STALE_MS,
    Math.max(0, input.state.tickIntervalMs) * 12,
  );
  const base = {
    checkedAt: input.now.toISOString(),
    engineStatus: input.state.status,
    secondsSinceTick: Math.floor(elapsedMs / 1_000),
    staleAfterMs,
  };

  if (input.state.status === "PAUSED") {
    return { ...base, status: "READY", reason: "PAUSED" };
  }
  if (
    input.state.lockedBy
    && input.state.lockExpiresAt
    && input.state.lockExpiresAt.getTime() > input.now.getTime()
  ) {
    return { ...base, status: "READY", reason: "TICK_IN_PROGRESS" };
  }
  if (elapsedMs > staleAfterMs) {
    return { ...base, status: "NOT_READY", reason: "TICK_STALE" };
  }
  return { ...base, status: "READY", reason: "OK" };
}
