import "dotenv/config";
import { executeTwinTick } from "../src/lib/twin/engine";
import { getOrInitTwinState } from "../src/lib/twin/state";
import { operatingMsToDays } from "../src/lib/twin/operating-clock";
import { getMongoClient } from "../src/lib/db";

// 트윈 엔진을 Next 바깥에서 도는 독립 프로세스.
//
// 왜 필요했나 — 엔진은 지금까지 instrumentation의 self-scheduling 체인으로만 돌았고, 그건
// 살아있는 Next 프로세스를 전제한다. 웹을 재시작할 때마다 tick이 끊기고, 서버리스에서는
// 인스턴스와 함께 죽는다. 리드타임은 운영시간이라 화물이 도착하려면 엔진이 실제로 그만큼
// 돌아야 하는데, 운영시계의 catch-up 상한이 정지 구간을 버리므로 꺼져 있던 시간은 만회되지
// 않는다 — 2026-08-18~22 결품이 풀리지 않은 직접 원인이 이것이다.
//
// 뷰어(웹·데스크톱)가 엔진을 품는 방식은 답이 아니다. 화면을 닫으면 팹이 멈춘다.
// 엔진은 어떤 화면에도 붙지 않는다.
//
// 웹 내장 스케줄러와 동시에 떠 있어도 안전하다 — Mongo 락이 겹침을 막고 뒤늦은 쪽은
// skipped: "LOCKED"로 돌아간다(§twin/state.ts acquireTwinLock).

const FALLBACK_INTERVAL_MS = 5_000;

let stopping = false;
let inFlight: Promise<unknown> | null = null;

function log(event: string, detail = "") {
  console.log(`[twin-worker] ${new Date().toISOString()} ${event}${detail ? ` ${detail}` : ""}`);
}

async function runOnce(): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await executeTwinTick();
    const state = await getOrInitTwinState();
    if (result.skipped) {
      log("skipped", result.skipped);
      return;
    }
    log(
      "tick",
      `${Date.now() - startedAt}ms · 운영 ${operatingMsToDays(state.operatingEpochMs ?? 0).toFixed(2)}일차 · ` +
        `발주 ${result.newPOs} 입고 ${result.receipts} 보류 ${result.held} 차단 ${result.blocked} 출하 ${result.autoShipped}`,
    );
  } catch (err) {
    // 한 번 실패해도 루프를 멈추지 않는다 — 다음 tick에서 회복될 수 있고, 멈추면 그때부터
    // 운영시간이 안 흐른다.
    log("tick-failed", String(err));
  }
}

/**
 * self-scheduling 체인. 이전 tick이 완전히 끝난 뒤에만 다음을 예약한다 — setInterval이면
 * tick이 간격보다 오래 걸릴 때 겹쳐서 돈다(§twin/scheduler.ts와 같은 규칙).
 */
async function loop(): Promise<void> {
  while (!stopping) {
    inFlight = runOnce();
    await inFlight;
    inFlight = null;
    if (stopping) break;
    const state = await getOrInitTwinState();
    const interval = state.tickIntervalMs > 0 ? state.tickIntervalMs : FALLBACK_INTERVAL_MS;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * 진행 중인 tick을 마치고 종료한다. 중간에 죽으면 락이 TTL(5분) 동안 남아서, 그 사이
 * 어떤 tick도 못 돈다 — 개발 중 pkill로 서버를 죽일 때마다 실제로 겪은 일이다.
 */
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log("shutdown", `${signal} — 진행 중인 tick을 마치고 종료한다`);
  if (inFlight) await inFlight.catch(() => {});
  await (await getMongoClient()).close().catch(() => {});
  log("stopped");
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

async function main() {
  const state = await getOrInitTwinState();
  log(
    "started",
    `status=${state.status} interval=${state.tickIntervalMs}ms · 운영 ${operatingMsToDays(state.operatingEpochMs ?? 0).toFixed(2)}일차`,
  );
  await loop();
}

main().catch((err) => {
  console.error("[twin-worker] 기동 실패:", err);
  process.exit(1);
});
