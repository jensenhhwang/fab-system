"use client";

import { useState } from "react";
import type { WorkOrderDoc } from "@/lib/db";
import ProcessReadinessMatrix from "./ProcessReadinessMatrix";

type Tab = "readiness" | "workorders" | "log";

export default function MesClient({
  initialWorkOrders,
}: {
  initialWorkOrders: WorkOrderDoc[];
}) {
  const [tab, setTab] = useState<Tab>("readiness");
  const [workOrders, setWorkOrders] = useState<WorkOrderDoc[]>(initialWorkOrders);

  const TAB_LABELS: { key: Tab; label: string }[] = [
    { key: "readiness", label: "공정 준비 현황" },
    { key: "workorders", label: "작업지시 목록" },
    { key: "log", label: "실행 로그" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: "var(--text-1)" }}>
          공정 실행 관리 (MES)
        </h1>
        <button
          className="px-4 py-2 bg-[#0078D4] text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          onClick={() => {}}
        >
          + 작업지시 생성
        </button>
      </div>

      <div className="flex gap-1 border-b" style={{ borderColor: "var(--border)" }}>
        {TAB_LABELS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? "border-[#0078D4] text-[#0078D4]"
                : "border-transparent hover:text-[#0078D4]"
            }`}
            style={{ color: tab === key ? "#0078D4" : "var(--text-2)" }}
          >
            {label}
          </button>
        ))}
      </div>

      <div>
        {tab === "readiness" && (
          <ProcessReadinessMatrix
            onCellClick={(processCode, product, materialId) => {
              console.log("셀 클릭:", processCode, product, materialId);
            }}
          />
        )}
        {tab === "workorders" && (
          <div className="text-sm text-center py-16" style={{ color: "var(--text-3)" }}>
            작업지시 목록 ({workOrders.length}개) — Task 8에서 구현
          </div>
        )}
        {tab === "log" && (
          <div className="text-sm text-center py-16" style={{ color: "var(--text-3)" }}>
            실행 로그 — Task 10에서 구현
          </div>
        )}
      </div>
    </div>
  );
}
