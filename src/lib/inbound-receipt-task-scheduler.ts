import {
  ensureInboundReceiptTaskIndexes,
  materializeDueInboundReceiptTasks,
} from "@/lib/inbound-receipt-task-server";

const SCAN_INTERVAL_MS = 60_000;
let started = false;
let scanning = false;

export function startInboundReceiptTaskScheduler(): void {
  if (started) return;
  started = true;

  const scan = async () => {
    if (scanning) return;
    scanning = true;
    try {
      await materializeDueInboundReceiptTasks();
    } catch (error) {
      console.error("[inbound-receipt] ETA 업무 생성 실패:", error);
    } finally {
      scanning = false;
    }
  };

  void ensureInboundReceiptTaskIndexes()
    .then(scan)
    .catch((error) => console.error("[inbound-receipt] 초기화 실패:", error));
  setInterval(() => void scan(), SCAN_INTERVAL_MS);
}
