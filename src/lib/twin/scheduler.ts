import "server-only";
import { executeTwinTick } from "@/lib/twin/engine";
import { getOrInitTwinState, ensureTwinIndexes } from "@/lib/twin/state";

let started = false;

export function startTwinScheduler(): void {
  if (started) return;
  started = true;

  void (async () => {
    await ensureTwinIndexes();
    const state = await getOrInitTwinState();
    const interval = state.tickIntervalMs;
    setInterval(() => {
      executeTwinTick().catch((err) => console.error("[twin] tick 실패:", err));
    }, interval);
    console.log(`[twin] 스케줄러 기동: ${interval}ms 간격`);
  })().catch((err) => console.error("[twin] 스케줄러 초기화 실패:", err));
}
