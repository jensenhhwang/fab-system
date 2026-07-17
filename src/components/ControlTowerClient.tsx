"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useControlContext } from "@/components/ControlContext";
import type {
  ControlTowerMaterial,
  ControlTowerSnapshot,
  CoverageStatus,
  FabId,
} from "@/lib/control-tower";
import { buildTwinHref } from "@/lib/twin-navigation";

const STATUS_STYLE: Record<CoverageStatus, { label: string; color: string; bg: string }> = {
  NORMAL: { label: "정상", color: "#087A55", bg: "#E9F8F2" },
  WARNING: { label: "주의", color: "#A15C00", bg: "#FFF4D8" },
  RISK: { label: "위험", color: "#C2410C", bg: "#FFF0E8" },
  CRITICAL: { label: "긴급", color: "#C51636", bg: "#FFECEF" },
  NO_DEMAND: { label: "수요 없음", color: "#68645F", bg: "#F0EEEB" },
};

function formatQuantity(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits }).format(value);
}

function formatDays(days: number | null) {
  return days === null ? "—" : `${days.toFixed(1)}일`;
}

function StatusBadge({ status }: { status: CoverageStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <span className="rounded-sm px-2 py-1 text-[10px] font-black tracking-[0.08em]" style={{ color: style.color, backgroundColor: style.bg }}>
      {style.label}
    </span>
  );
}

function FabCard({
  snapshot,
  material,
  fabId,
}: {
  snapshot: ControlTowerSnapshot;
  material: ControlTowerMaterial;
  fabId: FabId;
}) {
  const { fabScope, setFabScope } = useControlContext();
  const fab = snapshot.fabs.find((item) => item.id === fabId)!;
  const coverage = material.fabs.find((item) => item.fabId === fabId)!;
  const isDimmed = fabScope !== "CAMPUS" && fabScope !== fabId;

  return (
    <button
      type="button"
      onClick={() => setFabScope(fabScope === fabId ? "CAMPUS" : fabId)}
      className="group min-w-0 border bg-[#FBFAF8] p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-white"
      style={{
        borderColor: fabScope === fabId ? fab.color : "#DEDAD5",
        opacity: isDimmed ? 0.38 : 1,
        boxShadow: fabScope === fabId ? `0 0 0 1px ${fab.color}` : "none",
      }}
      aria-pressed={fabScope === fabId}
    >
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: fab.color }} />
            <span className="text-sm font-black tracking-[-0.02em] text-[#1B1A18]">{fab.id}</span>
          </div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#78736E]">{fab.product} FAB</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-sm font-bold text-[#1B1A18]">{Math.round(fab.effectiveWspm / 1000)}K</div>
          <div className="text-[9px] uppercase tracking-[0.07em] text-[#85807A]">effective WSPM</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-3 border-t border-[#E4E0DB] pt-3">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#85807A]">일 사용량</div>
          <div className="mt-1 font-mono text-[13px] font-bold text-[#272522]">
            {formatQuantity(coverage.dailyUsage)} <span className="text-[9px] font-medium text-[#77716B]">{material.unit}/일</span>
          </div>
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#85807A]">수요 비중</div>
          <div className="mt-1 font-mono text-[13px] font-bold text-[#272522]">{coverage.usageSharePct.toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#85807A]">배분 예정</div>
          <div className="mt-1 font-mono text-[13px] font-bold text-[#272522]">
            {formatQuantity(coverage.plannedAllocation)} <span className="text-[9px] font-medium text-[#77716B]">{material.unit}</span>
          </div>
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#85807A]">예상 잔여</div>
          <div className="mt-1 font-mono text-[13px] font-black" style={{ color: STATUS_STYLE[material.status].color }}>
            {formatDays(coverage.coverageDays)}
          </div>
        </div>
      </div>
    </button>
  );
}

