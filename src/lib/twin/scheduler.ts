import "server-only";
import { executeTwinTick } from "@/lib/twin/engine";
import { getOrInitTwinState, ensureTwinIndexes } from "@/lib/twin/state";
import {
  ensureControlTowerAIIndexes,
  maybeRunControlTowerAI,
} from "@/lib/control-tower-episode-server";

let started = false;

// tick 겹침 회귀 배경: setInterval은 이전 executeTwinTick()이 아직 실행 중이어도 정확히
// interval마다 다음 호출을 또 쏜다. tick이 오래 걸리면(실측 95초, interval=5초) 같은 tick이
// 여러 개 동시 실행돼 advanceStepBucketWip의 lost update·burnInventoryProjection의 이중 차감으로
// 이어졌다(§ engine.ts LOCK_TTL_MS 주석). self-scheduling setTimeout 체인으로 바꿔서, 다음 tick은
// 이전 tick의 Promise가 완전히 끝난 뒤에만 interval 후 예약되게 한다 — 겹침 자체가 구조적으로
// 불가능해진다.
function scheduleNextTick(interval: number): void {
  setTimeout(() => {
    executeTwinTick()
      .then((result) => {
        if (result.skipped) return;
        return maybeRunControlTowerAI().catch((err) => console.error("[control-tower-ai] 자동 판단 실패:", err));
      })
      .catch((err) => console.error("[twin] tick 실패:", err))
      .finally(() => scheduleNextTick(interval));
  }, interval);
}

export function startTwinScheduler(): void {
  if (started) return;
  started = true;

  void (async () => {
    await Promise.all([ensureTwinIndexes(), ensureControlTowerAIIndexes()]);
    const state = await getOrInitTwinState();
    const interval = state.tickIntervalMs;
    scheduleNextTick(interval);
    console.log(`[twin] 스케줄러 기동: ${interval}ms 간격(self-scheduling)`);
  })().catch((err) => console.error("[twin] 스케줄러 초기화 실패:", err));
}
