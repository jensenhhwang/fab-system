import "server-only";
import { executeTwinTick } from "@/lib/twin/engine";
import { getOrInitTwinState, ensureTwinIndexes } from "@/lib/twin/state";
import {
  ensureControlTowerAIIndexes,
  maybeRunControlTowerAI,
} from "@/lib/control-tower-episode-server";

let started = false;

export function startTwinScheduler(): void {
  if (started) return;
  started = true;

  void (async () => {
    await Promise.all([ensureTwinIndexes(), ensureControlTowerAIIndexes()]);
    const state = await getOrInitTwinState();
    const interval = state.tickIntervalMs;
    setInterval(() => {
      executeTwinTick()
        .then((result) => {
          if (result.skipped === "LOCKED") return;
          void maybeRunControlTowerAI()
            .catch((err) => console.error("[control-tower-ai] 자동 판단 실패:", err));
        })
        .catch((err) => console.error("[twin] tick 실패:", err));
    }, interval);
    console.log(`[twin] 스케줄러 기동: ${interval}ms 간격`);
  })().catch((err) => console.error("[twin] 스케줄러 초기화 실패:", err));
}
