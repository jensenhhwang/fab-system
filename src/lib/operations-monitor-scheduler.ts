import {
  ensureOperationMonitorIndexes,
  runOperationMonitorScan,
} from "@/lib/operations-monitor-server";

const MONITOR_INTERVAL_MS = 60_000;
let started = false;

async function scan(): Promise<void> {
  const result = await runOperationMonitorScan();
  if (result.reason === "MONITOR_FAILURE") {
    console.error(`[operations-monitor] scan 실패: ${result.error ?? "unknown"}`);
    return;
  }
  if (!result.skipped) {
    console.log(
      `[operations-monitor] 관측 ${result.signalCount}건 · 신규제안 ${result.proposed}건 · 복구 ${result.recovered}건`,
    );
  }
}

function scheduleNext(): void {
  setTimeout(() => {
    scan()
      .catch((error) => console.error("[operations-monitor] scan 예외:", error))
      .finally(scheduleNext);
  }, MONITOR_INTERVAL_MS);
}

export function startOperationMonitorScheduler(): void {
  if (started) return;
  started = true;
  void ensureOperationMonitorIndexes()
    .then(scan)
    .catch((error) => console.error("[operations-monitor] 초기화 실패:", error))
    .finally(scheduleNext);
}
