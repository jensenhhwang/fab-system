import type { TransferOrderStatus, WorkOrderStatus } from "@/lib/db";
import FoupBadge from "./FoupBadge";
import { STALL_LABEL, formatAge, type PilotQueueItemView } from "./pilot-queue-types";

const TRANSFER_STATUS_LABEL: Record<TransferOrderStatus, string> = {
  CREATED: "이송 요청", PICKING: "FEFO 예약·피킹", STAGED: "출고장 대기",
  IN_TRANSIT: "M20 이송 중", RECEIVED: "M20 PRS 도착", DELIVERED: "P10 Line-side 인계",
  CANCELLED: "취소",
};

const STEPS_TOTAL = 6; // PICKED, STAGED, DISPATCHED, RECEIVED, DELIVERED, CONSUMED

function stepsCompleted(transferStatus: TransferOrderStatus | null, workOrderStatus: WorkOrderStatus): number {
  if (workOrderStatus === "DONE") return 6;
  switch (transferStatus) {
    case "DELIVERED": return 5;
    case "RECEIVED": return 4;
    case "IN_TRANSIT": return 3;
    case "STAGED": return 2;
    case "PICKING": return 1;
    default: return 0;
  }
}

const STALL_BORDER: Record<PilotQueueItemView["stallLevel"], string> = {
  normal: "border-[#B9D8F3]",
  warn: "border-[#E8B84B]",
  critical: "border-[#E0525F]",
};

const STALL_BADGE: Record<PilotQueueItemView["stallLevel"], string> = {
  normal: "",
  warn: "bg-[#FFF6E8] text-[#8A5A0A]",
  critical: "bg-[#FDEBEC] text-[#B4232E]",
};

export default function M20PilotMiniCard({ item, selected, onClick }: {
  item: PilotQueueItemView;
  selected: boolean;
  onClick: () => void;
}) {
  const { workOrder, transferStatus, stallLevel, ageMs } = item;
  const done = stepsCompleted(transferStatus, workOrder.status);
  const isDone = workOrder.status === "DONE";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border bg-white p-2.5 text-left transition ${STALL_BORDER[stallLevel]} ${selected ? "ring-2 ring-[#0069B4]" : ""}`}
    >
      <div className="flex items-center justify-between gap-1">
        <FoupBadge foupCode={workOrder.foupCode} />
        {stallLevel !== "normal" && (
          <span className={`rounded px-1.5 py-0.5 text-[8px] font-black ${STALL_BADGE[stallLevel]}`}>
            {STALL_LABEL[stallLevel]} · {formatAge(ageMs)}
          </span>
        )}
      </div>
      <div className="mt-2 flex gap-0.5">
        {Array.from({ length: STEPS_TOTAL }, (_, i) => (
          <span
            key={i}
            className="h-1.5 flex-1 rounded-sm"
            style={{ background: i < done ? (isDone ? "#087A55" : "#0EA5E9") : "#E5E9ED" }}
          />
        ))}
      </div>
      <div className="mt-1.5 truncate text-[9px] font-bold text-[#414A52]">
        {isDone ? "완료" : transferStatus ? TRANSFER_STATUS_LABEL[transferStatus] : "원장 조회 중"}
      </div>
      {stallLevel === "normal" && <div className="mt-0.5 text-[8px] text-[#9AA5AD]">{formatAge(ageMs)}</div>}
    </button>
  );
}
