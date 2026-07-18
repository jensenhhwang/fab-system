"use client";

import type { WorkOrderDoc } from "@/lib/db";
import FoupBadge from "./FoupBadge";
import M20PilotFlowCard from "./M20PilotFlowCard";

export default function PilotFlowDrawer({ workOrder, onClose, onPick, onRefresh }: {
  workOrder: WorkOrderDoc;
  onClose: () => void;
  onPick: () => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 h-full w-[520px] overflow-y-auto bg-white shadow-xl">
        <div className="flex items-start justify-between border-b p-5" style={{ borderColor: "var(--border)" }}>
          <div>
            <div className="flex items-center gap-2">
              <div className="text-sm font-bold" style={{ color: "var(--text-1)" }}>M20 파일럿 흐름</div>
              <FoupBadge foupCode={workOrder.foupCode} />
            </div>
            <div className="mt-0.5 text-xs" style={{ color: "var(--text-3)" }}>{workOrder._id}</div>
          </div>
          <button onClick={onClose} className="mt-0.5 text-xl leading-none text-gray-400 hover:text-gray-600">×</button>
        </div>
        <div className="p-4">
          <M20PilotFlowCard workOrder={workOrder} onPick={onPick} onRefresh={onRefresh} />
        </div>
      </div>
    </>
  );
}
