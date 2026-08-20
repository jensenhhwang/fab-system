"use client";

import { useCallback, useEffect, useState } from "react";
import type { FabId } from "@/lib/fab-domain";

type Product = "HBM" | "DRAM" | "NAND";

type DensityBucket = {
  nodeId: string;
  order: number;
  label: string;
  stage: string;
  cycle: string[];
  repeatCount: number;
  stepRange: [number, number];
  count: number;
  watchedCount: number;
  percentOfTotal: number;
};

type NodeDensityResponse = {
  fabId: FabId;
  product: Product;
  routeMasterId: string;
  routeVersion: string;
  routeSummary: { nodeCount: number; totalSteps: number };
  wipConnection: "CONNECTED" | "NOT_CONNECTED";
  unit: "LOT" | "FOUP_EQUIVALENT";
  execution: {
    status: "RUNNING" | "PAUSED" | "HOLD";
    ownerName: string;
    lastRunAt: string | null;
    lastMovedQuantity: number;
    lastCompletedQuantity: number;
    speedMultiplier: number;
    heartbeat: "LIVE" | "STALE" | "WAITING";
    source: "MODELED_BASELINE";
    holdReason: string | null;
  } | null;
  asOf: string;
  total: number;
  summary: { watchedTotal: number; modeledTotal: number };
  buckets: DensityBucket[];
};

const STAGE_COLOR: Record<string, string> = {
  FRONT_END: "#2a78d6",
  TEST: "#1baf7a",
  TSV_FRONT: "#eda100",
  BACKGRIND: "#008300",
  TSV_BACK: "#4a3aa7",
  SINGULATION: "#e34948",
  ASSEMBLY: "#e87ba4",
  PACKAGING: "#eb6834",
  PERIPHERAL: "#7C3AED",
  CELL_STACK: "#0891B2",
};
const DEFAULT_STAGE_COLOR = "#8A929A";

