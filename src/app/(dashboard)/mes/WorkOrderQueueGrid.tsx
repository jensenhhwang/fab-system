"use client";

import { useState } from "react";
import type { PilotQueueItemView } from "./pilot-queue-types";
import M20PilotMiniCard from "./M20PilotMiniCard";

export type QueueFilter = "all" | "active" | "stalled" | "done";

export default function WorkOrderQueueGrid({ items, selectedId, onSelect, filter, onFilterChange }: {
  items: PilotQueueItemView[];
  selectedId: string | null;
  onSelect: (workOrderId: string) => void;
  filter: QueueFilter;
  onFilterChange: (filter: QueueFilter) => void;
}) {
  const [showDone, setShowDone] = useState(false);
  if (items.length === 0) return null;

  const activeItems = items.filter((item) => item.workOrder.status !== "DONE");
  const doneItems = items.filter((item) => item.workOrder.status === "DONE");
  const stalledItems = activeItems.filter((item) => item.stallLevel !== "normal");

  const base = filter === "stalled" ? stalledItems : filter === "done" ? doneItems : activeItems;
  const visible = base.slice().sort((a, b) => b.ageMs - a.ageMs);

  const chips: { key: QueueFilter; label: string; count: number }[] = [
    { key: "all", label: "전체", count: items.length },
    { key: "active", label: "진행중", count: activeItems.length },
    { key: "stalled", label: "정체", count: stalledItems.length },
    { key: "done", label: "완료", count: doneItems.length },
  ];

  return (
    <div className="rounded-2xl border border-[#D8DDE2] bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-[0.08em] text-[#8A929A]">M20 PILOT QUEUE</span>
        <div className="ml-auto flex gap-1">
          {chips.map(({ key, label, count }) => (
            <button
              key={key}
              type="button"
              onClick={() => onFilterChange(key)}
              className={`rounded-full px-3 py-1 text-[10px] font-black ${filter === key ? "bg-[#20262D] text-white" : "bg-[#F2F4F6] text-[#59636D]"}`}
            >
              {label} {count}
            </button>
          ))}
        </div>
        <span className="w-full text-[9px] text-[#B0B8BF] sm:w-auto">정체순 정렬 · FOUP 패키징 진입마다 자동 생성</span>
      </div>

      {visible.length === 0 ? (
        <div className="mt-3 py-6 text-center text-[11px] text-[#8A929A]">
          {filter === "stalled" ? "정체 중인 워크오더가 없습니다." : "표시할 워크오더가 없습니다."}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((item) => (
            <M20PilotMiniCard key={item.workOrder._id} item={item} selected={selectedId === item.workOrder._id} onClick={() => onSelect(item.workOrder._id)} />
          ))}
        </div>
      )}

      {filter === "all" && doneItems.length > 0 && (
        <div className="mt-3 border-t border-[#EEF1F4] pt-3">
          <button type="button" onClick={() => setShowDone((prev) => !prev)} className="text-[10px] font-bold text-[#0069B4] underline">
            완료 ({doneItems.length}) {showDone ? "▲" : "▼"}
          </button>
          {showDone && (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {doneItems.slice().sort((a, b) => b.ageMs - a.ageMs).map((item) => (
                <M20PilotMiniCard key={item.workOrder._id} item={item} selected={selectedId === item.workOrder._id} onClick={() => onSelect(item.workOrder._id)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
