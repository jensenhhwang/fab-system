import { collections } from "@/lib/db";
import type { WorkOrderDoc, TransferOrderStatus } from "@/lib/db";
import type { FabId } from "@/lib/fab-domain";

// 물리 확인(피킹→적재→출발→도착→인계→소비)이 사람 손을 기다리는 구간이라, 정체 여부는
// "TransferOrder가 지금 상태로 얼마나 오래 머물렀는지"로 판단한다. transition/pick/consume
// 라우트가 상태 전이마다 updatedAt을 갱신하므로 이 값이 "상태 진입 시각"의 근사치가 된다.
export const PILOT_STALL_WARN_MS = 5 * 60 * 1000;
export const PILOT_STALL_CRITICAL_MS = 15 * 60 * 1000;

export type StallLevel = "normal" | "warn" | "critical";

export type PilotQueueItem = {
  workOrder: WorkOrderDoc;
  transferStatus: TransferOrderStatus | null;
  statusSince: Date;
  ageMs: number;
  stallLevel: StallLevel;
};

export async function listPilotQueue(fabId?: FabId): Promise<PilotQueueItem[]> {
  const { workOrders, transferOrders } = await collections();
  const filter: Record<string, unknown> = { scope: "M20_PILOT" };
  if (fabId) filter.fabId = fabId;
  const wos = await workOrders.find(filter).sort({ createdAt: -1 }).limit(50).toArray();
  if (!wos.length) return [];

  const transfers = await transferOrders
    .find({ workOrderId: { $in: wos.map((wo) => wo._id) } })
    .sort({ createdAt: 1 })
    .toArray();
  const transferByWorkOrder = new Map<string, (typeof transfers)[number]>();
  for (const transfer of transfers) {
    if (transfer.workOrderId && !transferByWorkOrder.has(transfer.workOrderId)) {
      transferByWorkOrder.set(transfer.workOrderId, transfer);
    }
  }

  const now = Date.now();
  return wos.map((workOrder): PilotQueueItem => {
    const transfer = transferByWorkOrder.get(workOrder._id);
    const statusSince = transfer?.updatedAt ?? workOrder.updatedAt;
    const ageMs = now - new Date(statusSince).getTime();
    const isTerminal = workOrder.status === "DONE" || workOrder.status === "HOLD";
    const stallLevel: StallLevel = isTerminal
      ? "normal"
      : ageMs >= PILOT_STALL_CRITICAL_MS
        ? "critical"
        : ageMs >= PILOT_STALL_WARN_MS
          ? "warn"
          : "normal";
    return { workOrder, transferStatus: transfer?.status ?? null, statusSince, ageMs, stallLevel };
  });
}
