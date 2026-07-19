"use client";

import { useState, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import type { WorkOrderDoc, WorkOrderStatus } from "@/lib/db";
import ProcessReadinessMatrix from "./ProcessReadinessMatrix";
import WorkOrderTable from "./WorkOrderTable";
import WorkOrderCreateModal from "./WorkOrderCreateModal";
import PickingDrawer from "./PickingDrawer";
import PilotFlowDrawer from "./PilotFlowDrawer";
import WorkOrderStallBanner from "./WorkOrderStallBanner";
import WorkOrderQueueGrid, { type QueueFilter } from "./WorkOrderQueueGrid";
import type { PilotQueueItemView } from "./pilot-queue-types";

type Tab = "readiness" | "workorders" | "log";

const STATUS_DOT: Record<WorkOrderStatus, string> = {
  QUEUED:        "bg-gray-400",
  MATERIAL_WAIT: "bg-amber-500",
  RUNNING:       "bg-blue-500",
  DONE:          "bg-green-500",
  HOLD:          "bg-red-500",
};

const STATUS_LABEL: Record<WorkOrderStatus, string> = {
  QUEUED:        "대기",
  MATERIAL_WAIT: "자재 대기",
  RUNNING:       "실행 중",
  DONE:          "완료",
  HOLD:          "홀드",
};

export default function MesClient({
  initialWorkOrders,
}: {
  initialWorkOrders: WorkOrderDoc[];
}) {
  const searchParams = useSearchParams();
  const processParam = searchParams.get("process");
  const [tab, setTab] = useState<Tab>(processParam ? "readiness" : "readiness");
  const [workOrders, setWorkOrders] = useState<WorkOrderDoc[]>(initialWorkOrders);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pickingWo, setPickingWo] = useState<WorkOrderDoc | null>(null);
  const [logLoaded, setLogLoaded] = useState(false);
  const [pilotCreating, setPilotCreating] = useState(false);
  const [pilotError, setPilotError] = useState<string | null>(null);
  const [pilotQueue, setPilotQueue] = useState<PilotQueueItemView[]>([]);
  const [selectedPilotWoId, setSelectedPilotWoId] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");

  const TAB_LABELS: { key: Tab; label: string }[] = [
    { key: "readiness", label: "공정 준비 현황" },
    { key: "workorders", label: "작업지시 목록" },
    { key: "log", label: "실행 로그" },
  ];

  const refreshWorkOrders = useCallback(async () => {
    const r = await fetch("/api/mes/workorders");
    if (r.ok) setWorkOrders(await r.json());
  }, []);

  const refreshPilotQueue = useCallback(async () => {
    const r = await fetch("/api/mes/pilot-queue");
    if (r.ok) setPilotQueue(await r.json());
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshWorkOrders(), refreshPilotQueue()]);
  }, [refreshWorkOrders, refreshPilotQueue]);

  useEffect(() => {
    if (tab !== "workorders") return;
    const initial = window.setTimeout(() => void refreshPilotQueue(), 0);
    const interval = window.setInterval(() => { if (!document.hidden) void refreshPilotQueue(); }, 6_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [tab, refreshPilotQueue]);

  const selectTab = useCallback(async (nextTab: Tab) => {
    setTab(nextTab);
    if (nextTab === "log" && !logLoaded) {
      await refreshWorkOrders();
      setLogLoaded(true);
    }
  }, [logLoaded, refreshWorkOrders]);

  const handleStatusChange = useCallback(async (id: string, status: WorkOrderStatus) => {
    await fetch(`/api/mes/workorders/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await refreshAll();
  }, [refreshAll]);

  const sortedLog = [...workOrders].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  const selectedPilotItem = pilotQueue.find((item) => item.workOrder._id === selectedPilotWoId) ?? null;
  const createPilot = async () => {
    setPilotCreating(true);
    setPilotError(null);
    try {
      const response = await fetch("/api/mes/workorders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          processCode: "P10", operationCode: "MUF_MOLDING_CURE", product: "HBM", fabId: "M20", plannedQty: 1,
          scope: "M20_PILOT", materialId: "PKG-001", requestId: crypto.randomUUID(),
          note: "M20 대표 수직 흐름 · 자재 1종/Lot 1개/HU 1개",
        }),
      });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        setPilotError(payload.error ?? "M20 대표 작업지시 생성 실패");
        return;
      }
      const created = await response.json() as WorkOrderDoc;
      await refreshAll();
      setSelectedPilotWoId(created._id);
      setTab("workorders");
    } finally {
      setPilotCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: "var(--text-1)" }}>
          공정 실행 관리 (MES)
        </h1>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void createPilot()} disabled={pilotCreating} className="border border-[#0069B4] bg-[#F2F8FF] px-4 py-2 text-sm font-black text-[#0069B4] disabled:opacity-50">{pilotCreating ? "M20 원장 생성 중…" : "+ M20 에이전트 흐름"}</button>
          <button className="px-4 py-2 bg-[#0078D4] text-white text-sm font-medium rounded-lg hover:bg-blue-700" onClick={() => setShowCreateModal(true)}>+ 작업지시 생성</button>
        </div>
      </div>

      <div className="flex gap-1 border-b" style={{ borderColor: "var(--border)" }}>
        {TAB_LABELS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => void selectTab(key)}
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
        {pilotError && <div className="mb-3 border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{pilotError}</div>}
        {tab === "readiness" && (
          <ProcessReadinessMatrix
            onCellClick={(processCode, product) => {
              const existingWo = workOrders.find(
                w => w.processCode === processCode && w.product === product && w.status === "MATERIAL_WAIT"
              );
              if (existingWo) {
                setPickingWo(existingWo);
              } else {
                setTab("workorders");
              }
            }}
            highlightProcess={processParam}
          />
        )}
        {tab === "workorders" && (
          <div className="space-y-4">
            <WorkOrderStallBanner items={pilotQueue} onShowStalled={() => setQueueFilter("stalled")} />
            <WorkOrderQueueGrid
              items={pilotQueue}
              selectedId={selectedPilotWoId}
              onSelect={setSelectedPilotWoId}
              filter={queueFilter}
              onFilterChange={setQueueFilter}
            />
            <WorkOrderTable workOrders={workOrders} onStatusChange={handleStatusChange} onPickClick={(wo) => setPickingWo(wo)} />
          </div>
        )}
        {tab === "log" && (
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-1)" }}>
              작업지시 실행 이력 ({sortedLog.length}건)
            </h3>
            <div className="space-y-0 max-h-[600px] overflow-y-auto">
              {sortedLog.length === 0 ? (
                <p className="text-sm text-center py-12" style={{ color: "var(--text-3)" }}>이력 없음</p>
              ) : (
                sortedLog.map(wo => (
                  <div
                    key={wo._id}
                    className="flex items-start gap-3 py-3 border-b last:border-0 text-xs"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${STATUS_DOT[wo.status]}`} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium font-mono" style={{ color: "var(--text-1)" }}>{wo._id}</div>
                      <div className="mt-0.5" style={{ color: "var(--text-3)" }}>
                        {wo.processCode} · {wo.product} · {wo.plannedQty}런 ·{" "}
                        <span className="font-medium" style={{ color: "var(--text-2)" }}>
                          {STATUS_LABEL[wo.status]}
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right" style={{ color: "var(--text-3)" }}>
                      <div>{new Date(wo.updatedAt).toLocaleDateString("ko-KR")}</div>
                      <div>{new Date(wo.updatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
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
          onPicked={refreshAll}
        />
      )}

      {selectedPilotItem && (
        <PilotFlowDrawer
          workOrder={selectedPilotItem.workOrder}
          onClose={() => setSelectedPilotWoId(null)}
          onPick={() => setPickingWo(selectedPilotItem.workOrder)}
          onRefresh={refreshAll}
        />
      )}
    </div>
  );
}
