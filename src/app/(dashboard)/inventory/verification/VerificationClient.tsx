"use client";

import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";

type VerificationStatus = "AWAITING_OBSERVATION" | "OBSERVED" | "SOURCE_DRIFT";

type VerificationItem = {
  id: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  warehouseId: string;
  expectedQuantity: number;
  uom: string;
  holdLocationId: string;
  reconciliationBatchId: string;
  status: VerificationStatus;
  version: number;
  sourceDrift: boolean;
  createdAt: string;
  observedAt?: string;
  observation: {
    id: string;
    observedQuantity: string;
    uom: string;
    actualLocationId: string;
    evidenceReference: string;
    observedBy: string;
    recordedAt: string;
  } | null;
  actualLocations: Array<{
    id: string;
    code: string;
    type: string;
    status: string;
  }>;
};

type Summary = {
  total: number;
  awaitingObservation: number;
  observed: number;
  sourceDrift: number;
};

const STATUS_LABEL: Record<VerificationStatus, string> = {
  AWAITING_OBSERVATION: "관측 대기",
  OBSERVED: "관측 완료",
  SOURCE_DRIFT: "원본 변경",
};

function formatQuantity(value: number | string): string {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 6 }).format(number)
    : String(value);
}

export default function VerificationClient({
  initialItems,
  initialSummary,
}: {
  initialItems: VerificationItem[];
  initialSummary: Summary;
}) {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canObserve = role === "LOGISTICS";
  const [items, setItems] = useState(initialItems);
  const [summary, setSummary] = useState(initialSummary);
  const [status, setStatus] = useState<"ALL" | VerificationStatus>("ALL");
  const [warehouseId, setWarehouseId] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [observedQuantity, setObservedQuantity] = useState("");
  const [actualLocationId, setActualLocationId] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const warehouses = useMemo(
    () => [...new Set(items.map((item) => item.warehouseId))].sort(),
    [items],
  );
  const visible = items.filter((item) => (
    (status === "ALL" || item.status === status)
    && (warehouseId === "ALL" || item.warehouseId === warehouseId)
  ));
  const selected = items.find((item) => item.id === selectedId) ?? null;

  async function refresh() {
    const response = await fetch("/api/inventory/verification?limit=100", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as { items: VerificationItem[]; summary: Summary };
    setItems(data.items);
    setSummary(data.summary);
  }

  function openObservation(item: VerificationItem) {
    setSelectedId(item.id);
    setObservedQuantity(String(item.expectedQuantity));
    setActualLocationId(item.actualLocations[0]?.id ?? "");
    setEvidenceReference("");
    setMessage("");
  }

  async function submitObservation(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/inventory/verification/${encodeURIComponent(selected.id)}/observation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            expectedVersion: selected.version,
            observedQuantity,
            uom: selected.uom,
            actualLocationId,
            evidenceReference,
          }),
        },
      );
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "관측 제출에 실패했습니다.");
        return;
      }
      setMessage("현장 관측이 불변 증거로 접수됐습니다.");
      await refresh();
      setSelectedId(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="h-full overflow-y-auto p-7" style={{ background: "var(--bg)" }}>
      <div className="mb-6">
        <div className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: "#EA002C" }}>
          Inventory Verification
        </div>
        <h1 className="mt-1 text-2xl font-bold" style={{ color: "var(--text-1)" }}>현장 실물 검증 큐</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-2)" }}>
          HOLD 모델재고를 현장 관측 증거와 연결합니다. 이 단계에서는 재고·LOT·HU를 변경하거나 가용화하지 않습니다.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["전체 Case", summary.total],
          ["관측 대기", summary.awaitingObservation],
          ["관측 완료", summary.observed],
          ["원본 변경", summary.sourceDrift],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border bg-white p-4" style={{ borderColor: "var(--border)" }}>
            <div className="text-xs font-semibold" style={{ color: "var(--text-3)" }}>{label}</div>
            <div className="mt-1 text-2xl font-bold" style={{ color: "var(--text-1)" }}>{value}</div>
          </div>
        ))}
      </section>

      <section className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4" style={{ borderColor: "var(--border)" }}>
        <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="rounded-lg border px-3 py-2 text-sm">
          <option value="ALL">전체 상태</option>
          <option value="AWAITING_OBSERVATION">관측 대기</option>
          <option value="OBSERVED">관측 완료</option>
          <option value="SOURCE_DRIFT">원본 변경</option>
        </select>
        <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="rounded-lg border px-3 py-2 text-sm">
          <option value="ALL">전체 창고</option>
          {warehouses.map((warehouse) => <option key={warehouse} value={warehouse}>{warehouse}</option>)}
        </select>
        <span className="text-xs" style={{ color: "var(--text-3)" }}>
          CSM-016~019는 원단위 미보정으로 큐에서 제외됩니다.
        </span>
      </section>

      {message && (
        <div className="mt-4 rounded-lg bg-[#FFF0F2] px-4 py-3 text-sm text-[#B00020]">{message}</div>
      )}

      <section className="mt-4 overflow-hidden rounded-xl border bg-white" style={{ borderColor: "var(--border)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#F8F6F4] text-xs uppercase" style={{ color: "var(--text-3)" }}>
              <tr>
                <th className="px-4 py-3">자재</th>
                <th className="px-4 py-3">모델 수량</th>
                <th className="px-4 py-3">창고</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">현장 위치</th>
                <th className="px-4 py-3 text-right">액션</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="px-4 py-3">
                    <div className="font-semibold" style={{ color: "var(--text-1)" }}>{item.materialCode}</div>
                    <div className="text-xs" style={{ color: "var(--text-3)" }}>{item.materialName}</div>
                  </td>
                  <td className="px-4 py-3 font-mono">{formatQuantity(item.expectedQuantity)} {item.uom}</td>
                  <td className="px-4 py-3">{item.warehouseId}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      item.status === "OBSERVED" ? "bg-emerald-50 text-emerald-700"
                        : item.status === "SOURCE_DRIFT" ? "bg-red-50 text-red-700"
                          : "bg-amber-50 text-amber-700"
                    }`}>
                      {STATUS_LABEL[item.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {item.observation?.actualLocationId
                      ?? (item.actualLocations.length > 0 ? `${item.actualLocations.length}개 선택 가능` : "실제 위치 미등록")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {item.status === "AWAITING_OBSERVATION" && canObserve ? (
                      <button
                        onClick={() => openObservation(item)}
                        disabled={item.actualLocations.length === 0 || item.sourceDrift}
                        className="rounded-lg bg-[#EA002C] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                      >
                        관측 제출
                      </button>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--text-3)" }}>
                        {item.status === "OBSERVED" ? "검토 대기" : canObserve ? "제출 불가" : "조회 전용"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <form onSubmit={submitObservation} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="text-xs font-bold uppercase tracking-[0.1em] text-[#EA002C]">Physical Observation</div>
            <h2 className="mt-1 text-xl font-bold">{selected.materialCode} 현장 관측</h2>
            <p className="mt-2 text-sm text-gray-500">
              모델 기준 {formatQuantity(selected.expectedQuantity)} {selected.uom}. 제출 후 수정할 수 없습니다.
            </p>
            <label className="mt-5 block text-sm font-semibold">
              관측수량
              <div className="mt-1 flex">
                <input value={observedQuantity} onChange={(event) => setObservedQuantity(event.target.value)} required className="min-w-0 flex-1 rounded-l-lg border px-3 py-2" />
                <span className="rounded-r-lg border border-l-0 bg-gray-50 px-3 py-2 text-sm">{selected.uom}</span>
              </div>
            </label>
            <label className="mt-4 block text-sm font-semibold">
              실제 관측 위치
              <select value={actualLocationId} onChange={(event) => setActualLocationId(event.target.value)} required className="mt-1 w-full rounded-lg border px-3 py-2">
                {selected.actualLocations.map((location) => (
                  <option key={location.id} value={location.id}>{location.code} · {location.type} · {location.status}</option>
                ))}
              </select>
            </label>
            <label className="mt-4 block text-sm font-semibold">
              증빙 참조
              <input
                value={evidenceReference}
                onChange={(event) => setEvidenceReference(event.target.value)}
                required
                placeholder="사진·스캔 기록·작업표 ID"
                className="mt-1 w-full rounded-lg border px-3 py-2"
              />
            </label>
            <p className="mt-4 text-xs text-amber-700">
              이 제출은 관측 증거만 기록하며 HOLD 해제나 수량 조정을 수행하지 않습니다.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setSelectedId(null)} className="rounded-lg border px-4 py-2 text-sm">취소</button>
              <button disabled={submitting} className="rounded-lg bg-[#EA002C] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {submitting ? "제출 중…" : "불변 관측 제출"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