export default function FabNodeDensityCard({ fabId, product }: { fabId: FabId; product: Product }) {
  const [density, setDensity] = useState<NodeDensityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/wafer-lots/node-density?fabId=${fabId}&product=${product}`, { cache: "no-store", signal });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error ?? "노드 밀도 조회 실패");
        return;
      }
      setError(null);
      setDensity(await response.json() as NodeDensityResponse);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "노드 밀도 조회 실패");
    }
  }, [fabId, product]);

  useEffect(() => {
    const controller = new AbortController();
    const initial = window.setTimeout(() => void load(controller.signal), 0);
    const interval = window.setInterval(() => { if (!document.hidden) void load(controller.signal); }, 30_000);
    return () => { controller.abort(); window.clearTimeout(initial); window.clearInterval(interval); };
  }, [load]);

  if (error) return <div className="rounded-xl border border-[#D8DDE2] bg-white p-4 text-[11px] text-[#EA002C]">{error}</div>;
  if (!density) return <div className="rounded-xl border border-[#D8DDE2] bg-white p-4 text-[11px] text-[#999]">노드 밀도 로딩 중…</div>;

  const maxCount = Math.max(1, ...density.buckets.map((bucket) => bucket.count));
  const stagesInOrder = [...new Set(density.buckets.map((bucket) => bucket.stage))];
  const quantityLabel = density.unit === "FOUP_EQUIVALENT" ? "FOUP-eq" : "건";

  return (
    <div className="rounded-xl border border-[#D8DDE2] bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-black uppercase tracking-[0.08em] text-[#7D8790]">FAB 노드 밀도 · {fabId} · ROUTE 위치 분포</div>
        <div className="font-mono text-[9px] text-[#8A929A]">
          총 {density.total.toLocaleString(undefined, { maximumFractionDigits: 1 })} {quantityLabel} · WATCHED {density.summary.watchedTotal} · MODELED {density.summary.modeledTotal.toLocaleString(undefined, { maximumFractionDigits: 1 })} · {new Date(density.asOf).toLocaleTimeString()} 기준
        </div>
      </div>
      <div className="mt-1 text-[9px] leading-4 text-[#8A929A]">
        Route {density.routeSummary.nodeCount}노드 · 펼친 전체 {density.routeSummary.totalSteps}스텝 · {density.routeVersion}
      </div>

      {density.wipConnection === "NOT_CONNECTED" ? (
        <div className="mt-2 rounded-lg border border-[#F0D99A] bg-[#FFF9E8] px-3 py-2 text-[9px] font-bold text-[#7A5A00]">
          Route Master 연결 · 실행 WIP 원장 미연결 — 아래 0건은 실제 공정의 재공이 0이라는 뜻이 아닙니다.
        </div>
      ) : (
        <div className="mt-2 text-[9px] leading-4 text-[#8A929A]">
          실측 이벤트가 없는 로트는 공정 단계별 밀도로만 표시합니다 — 개별 위치가 아닌 분포입니다.
        </div>
      )}

      {density.execution && (
        <div className={`mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-[9px] font-bold ${density.execution.status === "RUNNING" && density.execution.heartbeat === "LIVE" ? "border-[#A9E4CF] bg-[#EFFBF7] text-[#087A55]" : "border-[#F0D99A] bg-[#FFF9E8] text-[#7A5A00]"}`}>
          <span>{density.execution.ownerName} · {density.execution.status} · {density.execution.heartbeat}</span>
          <span>운영시간 {density.execution.speedMultiplier}× (실제 1시간 = 운영 1일)</span>
          <span>최근 이동 {density.execution.lastMovedQuantity.toLocaleString(undefined, { maximumFractionDigits: 1 })} FOUP-eq</span>
          <span>완료·재투입 {density.execution.lastCompletedQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} FOUP-eq</span>
          <span>마지막 Tick {density.execution.lastRunAt ? new Date(density.execution.lastRunAt).toLocaleTimeString() : "대기 중"}</span>
          {density.execution.holdReason && <span>HOLD · {density.execution.holdReason}</span>}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[8px] font-bold text-[#59636D]">
        {stagesInOrder.map((stage) => (
          <span key={stage} className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: STAGE_COLOR[stage] ?? DEFAULT_STAGE_COLOR }} />
            {stage}
          </span>
        ))}
      </div>

      <div className="mt-3 space-y-0.5">
        {density.buckets.map((bucket) => {
          const color = STAGE_COLOR[bucket.stage] ?? DEFAULT_STAGE_COLOR;
          const widthPct = bucket.count > 0 ? Math.max(2, (bucket.count / maxCount) * 100) : 0;
          return (
            <div
              key={bucket.nodeId}
              title={`${bucket.label} · ${bucket.cycle.join("→")} × ${bucket.repeatCount} · step ${bucket.stepRange[0]}–${bucket.stepRange[1]}`}
              className="flex items-center gap-2"
              style={{ height: 22 }}
            >
              <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
              <span className="w-[110px] shrink-0 truncate font-mono text-[9px] text-[#59636D]">{bucket.nodeId}</span>
              <span className={`h-2.5 flex-1 overflow-hidden rounded-full ${bucket.count > 0 ? "bg-[#F2F4F6]" : "border border-dashed border-[#E3E7EB]"}`}>
                {bucket.count > 0 && <span className="block h-full rounded-full transition-all" style={{ width: `${widthPct}%`, background: color }} />}
              </span>
              <span className={`w-[80px] shrink-0 text-right font-mono text-[9px] font-black ${bucket.count > 0 ? "text-[#303840]" : "text-[#B0B8BF]"}`}>
                {bucket.count.toLocaleString(undefined, { maximumFractionDigits: 1 })} · {bucket.percentOfTotal.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>

      {density.wipConnection === "CONNECTED" && (
        <div className="mt-2 text-[9px] leading-4 text-[#8A929A]">
          일부 노드는 여러 스텝을 반복하는 공정이라 다른 노드 대비 체류량이 구조적으로 큽니다. 특정 노드 집중이 곧 병목을 뜻하진 않습니다 — 체류시간(dwell) 데이터와 함께 판단하세요.
        </div>
      )}
    </div>
  );
}
