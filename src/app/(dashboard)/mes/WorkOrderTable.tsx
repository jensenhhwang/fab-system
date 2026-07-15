"use client";

import type { WorkOrderDoc, WorkOrderStatus } from "@/lib/db";
import { PROCESSES } from "@/lib/processes";

const STATUS_STYLE: Record<WorkOrderStatus, string> = {
  QUEUED:        "bg-gray-100 text-gray-600",
  MATERIAL_WAIT: "bg-amber-100 text-amber-700",
  RUNNING:       "bg-blue-100 text-blue-700",
  DONE:          "bg-green-100 text-green-700",
  HOLD:          "bg-red-100 text-red-700",
};

const STATUS_LABEL: Record<WorkOrderStatus, string> = {
  QUEUED:        "대기",
  MATERIAL_WAIT: "자재 대기",
  RUNNING:       "실행 중",
  DONE:          "완료",
  HOLD:          "홀드",
};

const ROW_BG: Partial<Record<WorkOrderStatus, string>> = {
  MATERIAL_WAIT: "bg-amber-50",
  RUNNING:       "bg-blue-50",
};

export default function WorkOrderTable({
  workOrders,
  onStatusChange,
  onPickClick,
}: {
  workOrders: WorkOrderDoc[];
  onStatusChange: (id: string, status: WorkOrderStatus) => Promise<void>;
  onPickClick: (wo: WorkOrderDoc) => void;
}) {
  if (workOrders.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-12 text-center text-sm" style={{ color: "var(--text-3)" }}>
        작업지시가 없습니다. 상단 &quot;+ 작업지시 생성&quot; 버튼으로 추가하세요.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b" style={{ borderColor: "var(--border)" }}>
            {["WO 번호", "공정", "품목", "계획 수량", "상태", "생성일", "액션"].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "var(--text-3)" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {workOrders.map(wo => (
            <tr
              key={wo._id}
              className={`border-b hover:opacity-90 transition-opacity ${ROW_BG[wo.status] ?? ""}`}
              style={{ borderColor: "var(--border)" }}
            >
              <td className="px-4 py-3 font-mono text-xs" style={{ color: "var(--text-3)" }}>
                {wo._id}
              </td>
              <td className="px-4 py-3" style={{ color: "var(--text-1)" }}>
                <div className="font-medium text-xs leading-tight">
                  {PROCESSES.find(p => p.code === wo.processCode)?.name ?? wo.processCode}
                </div>
                <div className="font-mono text-[10px] text-gray-400">{wo.processCode}</div>
              </td>
              <td className="px-4 py-3" style={{ color: "var(--text-2)" }}>
                {wo.product}
              </td>
              <td className="px-4 py-3" style={{ color: "var(--text-2)" }}>
                {wo.plannedQty}런
              </td>
              <td className="px-4 py-3">
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[wo.status]}`}>
                  {STATUS_LABEL[wo.status]}
                </span>
              </td>
              <td className="px-4 py-3 text-xs" style={{ color: "var(--text-3)" }}>
                {new Date(wo.createdAt).toLocaleDateString("ko-KR")}
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-2 flex-wrap">
                  {wo.status === "MATERIAL_WAIT" && (
                    <button
                      onClick={() => onPickClick(wo)}
                      className="px-3 py-1 text-xs bg-[#0078D4] text-white rounded-lg hover:bg-blue-700"
                    >
                      자재 피킹
                    </button>
                  )}
                  {wo.status === "QUEUED" && (
                    <button
                      onClick={() => onStatusChange(wo._id, "RUNNING")}
                      className="px-3 py-1 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      실행 시작
                    </button>
                  )}
                  {wo.status === "RUNNING" && (
                    <button
                      onClick={() => onStatusChange(wo._id, "DONE")}
                      className="px-3 py-1 text-xs bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                    >
                      완료
                    </button>
                  )}
                  {(wo.status === "QUEUED" || wo.status === "RUNNING" || wo.status === "MATERIAL_WAIT") && (
                    <button
                      onClick={() => onStatusChange(wo._id, "HOLD")}
                      className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
                    >
                      홀드
                    </button>
                  )}
                  {wo.status === "HOLD" && (
                    <button
                      onClick={() => onStatusChange(wo._id, "QUEUED")}
                      className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                    >
                      해제
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
