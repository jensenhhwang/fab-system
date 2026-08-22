"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type MatDoc = { _id: string; name: string; code: string; unit: string };
type WhDoc = { _id: string; name: string; code: string };
type TaskStatus = "AWAITING_PHYSICAL_CONFIRMATION" | "AWAITING_RECONCILIATION" | "RECONCILED" | "BLOCKED" | "CANCELLED";
type Task = {
  _id: string;
  inboundPlanId: string;
  planNo: string;
  sequence: number;
  materialId: string;
  unit: string;
  plannedDate: string;
  expectedQuantity: number;
  status: TaskStatus;
  version: number;
  physicalConfirmation?: {
    quantity: number;
    warehouseId: string;
    slotId?: string;
    lotNo: string;
    manufactureDate?: string;
    expiryDate?: string;
  };
  events: Array<{ message: string; at: string }>;
};

type Draft = {
  quantity: string;
  warehouseId: string;
  slotId: string;
  lotNo: string;
  manufactureDate: string;
  expiryDate: string;
};

const emptyDraft = (task: Task): Draft => ({
  quantity: String(task.expectedQuantity),
  warehouseId: "",
  slotId: "",
  lotNo: "",
  manufactureDate: "",
  expiryDate: "",
});

export default function InboundReceiptRolePanel({
  matMap,
  whMap,
}: {
  matMap: Record<string, MatDoc>;
  whMap: Record<string, WhDoc>;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [capabilities, setCapabilities] = useState({ physicalConfirm: false, reconcile: false });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIds = useRef<Record<string, string>>({});

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/operations/inbound-receipts", { cache: "no-store", signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "입고 담당 업무를 불러오지 못했습니다.");
      setTasks(payload.tasks ?? []);
      setCapabilities(payload.capabilities ?? { physicalConfirm: false, reconcile: false });
      setError(null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "입고 담당 업무를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const initial = window.setTimeout(() => void load(controller.signal), 0);
    const interval = window.setInterval(() => void load(), 30_000);
    return () => {
      controller.abort();
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [load]);

  const updateDraft = (task: Task, field: keyof Draft, value: string) => {
    setDrafts((current) => ({
      ...current,
      [task._id]: { ...(current[task._id] ?? emptyDraft(task)), [field]: value },
    }));
  };

  const submitPhysical = async (task: Task) => {
    const draft = drafts[task._id] ?? emptyDraft(task);
    const key = `physical:${task._id}`;
    requestIds.current[key] ||= globalThis.crypto.randomUUID();
    setBusyId(task._id);
    setError(null);
    try {
      const response = await fetch(`/api/operations/inbound-receipts/${encodeURIComponent(task._id)}/physical-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: task.version,
          requestId: requestIds.current[key],
          quantity: Number(draft.quantity),
          warehouseId: draft.warehouseId,
          slotId: draft.slotId || undefined,
          lotNo: draft.lotNo,
          manufactureDate: draft.manufactureDate || undefined,
          expiryDate: draft.expiryDate || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "실물 확인에 실패했습니다.");
      delete requestIds.current[key];
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "실물 확인에 실패했습니다.");
    } finally {
      setBusyId(null);
    }
  };

  const submitReconcile = async (task: Task) => {
    const key = `reconcile:${task._id}`;
    requestIds.current[key] ||= globalThis.crypto.randomUUID();
    setBusyId(task._id);
    setError(null);
    try {
      const response = await fetch(`/api/operations/inbound-receipts/${encodeURIComponent(task._id)}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: task.version, requestId: requestIds.current[key] }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "재고 정합 반영에 실패했습니다.");
      delete requestIds.current[key];
      await load();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "재고 정합 반영에 실패했습니다.");
    } finally {
      setBusyId(null);
    }
  };

  const physicalTasks = tasks.filter((task) => task.status === "AWAITING_PHYSICAL_CONFIRMATION");
  const reconciliationTasks = tasks.filter((task) => task.status === "AWAITING_RECONCILIATION");
  const recentEvents = tasks.flatMap((task) => task.events.map((event) => ({ ...event, taskId: task._id })))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 6);
  const warehouses = Object.values(whMap).sort((a, b) => a.code.localeCompare(b.code));

  return (
    <section className="space-y-3">
      <div>
        <div className="text-base font-extrabold text-[#242424]">담당자 입고 실행</div>
        <div className="mt-0.5 text-xs text-[#888]">ETA는 업무만 만들고, 박물류 확인 후 이자재가 검증해야 재고가 반영됩니다.</div>
      </div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border bg-white p-4" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-extrabold text-[#F59E0B]">박물류 · 실물 도착 확인</div>
              <div className="mt-0.5 text-[11px] text-[#999]">확인만 기록하며 재고는 변경하지 않습니다.</div>
            </div>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">대기 {physicalTasks.length}</span>
          </div>
          <div className="mt-3 space-y-3">
            {physicalTasks.length === 0 && <div className="rounded-xl bg-[#F8F7F5] p-5 text-center text-xs text-[#999]">도착 확인 대기 업무가 없습니다.</div>}
            {physicalTasks.map((task) => {
              const draft = drafts[task._id] ?? emptyDraft(task);
              const material = matMap[task.materialId];
              return (
                <div key={task._id} className="rounded-xl border border-amber-100 bg-amber-50/40 p-3">
                  <div className="flex justify-between gap-3 text-xs">
                    <div><b>{task.planNo}</b> · {material?.name ?? task.materialId}</div>
                    <div className="font-bold">예정 {task.expectedQuantity.toLocaleString()} {task.unit}</div>
                  </div>
                  {capabilities.physicalConfirm ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <input aria-label="실물 수량" type="number" min="0.000001" step="any" value={draft.quantity} onChange={(event) => updateDraft(task, "quantity", event.target.value)} className="rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-xs" placeholder="실물 수량" />
                      <select aria-label="입고 시설" value={draft.warehouseId} onChange={(event) => updateDraft(task, "warehouseId", event.target.value)} className="rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-xs">
                        <option value="">입고 시설 선택</option>
                        {warehouses.map((warehouse) => <option key={warehouse._id} value={warehouse._id}>{warehouse.code} · {warehouse.name}</option>)}
                      </select>
                      <input aria-label="Lot 번호" value={draft.lotNo} onChange={(event) => updateDraft(task, "lotNo", event.target.value)} className="rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-xs" placeholder="Lot 번호" />
                      <input aria-label="슬롯" value={draft.slotId} onChange={(event) => updateDraft(task, "slotId", event.target.value)} className="rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-xs" placeholder="슬롯 (선택)" />
                      <input aria-label="제조일" type="date" value={draft.manufactureDate} onChange={(event) => updateDraft(task, "manufactureDate", event.target.value)} className="rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-xs" />
                      <input aria-label="유효기간" type="date" value={draft.expiryDate} onChange={(event) => updateDraft(task, "expiryDate", event.target.value)} className="rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-xs" />
                      <button type="button" disabled={busyId === task._id} onClick={() => void submitPhysical(task)} className="sm:col-span-2 rounded-lg bg-[#F59E0B] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                        {busyId === task._id ? "확인 저장 중…" : "실물 도착 확인"}
                      </button>
                    </div>
                  ) : <div className="mt-3 text-[11px] text-[#999]">박물류 계정이 확인할 업무입니다.</div>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-extrabold text-[#0078D4]">이자재 · 재고 정합 반영</div>
              <div className="mt-0.5 text-[11px] text-[#999]">계획 잔량과 Lot을 다시 검증한 뒤 원장에 반영합니다.</div>
            </div>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">대기 {reconciliationTasks.length}</span>
          </div>
          <div className="mt-3 space-y-3">
            {reconciliationTasks.length === 0 && <div className="rounded-xl bg-[#F8F7F5] p-5 text-center text-xs text-[#999]">정합 검증 대기 업무가 없습니다.</div>}
            {reconciliationTasks.map((task) => {
              const confirmation = task.physicalConfirmation!;
              const material = matMap[task.materialId];
              return (
                <div key={task._id} className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
                  <div className="text-xs"><b>{task.planNo}</b> · {material?.name ?? task.materialId}</div>
                  <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-[#666]">
                    <span>실물 <b>{confirmation.quantity.toLocaleString()} {task.unit}</b></span>
                    <span>Lot <b>{confirmation.lotNo}</b></span>
                    <span>시설 <b>{whMap[confirmation.warehouseId]?.name ?? confirmation.warehouseId}</b></span>
                    <span>슬롯 <b>{confirmation.slotId ?? "미지정"}</b></span>
                  </div>
                  {capabilities.reconcile ? (
                    <button type="button" disabled={busyId === task._id} onClick={() => void submitReconcile(task)} className="mt-3 w-full rounded-lg bg-[#0078D4] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                      {busyId === task._id ? "정합 반영 중…" : "검증 후 재고 반영"}
                    </button>
                  ) : <div className="mt-3 text-[11px] text-[#999]">이자재 계정이 검증할 업무입니다.</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {recentEvents.length > 0 && (
        <div className="rounded-2xl border bg-white px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <div className="text-xs font-bold text-[#555]">최근 담당자 대화 기록</div>
          <div className="mt-2 space-y-1.5">
            {recentEvents.map((event, index) => (
              <div key={`${event.taskId}:${event.at}:${index}`} className="text-[11px] text-[#777]">
                <span className="mr-2 text-[#aaa]">{new Date(event.at).toLocaleString("ko-KR")}</span>{event.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
