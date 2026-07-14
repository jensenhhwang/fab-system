"use client";

import { useState, useCallback } from "react";
import type { WorkOrderDoc, WorkOrderStatus } from "@/lib/db";
import ProcessReadinessMatrix from "./ProcessReadinessMatrix";
import WorkOrderTable from "./WorkOrderTable";
import WorkOrderCreateModal from "./WorkOrderCreateModal";
import PickingDrawer from "./PickingDrawer";

type Tab = "readiness" | "workorders" | "log";

export default function MesClient({
  initialWorkOrders,
}: {
  initialWorkOrders: WorkOrderDoc[];
}) {
  const [tab, setTab] = useState<Tab>("readiness");
  const [workOrders, setWorkOrders] = useState<WorkOrderDoc[]>(initialWorkOrders);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pickingWo, setPickingWo] = useState<WorkOrderDoc | null>(null);

  const TAB_LABELS: { key: Tab; label: string }[] = [
    { key: "readiness", label: "공정 준비 현황" },
    { key: "workorders", label: "작업지시 목록" },
    { key: "log", label: "실행 로그" },
  ];

  const refreshWorkOrders = useCallback(async () => {
    const r = await fetch("/api/mes/workorders");
    if (r.ok) setWorkOrders(await r.json());
  }, []);

  const handleStatusChange = useCallback(async (id: string, status: WorkOrderStatus) => {
    await fetch(`/api/mes/workorders/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await refreshWorkOrders();
  }, [refreshWorkOrders]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: "var(--text-1)" }}>
          공정 실행 관리 (MES)
        </h1>
        <button
          className="px-4 py-2 bg-[#0078D4] text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          onClick={() => setShowCreateModal(true)}
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
              tab === key ? "border-[#0078D4] text-[#0078D4]" : "border-transparent"
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
            onCellClick={(_processCode, _product, _materialId) => {
              setTab("workorders");
            }}
          />
        )}
        {tab === "workorders" && (
          <WorkOrderTable
            workOrders={workOrders}
            onStatusChange={handleStatusChange}
            onPickClick={(wo) => setPickingWo(wo)}
          />
        )}
        {tab === "log" && (
          <div className="text-sm text-center py-16" style={{ color: "var(--text-3)" }}>
            실행 로그 — Task 10에서 구현
          </div>
        )}
      </div>

      {showCreateModal && (
        <WorkOrderCreateModal
          onClose={() => setShowCreateModal(false)}
          onCreated={refreshWorkOrders}
        />
      )}

      {pickingWo && (
        <PickingDrawer
          wo={pickingWo}
          onClose={() => setPickingWo(null)}
          onPicked={refreshWorkOrders}
        />
      )}
    </div>
  );
}
