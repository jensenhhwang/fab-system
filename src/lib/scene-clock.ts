export type SceneClockMode = "LIVE" | "PAUSED";

export function calculateServerOffset(serverTime: string, clientReceivedAtMs: number) {
  const serverMs = Date.parse(serverTime);
  return Number.isFinite(serverMs) ? serverMs - clientReceivedAtMs : 0;
}

export function sceneReferenceTime(input: {
  mode: SceneClockMode;
  clientNowMs: number;
  serverOffsetMs: number;
  pausedAtMs: number | null;
}) {
  if (input.mode === "PAUSED" && input.pausedAtMs !== null) return input.pausedAtMs;
  return input.clientNowMs + input.serverOffsetMs;
}
