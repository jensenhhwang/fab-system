"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentRole, AgentRoleMode, WorkOrderDoc, TransferOrderStatus } from "@/lib/db";
import type { ProcessEquipmentSummary } from "@/lib/equipment-capacity";
import type { M20FabEquipmentMaster } from "@/lib/m20-equipment-capacity-plan";

type FlowData = {
  workOrder: WorkOrderDoc;
  transfers: Array<{ id?: string; _id: string; materialId: string; quantity: number; unit: string; status: TransferOrderStatus; lotId?: string; handlingUnitId?: string }>;
  events: Array<{ _id: string; type: string; sequence?: number; occurredAt: string }>;
  handlingUnits: Array<{ _id: string; logisticsStatus?: string; currentLocationId?: string }>;
  stocks: Array<{ _id: string; locationType: "PRS" | "LINE_SIDE"; quantity: number; unit: string }>;
  equipment: ProcessEquipmentSummary[];
  equipmentDefinition: M20FabEquipmentMaster | null;
  agents: null | {
    run: null | { status: string; stage: string; nextHumanAction?: string; blockedReason?: string | null; lastTrigger?: "AUTO" | "MANUAL"; updatedAt?: string };
    decisions: AgentDecisionView[];
    purchaseOrder: null | {
      _id: string; poNo: string; supplierId: string; quantity: number; unit: string; unitPrice: number; currency: string;
      leadTimeDays: number; expectedDate: string; status: string; policyVersion: string;
      calculation: { onHand: number; activeReservations: number; confirmedInbound: number; projectedAvailable: number; policyTarget: number; shortage: number };
    };
    outbox: null | { _id: string; status: string };
    assignment: null | { equipmentId: string; capacitySource: string; status: string };
    roleModes: null | Record<AgentRole, AgentRoleMode>;
  };
};

type AgentDecisionView = { _id: string; agentRole: AgentRole; reasonCodes: string[]; proposedAction: string; result: string; createdAt: string };

const AGENT_LABEL: Record<AgentRole, string> = { PROCUREMENT: "발주 담당", WMS: "WMS 담당", MES: "MES 담당", PROCESS: "공정 담당" };
const AGENT_ORDER: AgentRole[] = ["PROCUREMENT", "WMS", "MES", "PROCESS"];

const STATUS_LABEL: Record<TransferOrderStatus, string> = {
  CREATED: "이송 요청", PICKING: "FEFO 예약·피킹", STAGED: "출고장 대기",
  IN_TRANSIT: "M20 이송 중", RECEIVED: "M20 PRS 도착", DELIVERED: "P10 Line-side 인계",
  CANCELLED: "취소",
};