export default function ControlTowerClient({
  snapshot,
  warehouseUtilization,
}: {
  snapshot: ControlTowerSnapshot;
  warehouseUtilization: number;
}) {
  const { fabScope, selectedMaterialId, setSelectedMaterialId } = useControlContext();
  const scopedMaterials = useMemo(() => {
    if (fabScope === "CAMPUS") return snapshot.materials;
    return snapshot.materials.filter((material) => (
      material.fabs.find((fab) => fab.fabId === fabScope)?.dailyUsage ?? 0
    ) > 0);
  }, [fabScope, snapshot.materials]);
  const initialMaterial = scopedMaterials.find((material) => material.coverageDays !== null && material.availableQuantity > 0)
    ?? scopedMaterials.find((material) => material.coverageDays !== null)
    ?? scopedMaterials[0];
  const selectedMaterial = scopedMaterials.find((material) => material.materialId === selectedMaterialId) ?? initialMaterial;
  const actionMaterials = useMemo(
    () => scopedMaterials.filter((material) => material.status !== "NORMAL" && material.status !== "NO_DEMAND").slice(0, 5),
    [scopedMaterials],
  );

  if (!selectedMaterial) {
    return (
      <div className="border border-[#DEDAD5] bg-white p-8 text-sm text-[#6B6762]">
        WMS 재고 데이터가 없어 3FAB 커버리지를 계산할 수 없습니다.
      </div>
    );
  }

  const selectedStatus = STATUS_STYLE[selectedMaterial.status];
  const focusedFab = fabScope === "CAMPUS"
    ? null
    : selectedMaterial.fabs.find((fab) => fab.fabId === fabScope) ?? null;
  const displayQuantity = focusedFab?.plannedAllocation ?? selectedMaterial.availableQuantity;
  const displayDailyUsage = focusedFab?.dailyUsage ?? selectedMaterial.dailyUsage;
  const displayCoverageDays = focusedFab?.coverageDays ?? selectedMaterial.coverageDays;
  const scopeLabel = focusedFab ? `${focusedFab.fabId} FOCUS` : "3FAB CAMPUS";
  const scopeSummary = focusedFab
    ? [
        ["대상 SKU", `${scopedMaterials.length}개`],
        ["선택 자재 일사용량", `${formatQuantity(displayDailyUsage)} ${selectedMaterial.unit}/일`],
        ["WMS 배분 예정", `${formatQuantity(displayQuantity)} ${selectedMaterial.unit}`],
        ["예상 잔여", formatDays(displayCoverageDays)],
      ]
    : [
        ["관리 SKU", `${snapshot.summary.measuredCount} / ${snapshot.summary.materialCount}`],
        ["재고 경보", `${snapshot.summary.warningCount}건`],
        ["5일 미만", `${snapshot.summary.criticalCount}건`],
        ["최단 커버리지", snapshot.summary.minimumCoverageDays === null ? "—" : `${snapshot.summary.minimumCoverageDays.toFixed(1)}일 · ${snapshot.summary.minimumCoverageMaterialCode}`],
      ];
  const sourceLabel = selectedMaterial.usageSource === "PROCESS_PLAN"
    ? "3FAB 공정계획 · 30일 기준"
    : selectedMaterial.usageSource === "INVENTORY_FALLBACK"
      ? "재고 일평균 사용량 보조값"
      : "수요 기준 없음";

  return (
    <div className="mx-auto max-w-[1540px]">
      <section className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.15em] text-[#716C66]">
            <span>3FAB CONTROL PLANE</span>
            <span className="text-[#B2ACA5]">/</span>
            <span>{snapshot.version}</span>
          </div>
          <h1 className="text-[30px] font-black tracking-[-0.045em] text-[#181715]">Campus Control Tower</h1>
          <p className="mt-1 text-xs text-[#6F6A64]">중앙 WMS 재고를 M20·M21·M22의 합산 일사용량으로 환산합니다.</p>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-bold text-[#706B65]">
          <span className="flex items-center gap-1.5 border border-[#BBDDCB] bg-[#EAF8F1] px-2.5 py-1.5 text-[#087A55]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#00A86B]" /> LIVE INVENTORY
          </span>
          <span>{new Date(snapshot.calculatedAt).toLocaleString("ko-KR", { hour12: false })}</span>
        </div>
      </section>

      <section className="mb-4 grid grid-cols-2 border-y border-l border-[#DCD7D1] bg-[#F8F6F3] md:grid-cols-4">
        {scopeSummary.map(([label, value], index) => (
          <div key={label} className="border-r border-[#DCD7D1] px-4 py-3.5" style={{ borderBottom: index < 2 ? undefined : undefined }}>
            <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#87817B]">{label}</div>
            <div className="mt-1 font-mono text-lg font-black tracking-[-0.03em] text-[#24221F]">{value}</div>
          </div>
        ))}
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_310px]">
        <section className="min-w-0 border border-[#D8D3CD] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DEDAD5] px-5 py-3.5">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.11em] text-[#25231F]">1WMS → {focusedFab?.fabId ?? "3FAB"} MATERIAL FLOW</div>
              <div className="mt-1 text-[10px] text-[#817B74]">{scopeLabel} · 공용재 비례배분 기준</div>
            </div>
            <label className="flex items-center gap-2 text-[10px] font-bold text-[#6D6862]">
              기준 자재
              <select
                value={selectedMaterial.materialId}
                onChange={(event) => setSelectedMaterialId(event.target.value)}
                className="min-w-[220px] border border-[#CFCAC4] bg-[#FAF8F5] px-3 py-2 text-xs font-bold text-[#24221F] outline-none focus:border-[#24221F]"
              >
                {scopedMaterials.map((material) => (
                  <option key={material.materialId} value={material.materialId}>
                    {material.code} · {material.name}
                  </option>
                ))}
              </select>
            </label>
            <Link
              href={buildTwinHref("/campus", { fabScope, materialId: selectedMaterial.materialId, mode: "PLAN", cameraPreset: "CAMPUS_OVERVIEW" })}
              onClick={() => setSelectedMaterialId(selectedMaterial.materialId)}
              className="border border-[#24221F] bg-[#24221F] px-3 py-2 text-[10px] font-black tracking-[0.04em] text-white transition-colors hover:bg-black"
            >
              CAMPUS 3D에서 추적 →
            </Link>
          </div>

          <div className="overflow-hidden bg-[linear-gradient(#EDEAE6_1px,transparent_1px),linear-gradient(90deg,#EDEAE6_1px,transparent_1px)] bg-[size:28px_28px] p-5 md:p-8">
            <div className="mx-auto max-w-[960px]">
              <div className="mx-auto w-full max-w-[500px] border border-[#2B2926] bg-[#1E1D1B] p-5 text-white shadow-[0_14px_40px_rgba(0,0,0,0.14)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[9px] font-black uppercase tracking-[0.15em] text-[#B9B4AE]">CENTRAL MATERIAL WMS · {scopeLabel}</div>
                    <div className="mt-1.5 flex items-baseline gap-2">
                      <span className="text-base font-black">{selectedMaterial.code}</span>
                      <span className="truncate text-xs text-[#C9C4BE]">{selectedMaterial.name}</span>
                    </div>
                  </div>
                  <StatusBadge status={selectedMaterial.status} />
                </div>

                <div className="mt-5 grid grid-cols-3 divide-x divide-[#44413D] border-y border-[#44413D] py-3">
                  <div className="pr-3">
                    <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#A9A39D]">{focusedFab ? `${focusedFab.fabId} 배분재고` : "가용재고"}</div>
                    <div className="mt-1 font-mono text-lg font-black">{formatQuantity(displayQuantity)}</div>
                    <div className="text-[9px] text-[#AAA49E]">{selectedMaterial.unit}</div>
                  </div>
                  <div className="px-3">
                    <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#A9A39D]">{focusedFab ? `${focusedFab.fabId} 일사용량` : "3FAB 일사용량"}</div>
                    <div className="mt-1 font-mono text-lg font-black">{formatQuantity(displayDailyUsage)}</div>
                    <div className="text-[9px] text-[#AAA49E]">{selectedMaterial.unit}/일</div>
                  </div>
                  <div className="pl-3">
                    <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#A9A39D]">통합 잔여</div>
                    <div className="mt-1 font-mono text-lg font-black" style={{ color: selectedStatus.color }}>{formatDays(displayCoverageDays)}</div>
                    <div className="text-[9px] text-[#AAA49E]">ROP {selectedMaterial.ropDays}일</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[9px] text-[#AAA49E]">
                  <span>{sourceLabel}</span>
                  <span>계산: {formatQuantity(displayQuantity)} ÷ {formatQuantity(displayDailyUsage)}</span>
                </div>
                {selectedMaterial.excludedQuantity > 0 && (
                  <div className="mt-2 text-[9px] font-bold text-[#FFB4C0]">보류·격리 제외 {formatQuantity(selectedMaterial.excludedQuantity)} {selectedMaterial.unit}</div>
                )}
              </div>

              <div className="relative hidden h-20 md:block" aria-hidden="true">
                <div className="absolute left-1/2 top-0 h-10 w-px -translate-x-1/2 bg-[#77716B]" />
                <div className="absolute left-1/2 top-[36px] h-2 w-2 -translate-x-1/2 rotate-45 border-b border-r border-[#77716B]" />
                <div className="absolute left-[16.666%] right-[16.666%] top-10 h-px bg-[#77716B]" style={{ opacity: focusedFab ? 0.35 : 1 }} />
                {(["M20", "M21", "M22"] as const).map((fabId, index) => (
                  <div
                    key={fabId}
                    className="absolute top-10 bottom-0 w-px -translate-x-1/2"
                    style={{
                      left: ["16.666%", "50%", "83.333%"][index],
                      backgroundColor: !focusedFab || focusedFab.fabId === fabId
                        ? snapshot.fabs.find((fab) => fab.id === fabId)?.color
                        : "#CFC9C2",
                      opacity: !focusedFab || focusedFab.fabId === fabId ? 1 : 0.3,
                    }}
                  />
                ))}
              </div>

              <div className="mb-2 hidden grid-cols-3 gap-4 md:grid">
                {selectedMaterial.fabs.map((fab) => (
                  <div
                    key={fab.fabId}
                    className="text-center font-mono text-[9px] font-bold text-[#6F6963]"
                    style={{ opacity: !focusedFab || focusedFab.fabId === fab.fabId ? 1 : 0.28 }}
                  >
                    ↓ {formatQuantity(fab.plannedAllocation)} {selectedMaterial.unit} · {fab.usageSharePct.toFixed(1)}%
                  </div>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-3 md:gap-4">
                {(["M20", "M21", "M22"] as const).map((fabId) => (
                  <FabCard key={fabId} snapshot={snapshot} material={selectedMaterial} fabId={fabId} />
                ))}
              </div>
            </div>
          </div>

          <div className="grid border-t border-[#DEDAD5] bg-[#F8F6F3] md:grid-cols-3">
            <div className="border-b border-[#DEDAD5] px-4 py-3 md:border-b-0 md:border-r">
              <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#87817B]">현재 범위</div>
              <div className="mt-1 text-xs font-black text-[#262420]">{fabScope}</div>
            </div>
            <div className="border-b border-[#DEDAD5] px-4 py-3 md:border-b-0 md:border-r">
              <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#87817B]">WMS Capacity</div>
              <div className="mt-1 text-xs font-black text-[#262420]">평균 {warehouseUtilization}% 사용</div>
            </div>
            <div className="px-4 py-3">
              <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#87817B]">상태 판정</div>
              <div className="mt-1 text-xs font-black" style={{ color: selectedStatus.color }}>3FAB 합산 수요 기준 {selectedStatus.label}</div>
            </div>
          </div>
        </section>

        <aside className="border border-[#D8D3CD] bg-white">
          <div className="border-b border-[#DEDAD5] px-4 py-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-[11px] font-black uppercase tracking-[0.11em] text-[#25231F]">오늘의 조치</h2>
              <span className="bg-[#FFECEF] px-2 py-1 text-[9px] font-black text-[#C51636]">{actionMaterials.length} PRIORITY</span>
            </div>
            <p className="mt-1 text-[10px] text-[#817B74]">항목을 선택하면 흐름도의 계산 근거가 바뀝니다.</p>
          </div>
          <div className="divide-y divide-[#E6E2DD]">
            {actionMaterials.map((material, index) => {
              const status = STATUS_STYLE[material.status];
              const mainFab = [...material.fabs].sort((a, b) => b.dailyUsage - a.dailyUsage)[0];
              return (
                <button
                  key={material.materialId}
                  type="button"
                  onClick={() => setSelectedMaterialId(material.materialId)}
                  className="w-full px-4 py-4 text-left transition-colors hover:bg-[#FAF8F5]"
                  style={{ backgroundColor: selectedMaterial.materialId === material.materialId ? "#F5F2EE" : undefined }}
                >
                  <div className="flex items-start gap-3">
                    <span className="font-mono text-[10px] font-black text-[#9A948D]">{String(index + 1).padStart(2, "0")}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-black text-[#24221F]">{material.code}</span>
                        <span className="font-mono text-xs font-black" style={{ color: status.color }}>{formatDays(material.coverageDays)}</span>
                      </div>
                      <div className="mt-1 truncate text-[10px] text-[#77716B]">{material.name}</div>
                      <div className="mt-2 text-[10px] font-bold" style={{ color: status.color }}>
                        {material.status === "CRITICAL" ? "긴급 피킹·입고 확인" : "배분 및 입고계획 검토"}
                      </div>
                      <div className="mt-1 text-[9px] text-[#908A83]">최대 수요 {mainFab.fabId} · {mainFab.usageSharePct.toFixed(1)}%</div>
                    </div>
                  </div>
                </button>
              );
            })}
            {actionMaterials.length === 0 && (
              <div className="px-4 py-10 text-center text-xs text-[#817B74]">현재 재고 커버리지 경보가 없습니다.</div>
            )}
          </div>
          <div className="border-t border-[#DEDAD5] bg-[#1E1D1B] px-4 py-4 text-white">
            <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#AFA9A2]">Calculation rule</div>
            <div className="mt-2 font-mono text-[10px] leading-5 text-[#E2DED9]">
              {focusedFab
                ? <>{focusedFab.fabId} 배분재고<br />÷ {focusedFab.fabId} 일사용량<br />= Fab 예상 잔여일</>
                : <>WMS 가용재고<br />÷ (M20 + M21 + M22 일사용량)<br />= 통합 잔여일</>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