export default function M20PilotFlowCard({ workOrder, onPick, onRefresh }: {
  workOrder: WorkOrderDoc;
  onPick: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [flow, setFlow] = useState<FlowData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRoles, setExpandedRoles] = useState<Set<AgentRole>>(new Set());
  const load = useCallback(async () => {
    const response = await fetch(`/api/mes/workorders/${workOrder._id}/flow`, { cache: "no-store" });
    if (response.ok) setFlow(await response.json());
  }, [workOrder._id]);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => { if (!document.hidden) void load(); }, 5_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [load]);
  const transfer = flow?.transfers[0];
  const liveWorkOrder = flow?.workOrder ?? workOrder;
  const line = liveWorkOrder.bomLines[0];
  const totalEquipment = useMemo(() => flow?.equipment.reduce((sum, process) => sum + process.total, 0) ?? 0, [flow?.equipment]);
  const picked = flow?.events.some((event) => event.type === "PICKED") ?? false;
  const runOnHold = flow?.agents?.run?.status === "HUMAN_MODE_HOLD";
  const nextLabel = !transfer ? null
    : transfer.status === "CREATED" && runOnHold ? null
      : transfer.status === "CREATED" ? "에이전트 조율 재시도"
      : transfer.status === "PICKING" && !picked ? "현장 피킹 완료 확인"
        : transfer.status === "PICKING" ? "출고장 STAGED 확인"
          : transfer.status === "STAGED" ? "운송 출발 확인"
            : transfer.status === "IN_TRANSIT" ? "M20 PRS 도착 확인"
              : transfer.status === "RECEIVED" ? "P10 Line-side 인계 확인"
                : transfer.status === "DELIVERED" && liveWorkOrder.status === "MATERIAL_WAIT" && runOnHold ? null
                  : transfer.status === "DELIVERED" && liveWorkOrder.status !== "DONE" ? "P10 공정 투입·소비 확인"
                    : null;

  const advance = async () => {
    if (!transfer || !nextLabel) return;
    if (transfer.status === "PICKING" && !picked) { onPick(); return; }
    setBusy(true);
    setError(null);
    try {
      const requestId = crypto.randomUUID();
      const response = transfer.status === "CREATED"
        ? await fetch(`/api/agents/m20/${workOrder._id}`, { method: "POST" })
        : transfer.status === "DELIVERED"
        ? await fetch(`/api/mes/workorders/${workOrder._id}/consume`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ materialId: transfer.materialId, requestId }),
          })
        : await fetch(`/api/twin/transfers/${transfer._id}/transition`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status: transfer.status === "PICKING" ? "STAGED" : transfer.status === "STAGED" ? "IN_TRANSIT" : transfer.status === "IN_TRANSIT" ? "RECEIVED" : "DELIVERED",
              requestId,
              ...(transfer.status === "STAGED" ? { eta: new Date(Date.now() + 120_000).toISOString() } : {}),
            }),
          });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        setError(payload.error ?? "상태 전이에 실패했습니다.");
        return;
      }
      await Promise.all([load(), onRefresh()]);
    } finally {
      setBusy(false);
    }
  };

  const runOrchestrateNow = async () => {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/agents/m20/${workOrder._id}`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        setError(payload.error ?? "에이전트 실행에 실패했습니다.");
        return;
      }
      await Promise.all([load(), onRefresh()]);
    } finally {
      setBusy(false);
    }
  };

  const toggleRoleMode = async (role: AgentRole) => {
    const current = flow?.agents?.roleModes?.[role] ?? "AGENT";
    const nextMode: AgentRoleMode = current === "AGENT" ? "HUMAN" : "AGENT";
    const message = nextMode === "HUMAN"
      ? `${AGENT_LABEL[role]} 역할을 HUMAN 모드로 전환할까요? 이후 자동 발동 시 이 역할은 실행되지 않고 사람의 "지금 실행"을 기다립니다.`
      : `${AGENT_LABEL[role]} 역할을 다시 AGENT 자동 모드로 전환할까요?`;
    if (!window.confirm(message)) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/agents/mode", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, mode: nextMode }),
      });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        setError(payload.error ?? "역할 모드 전환에 실패했습니다.");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const toggleExpanded = (role: AgentRole) => {
    setExpandedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role); else next.add(role);
      return next;
    });
  };

  const decidePo = async (action: "APPROVE" | "REJECT") => {
    const po = flow?.agents?.purchaseOrder;
    if (!po) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/procurement/purchase-orders/${encodeURIComponent(po._id)}/approval`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        setError(payload.error ?? "발주 승인 처리에 실패했습니다.");
        return;
      }
      await load();
    } finally { setBusy(false); }
  };

  const decisionsByRole = new Map<AgentRole, AgentDecisionView[]>();
  for (const decision of flow?.agents?.decisions ?? []) {
    const list = decisionsByRole.get(decision.agentRole) ?? [];
    list.push(decision);
    decisionsByRole.set(decision.agentRole, list);
  }

  return (
    <section className="border border-[#B9D8F3] bg-[#F7FBFF] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.12em] text-[#1D5F91]">M20 VERTICAL SLICE · 1 MATERIAL / 1 LOT / 1 HU</div>
          <div className="mt-1 text-sm font-black text-[#183B56]">{workOrder._id}</div>
          <div className="mt-1 text-[10px] text-[#5E7A90]">P10 HBM · {line?.materialId} · 계획 {line?.plannedQty ?? 0} · 피킹 {line?.pickedQty ?? line?.actualQty ?? 0} · 소비 {line?.consumedQty ?? 0}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-black text-[#1D5F91]">{transfer ? STATUS_LABEL[transfer.status] : "원장 조회 중"}</div>
          <div className="mt-1 text-[9px] text-[#72889A]">M20 현재 원장 {totalEquipment.toLocaleString()}대 · 정의 {flow?.equipmentDefinition?.totalEquipment ?? "-"} modeled tools · Reserve 15%</div>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        {["PICKED", "STAGED", "DISPATCHED", "RECEIVED", "DELIVERED", "CONSUMED"].map((type) => {
          const done = flow?.events.some((event) => event.type === type);
          return <div key={type} className={`border px-2 py-2 text-center text-[9px] font-black ${done ? "border-[#72C6A7] bg-[#E9F8F2] text-[#087A55]" : "border-[#D8E1E8] bg-white text-[#8A99A5]"}`}>{type}</div>;
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[9px] text-[#657D90]">
        <span>HU {transfer?.handlingUnitId ?? "미예약"}</span>
        <span>Lot {transfer?.lotId ?? "미예약"}</span>
        {flow?.stocks.map((stock) => <span key={stock._id}>{stock.locationType} {stock.quantity.toLocaleString()} {stock.unit}</span>)}
      </div>
      <div className="mt-4 border-t border-[#CFE0EE] pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] font-black uppercase tracking-[0.12em] text-[#183B56]">RULE AGENTS · {flow?.agents?.run?.status ?? "NOT STARTED"}</div>
          <div className="text-[9px] text-[#657D90]">
            정책 M20_AGENT_POLICY_V1 · 물리 실적 자동완료 금지
            {flow?.agents?.run?.lastTrigger && <> · {flow.agents.run.lastTrigger === "AUTO" ? "자동 발동" : "수동 실행"}{flow.agents.run.updatedAt ? ` (${new Date(flow.agents.run.updatedAt).toLocaleTimeString()})` : ""}</>}
          </div>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          {AGENT_ORDER.map((role) => {
            const history = decisionsByRole.get(role) ?? [];
            const latest = history[history.length - 1];
            const mode = flow?.agents?.roleModes?.[role] ?? "AGENT";
            const isHeld = latest?.result === "HUMAN_MODE_HOLD";
            const expanded = expandedRoles.has(role);
            return <div key={role} className="border border-[#D8E6F0] bg-white p-2">
              <div className="flex items-center justify-between gap-1">
                <div className="text-[10px] font-black text-[#1D5F91]">{AGENT_LABEL[role]}</div>
                <button
                  type="button" disabled={busy} onClick={() => void toggleRoleMode(role)}
                  className={`shrink-0 px-1.5 py-0.5 text-[8px] font-black disabled:opacity-50 ${mode === "HUMAN" ? "border border-[#D9A441] bg-[#FFF6E8] text-[#8A5A0A]" : "border border-[#8FBF9F] bg-[#EAF7EE] text-[#1F7A44]"}`}
                >
                  {mode === "HUMAN" ? "🧑 HUMAN" : "🤖 AGENT"}
                </button>
              </div>
              <div className="mt-1 text-[9px] font-bold text-[#344F63]">{latest?.result ?? "대기"}</div>
              <div className="mt-1 line-clamp-2 text-[8px] leading-4 text-[#718596]">{latest?.reasonCodes.join(" · ") ?? "실행 전"}</div>
              {isHeld && (
                <button type="button" disabled={busy} onClick={() => void runOrchestrateNow()} className="mt-1 w-full bg-[#0069B4] px-1.5 py-1 text-[8px] font-black text-white disabled:opacity-50">
                  지금 실행
                </button>
              )}
              {history.length > 1 && (
                <button type="button" onClick={() => toggleExpanded(role)} className="mt-1 text-[8px] font-bold text-[#5E7A90] underline">
                  이력 {history.length}건 {expanded ? "▲" : "▼"}
                </button>
              )}
              {expanded && history.length > 1 && (
                <div className="mt-1 space-y-0.5 border-t border-[#E4EDF4] pt-1">
                  {history.slice(0, -1).reverse().map((d) => (
                    <div key={d._id} className="text-[8px] text-[#8DA0AF]">
                      {new Date(d.createdAt).toLocaleTimeString()} · {d.result} · {d.reasonCodes.join(" · ")}
                    </div>
                  ))}
                </div>
              )}
            </div>;
          })}
        </div>
        {flow?.agents?.assignment && <div className="mt-2 bg-[#EEF7FF] px-3 py-2 text-[9px] text-[#275879]">공정 배정 · <b>{flow.agents.assignment.equipmentId}</b> · {flow.agents.assignment.capacitySource === "MODELED_BASELINE" ? "모델 Capacity" : "MES Master"} · {flow.agents.assignment.status}</div>}
        {flow?.agents?.run?.blockedReason && <div className="mt-2 bg-amber-50 px-3 py-2 text-[9px] font-bold text-amber-800">차단 사유 · {flow.agents.run.blockedReason}</div>}
      </div>
      {flow?.agents?.purchaseOrder && <div className="mt-4 border border-[#D9CCF3] bg-[#FBF9FF] p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black text-[#6332A8]">발주 초안 · {flow.agents.purchaseOrder.poNo}</div>
            <div className="mt-1 text-[9px] text-[#6F6380]">{flow.agents.purchaseOrder.supplierId} · {flow.agents.purchaseOrder.quantity.toLocaleString()} {flow.agents.purchaseOrder.unit} · LT {flow.agents.purchaseOrder.leadTimeDays}일 · {flow.agents.purchaseOrder.policyVersion}</div>
            <div className="mt-1 text-[8px] text-[#877A96]">가용전망 {flow.agents.purchaseOrder.calculation.projectedAvailable.toLocaleString()} / 정책목표 {flow.agents.purchaseOrder.calculation.policyTarget.toLocaleString()} · 부족 {flow.agents.purchaseOrder.calculation.shortage.toLocaleString()} · MOQ/배수 적용</div>
          </div>
          <div className="text-right text-[9px] font-black text-[#6332A8]">{flow.agents.purchaseOrder.status}<div className="mt-1 text-[8px] font-normal text-[#877A96]">Outbox {flow.agents.outbox?.status ?? "미생성"}</div></div>
        </div>
        {flow.agents.purchaseOrder.status === "PENDING_APPROVAL" && <div className="mt-3 flex gap-2">
          <button type="button" disabled={busy} onClick={() => void decidePo("APPROVE")} className="bg-[#6332A8] px-3 py-1.5 text-[10px] font-black text-white disabled:opacity-50">발주 승인 · Outbox 적재</button>
          <button type="button" disabled={busy} onClick={() => void decidePo("REJECT")} className="border border-[#B9A5D8] bg-white px-3 py-1.5 text-[10px] font-black text-[#6332A8] disabled:opacity-50">반려</button>
        </div>}
      </div>}
      {error && <div className="mt-3 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {nextLabel && <button type="button" onClick={() => void advance()} disabled={busy} className="mt-4 bg-[#0069B4] px-4 py-2 text-xs font-black text-white disabled:opacity-50">{busy ? "원장 처리 중…" : nextLabel}</button>}
      {!nextLabel && liveWorkOrder.status === "DONE" && <div className="mt-4 bg-[#087A55] px-4 py-2 text-center text-xs font-black text-white">M20 대표 흐름 완주 · 수직 원장 연결 완료</div>}
    </section>
  );
}
