"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { PROCESSES } from "@/lib/processes";
import { FAB_IDS, type FabId } from "@/lib/fab-domain";
import { getProcessGuide } from "@/lib/process-guide";
import { buildTwinHref, type CameraPreset, type TwinMode } from "@/lib/twin-navigation";
import LotRouteTrackerCard from "./LotRouteTrackerCard";
import type { LiveFoupView } from "@/components/ProcessFlow3D";

const ProcessFlow3D = dynamic(() => import("@/components/ProcessFlow3D"), { ssr: false });

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  GAS: { bg: "#FEE2E2", text: "#B91C1C" },
  CHM: { bg: "#DBEAFE", text: "#1D4ED8" },
  CSM: { bg: "#EDE9FE", text: "#6D28D9" },
  UTL: { bg: "#D1FAE5", text: "#065F46" },
  PKG: { bg: "#F1F5F9", text: "#475569" },
};

const PRODUCT_COLORS: Record<string, string> = {
  HBM:  "#EA002C",
  DRAM: "#0078D4",
  NAND: "#00B96B",
};

const FAB_PRODUCT: Record<FabId, "HBM" | "DRAM" | "NAND"> = {
  M20: "HBM", M21: "DRAM", M22: "NAND",
};

const PRODUCT_FAB: Record<"HBM" | "DRAM" | "NAND", FabId> = {
  HBM: "M20", DRAM: "M21", NAND: "M22",
};

type Material = {
  id: string; code: string; name: string; unit: string; category: string;
  processes: string[]; products: string[];
  usages: { proc: string; product: string; qty: number; actualQty: number }[];
  inventory: { quantity: number; dailyUsage: number; doh: number | null; unit: string } | null;
};

type WarehouseInfo = {
  code: string; name: string; type: string;
  categories: string[]; processCount: number; totalQty: number;
};
type WarehouseLink = { whCode: string; procCode: string; qty: number; category: string };

const CAT_COLOR: Record<string, string> = {
  GAS: "#B91C1C", CHM: "#1D4ED8", CSM: "#7C3AED", UTL: "#059669", PKG: "#64748B",
};

type SortKey = "code" | "name" | "category" | "quantity" | "dailyUsage" | "doh" | "totalQty";
type SortDir = "asc" | "desc";

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  const active = col === sortKey;
  return (
    <span className="inline-flex flex-col ml-1 -translate-y-px">
      <span style={{ opacity: active && sortDir === "asc" ? 1 : 0.25, fontSize: 8, lineHeight: 1 }}>▲</span>
      <span style={{ opacity: active && sortDir === "desc" ? 1 : 0.25, fontSize: 8, lineHeight: 1 }}>▼</span>
    </span>
  );
}

export default function UsageClient({
  materials, warehouseLinks = [], warehouses = [], equipmentByFab,
}: {
  materials: Material[];
  warehouseLinks?: WarehouseLink[];
  warehouses?: WarehouseInfo[];
  equipmentByFab: Record<FabId, Record<string, number>>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fabParam = searchParams.get("fab");
  const twinFab = fabParam && FAB_IDS.includes(fabParam as FabId) ? fabParam as FabId : null;
  const materialParam = searchParams.get("material");
  const twinMode = (searchParams.get("mode") as TwinMode | null) ?? "LIVE";
  const twinCamera = (searchParams.get("camera") as CameraPreset | null) ?? (twinFab ? `${twinFab}_OVERVIEW` as CameraPreset : "CAMPUS_OVERVIEW");
  const [hoveredMat, setHoveredMat] = useState<Material | null>(null);
  const [pinnedMatId, setPinnedMatId] = useState<string | null>(materialParam);
  const [selectedProc, setSelectedProc] = useState<string | null>(() => searchParams.get("process"));
  const [selectedFab, setSelectedFab] = useState<"ALL" | FabId>(() => twinFab ?? "ALL");
  const [liveFoups, setLiveFoups] = useState<LiveFoupView[]>([]);
  const [filterCat, setFilterCat] = useState<string>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const filterProduct = selectedFab === "ALL" ? "ALL" : FAB_PRODUCT[selectedFab];

  function handleSort(col: SortKey) {
    if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(col); setSortDir("asc"); }
  }

  const pinnedMat = materials.find((material) => material.id === pinnedMatId) ?? null;
  const focusedMat = hoveredMat ?? pinnedMat;
  const highlightedProcesses = focusedMat
    ? focusedMat.processes
    : selectedProc
    ? [selectedProc]
    : [];

  const scopedMaterials = selectedFab === "ALL"
    ? materials
    : materials.filter((material) => material.products.includes(FAB_PRODUCT[selectedFab]));
  const activeProcesses = [...new Set(scopedMaterials.flatMap((m) => m.processes))];

  const materialCounts = Object.fromEntries(
    PROCESSES.map((p) => [p.code, scopedMaterials.filter((m) => m.processes.includes(p.code)).length])
  );

  const fabSummaries = FAB_IDS.map((fabId) => {
    const product = FAB_PRODUCT[fabId];
    const fabMaterials = materials.filter((material) => material.products.includes(product));
    const usages = fabMaterials.flatMap((material) => material.usages.filter((usage) => usage.product === product));
    const equipmentTotal = Object.values(equipmentByFab[fabId]).reduce((sum, count) => sum + count, 0);
    return {
      fabId,
      product,
      materialCount: fabMaterials.length,
      processCount: new Set(usages.map((usage) => usage.proc)).size,
      planLinkCount: usages.length,
      actualLinkCount: usages.filter((usage) => usage.actualQty > 0).length,
      equipmentTotal,
    };
  });
  const selectedGuide = selectedProc ? getProcessGuide(selectedProc, selectedFab === "ALL" ? null : selectedFab) : null;
  const guideMaterials = selectedProc ? scopedMaterials.filter((material) => material.usages.some((usage) => (
    usage.proc === selectedProc && (selectedFab === "ALL" || usage.product === FAB_PRODUCT[selectedFab])
  ))) : [];
  const guideEquipment = selectedProc ? (selectedFab === "ALL" ? FAB_IDS : [selectedFab]).map((fabId) => ({
    fabId,
    count: equipmentByFab[fabId][selectedProc] ?? null,
  })) : [];
  const filteredMaterials = materials
    .filter((m) => {
      if (filterProduct !== "ALL" && !m.products.includes(filterProduct)) return false;
      if (filterCat !== "ALL" && m.category !== filterCat) return false;
      if (selectedProc && !m.processes.includes(selectedProc)) return false;
      return true;
    })
    .slice()
    .sort((a, b) => {
      const getTotal = (m: Material) =>
        m.usages.filter((u) => filterProduct === "ALL" || u.product === filterProduct).reduce((s, u) => s + u.qty, 0);
      let cmp = 0;
      switch (sortKey) {
        case "code":      cmp = a.code.localeCompare(b.code); break;
        case "name":      cmp = a.name.localeCompare(b.name); break;
        case "category":  cmp = a.category.localeCompare(b.category); break;
        case "quantity":  cmp = (a.inventory?.quantity ?? -1) - (b.inventory?.quantity ?? -1); break;
        case "dailyUsage": cmp = (a.inventory?.dailyUsage ?? -1) - (b.inventory?.dailyUsage ?? -1); break;
        case "doh":       cmp = (a.inventory?.doh ?? -1) - (b.inventory?.doh ?? -1); break;
        case "totalQty":  cmp = getTotal(a) - getTotal(b); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

  return (
    <>
      <div className="mb-5">
        <div className="uppercase font-bold tracking-[0.08em] mb-1" style={{ fontSize: "11px", color: "var(--text-3)" }}>
          반도체 공정 / 자재 분석
        </div>
        <div className="text-2xl font-bold" style={{ color: "var(--text-1)", letterSpacing: "-0.025em" }}>공정별 사용량</div>
        <div className="text-sm mt-1" style={{ color: "var(--text-3)" }}>
          Fab·공정·자재별 계획 사용량과 최근 30일 실제 소비를 비교합니다
        </div>
      </div>

      <div className="mb-5 grid gap-px overflow-hidden rounded-xl border border-[#DDE2E7] bg-[#DDE2E7] md:grid-cols-3">
        <Link href="/" className="bg-white px-4 py-3 hover:bg-[#F8FAFC]">
          <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#8A929A]">Control Tower · 조치</div>
          <div className="mt-1 text-xs font-black text-[#303840]">부족·지연·우선순위 판단</div>
        </Link>
        <Link href="/campus" className="bg-white px-4 py-3 hover:bg-[#F8FAFC]">
          <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#8A929A]">Digital Twin · 추적</div>
          <div className="mt-1 text-xs font-black text-[#303840]">Lot·HU·이송의 물리 위치 확인</div>
        </Link>
        <div className="bg-[#20262D] px-4 py-3 text-white">
          <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#B9C3CC]">Process Usage · 분석</div>
          <div className="mt-1 text-xs font-black">계획·실사용·차이 원인 분석</div>
        </div>
      </div>

      {(twinFab || materialParam) && (
        <div className="mb-5 flex flex-wrap items-center gap-2 border border-[#B9D8F3] bg-[#F2F8FF] px-4 py-3 text-[11px] text-[#335A78]">
          <span className="font-black text-[#0069B4]">CAMPUS TWIN CONTEXT</span>
          {twinFab && <span className="border-l border-[#B9D8F3] pl-2 font-bold">{twinFab} · {FAB_PRODUCT[twinFab]}</span>}
          {pinnedMat && <span className="font-mono font-bold">{pinnedMat.code} · {pinnedMat.name}</span>}
          <Link
            href={buildTwinHref("/campus", {
              fabScope: twinFab ?? "CAMPUS", materialId: pinnedMatId,
              facilityId: searchParams.get("facility"), lotId: searchParams.get("lot"),
              handlingUnitId: searchParams.get("hu"), alertId: searchParams.get("alert"),
              flowStep: searchParams.get("step"), mode: twinMode,
              referenceTime: searchParams.get("time"), cameraPreset: twinCamera,
            })}
            className="ml-auto font-black text-[#0069B4] hover:underline"
          >
            ← Campus 전체뷰
          </Link>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-[#D8DDE2] bg-white p-2" aria-label="공정별 사용량 Fab 범위">
        <span className="px-2 text-[10px] font-black uppercase tracking-[0.08em] text-[#8A929A]">FAB SCOPE</span>
        {FAB_IDS.map((fabId) => (
          <button
            key={fabId}
            type="button"
            onClick={() => { setSelectedFab(fabId); setSelectedProc(null); }}
            className={`rounded-lg px-4 py-2 text-[11px] font-black ${selectedFab === fabId ? "text-white" : "bg-[#F2F4F6] text-[#59636D]"}`}
            style={selectedFab === fabId ? { background: PRODUCT_COLORS[FAB_PRODUCT[fabId]] } : undefined}
          >
            {fabId} · {FAB_PRODUCT[fabId]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => { setSelectedFab("ALL"); setSelectedProc(null); }}
          className={`rounded-lg px-4 py-2 text-[11px] font-black ${selectedFab === "ALL" ? "bg-[#20262D] text-white" : "bg-[#F2F4F6] text-[#59636D]"}`}
        >
          전체 3FAB
        </button>
        <span className="ml-auto px-2 text-[10px] text-[#7B848D]">직접 진입은 전체 · Twin 연결은 선택 Fab 유지</span>
      </div>

      <section className="mb-5 rounded-2xl border border-[#D8DDE2] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#7D8790]">P01–P10 PROCESS DICTIONARY</div><h2 className="mt-1 text-sm font-black text-[#20262D]">공정 사전</h2><p className="mt-1 text-[10px] text-[#7A848D]">코드 선택 시 목적·설비·자재·관리지표를 표시합니다.</p></div>
          <span className="rounded bg-[#FFF4D8] px-2 py-1 text-[9px] font-black text-[#8A5A00]">MODELED_BASELINE · 기준 공정 모델</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5 lg:grid-cols-10">
          {PROCESSES.map((process) => <button
            key={process.code}
            type="button"
            title={process.activities.join(" · ")}
            onClick={() => setSelectedProc((current) => current === process.code ? null : process.code)}
            className={`rounded-lg border p-2 text-left transition ${selectedProc === process.code ? "text-white" : "bg-[#F7F9FA] text-[#3F4952] hover:bg-white"}`}
            style={selectedProc === process.code ? { background: process.color, borderColor: process.color } : { borderColor: "#DDE2E6" }}
          >
            <div className="font-mono text-[10px] font-black">{process.code}</div>
            <div className="mt-1 text-[10px] font-black">{process.name}</div>
            <div className={`mt-0.5 truncate text-[8px] ${selectedProc === process.code ? "text-white/75" : "text-[#929AA1]"}`}>{process.nameEn}</div>
          </button>)}
        </div>

        {selectedGuide && <div className="mt-4 overflow-hidden rounded-xl border border-[#DDE2E6]">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-white" style={{ background: selectedGuide.color }}>
            <div className="font-mono text-lg font-black">{selectedGuide.code}</div><div><div className="text-sm font-black">{selectedGuide.name}</div><div className="text-[9px] text-white/75">{selectedGuide.nameEn} · {selectedGuide.key}</div></div>
            <div className="ml-auto text-[9px] font-bold text-white/80">이전 {selectedGuide.previousCode ?? "START"} → 현재 → 다음 {selectedGuide.nextCode ?? "END"}</div>
          </div>
          <div className="grid gap-px bg-[#E3E7EA] md:grid-cols-2 lg:grid-cols-4">
            <div className="bg-white p-4 lg:col-span-2"><div className="text-[9px] font-black text-[#8A929A]">공정 목적</div><p className="mt-2 text-[11px] leading-5 text-[#414A52]">{selectedGuide.purpose}</p><div className="mt-3 flex flex-wrap gap-1">{selectedGuide.activities.map((activity) => <span key={activity} className="rounded bg-[#EEF1F4] px-2 py-1 text-[9px] font-bold text-[#59636D]">{activity}</span>)}</div></div>
            <div className="bg-white p-4"><div className="text-[9px] font-black text-[#8A929A]">대표 설비</div><div className="mt-2 space-y-1 text-[10px] font-bold text-[#414A52]">{selectedGuide.equipment.map((equipment) => <div key={equipment}>· {equipment}</div>)}</div><div className="mt-3 text-[9px] text-[#7A848D]">{guideEquipment.map((item) => `${item.fabId} ${item.count === null ? "미연결" : `${item.count}대`}`).join(" · ")}</div></div>
            <div className="bg-white p-4"><div className="text-[9px] font-black text-[#8A929A]">대표 투입 자재</div><div className="mt-2 flex flex-wrap gap-1">{selectedGuide.materialInputs.map((input) => <span key={input} className="rounded bg-[#F2F7FF] px-2 py-1 text-[9px] font-bold text-[#1D5FBF]">{input}</span>)}</div><div className="mt-3 text-[9px] text-[#7A848D]">현재 원장 연결 {guideMaterials.length}종</div></div>
            <div className="bg-white p-4"><div className="text-[9px] font-black text-[#8A929A]">주요 관리지표</div><div className="mt-2 space-y-1 text-[10px] font-bold text-[#414A52]">{selectedGuide.kpis.map((kpi) => <div key={kpi}>· {kpi}</div>)}</div></div>
            <div className="bg-white p-4"><div className="text-[9px] font-black text-[#8A929A]">공정 산출물</div><p className="mt-2 text-[10px] leading-5 text-[#414A52]">{selectedGuide.output}</p></div>
            <div className="bg-[#FFF9EA] p-4 lg:col-span-2"><div className="text-[9px] font-black text-[#8A5A00]">정합성 안내</div><p className="mt-2 text-[10px] leading-5 text-[#74521A]">{selectedGuide.fabNote}</p></div>
          </div>
        </div>}
      </section>

      {/* 공정 흐름도 */}
      <div className="bg-white rounded-2xl p-5 mb-5" style={{ boxShadow: "var(--shadow-1)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-bold text-[#111]">
            {selectedFab === "ALL" ? "3FAB USAGE COMPARISON" : `${selectedFab} · ${FAB_PRODUCT[selectedFab]} 공정 3D`}
          </div>
          <div className="text-[10px] text-[#999]">
            {selectedFab === "ALL" ? "수량 단위는 합산하지 않고 연결 건수로 비교" : "자재 hover → 공정 강조 · 공정 클릭 → 자재 필터"}
          </div>
        </div>

        {/* 자재창고 + 배관 범례 */}
        {warehouses.length > 0 && (
          <div className="flex items-center gap-4 flex-wrap mb-3 px-1">
            <span className="text-[10px] font-semibold text-[#999]">자재창고</span>
            {warehouses.map((wh) => (
              <div key={wh.code} className="flex items-center gap-1.5" title={`${wh.code} · ${wh.name}`}>
                <span className="w-2.5 h-2.5 rounded-sm"
                  style={{ background: CAT_COLOR[wh.categories[0] ?? "GAS"] }} />
                <span className="text-[10px] font-bold text-[#333]">{wh.code}</span>
                <span className="text-[9px] text-[#777]">{wh.name}</span>
                <span className="text-[9px] text-[#aaa]">{wh.processCount}공정</span>
              </div>
            ))}
            <div className="w-px h-3 bg-[#E8E8E8]" />
            <span className="text-[9px] text-[#bbb]">배관 굵기 = 월 사용량 · 색 = 자재 카테고리</span>
          </div>
        )}

        {selectedFab === "ALL" ? (
          <div className="grid gap-3 md:grid-cols-3">
            {fabSummaries.map((summary) => {
              const color = PRODUCT_COLORS[summary.product];
              return <button
                key={summary.fabId}
                type="button"
                onClick={() => setSelectedFab(summary.fabId)}
                className="rounded-xl border-2 bg-[#F9FAFB] p-5 text-left transition hover:-translate-y-0.5 hover:bg-white"
                style={{ borderColor: color }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-black text-[#20262D]">{summary.fabId}</div>
                    <div className="text-[10px] font-black" style={{ color }}>{summary.product}</div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[9px] font-black ${summary.equipmentTotal > 0 ? "bg-[#E9F8F2] text-[#087A55]" : "bg-[#FFF4D8] text-[#8A5A00]"}`}>
                    {summary.equipmentTotal > 0 ? "장비 원장 연결" : "장비 원장 미연결"}
                  </span>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-[10px]">
                  <div><div className="text-[#8A929A]">자재</div><div className="mt-1 font-mono text-base font-black text-[#303840]">{summary.materialCount}종</div></div>
                  <div><div className="text-[#8A929A]">연결 공정</div><div className="mt-1 font-mono text-base font-black text-[#303840]">{summary.processCount}개</div></div>
                  <div><div className="text-[#8A929A]">계획 연결</div><div className="mt-1 font-mono text-base font-black text-[#303840]">{summary.planLinkCount}건</div></div>
                  <div><div className="text-[#8A929A]">30일 실적 확인</div><div className="mt-1 font-mono text-base font-black text-[#087A55]">{summary.actualLinkCount}건</div></div>
                </div>
                <div className="mt-4 border-t border-[#DDE2E7] pt-3 text-[10px] font-bold text-[#68737D]">
                  장비 Capacity · {summary.equipmentTotal > 0 ? `${summary.equipmentTotal.toLocaleString()}대` : "미연결"} → 상세 보기
                </div>
              </button>;
            })}
          </div>
        ) : <div className={selectedFab === "M20" ? "grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]" : undefined}>
          <div className="relative" style={{ height: 480 }}>
            <Suspense fallback={<div className="w-full h-full bg-[#e8f0f8] rounded-2xl flex items-center justify-center text-sm text-[#999]">3D 로딩 중…</div>}>
              <ProcessFlow3D
                fabId={selectedFab}
                highlightedProcesses={highlightedProcesses}
                activeProcesses={activeProcesses}
                onProcessClick={(code) =>
                  setSelectedProc((prev) => (prev === code ? null : code))
                }
                onWarehouseClick={(code) => router.push(buildTwinHref(`/warehouse/${code}`, {
                  fabScope: selectedFab, materialId: pinnedMatId,
                  facilityId: code, lotId: searchParams.get("lot"), handlingUnitId: searchParams.get("hu"),
                  alertId: searchParams.get("alert"), flowStep: searchParams.get("step"), mode: twinMode,
                  referenceTime: searchParams.get("time"), cameraPreset: "WMS_OVERVIEW",
                }))}
                materialCounts={materialCounts}
                warehouses={warehouses}
                warehouseLinks={warehouseLinks}
                equipmentCounts={equipmentByFab[selectedFab]}
                liveFoups={selectedFab === "M20" ? liveFoups : []}
              />
            </Suspense>

            {/* hover 중인 자재 상세 — absolute overlay라 레이아웃에 영향 없음 */}
            <div
              className="absolute bottom-0 left-0 right-0 rounded-b-2xl overflow-hidden pointer-events-none transition-opacity duration-150"
              style={{ opacity: focusedMat ? 1 : 0, background: "rgba(15,23,42,0.92)", backdropFilter: "blur(6px)" }}
            >
              {focusedMat && (
                <div className="p-4">
                  <div className="text-[10px] text-slate-400 font-mono mb-0.5">{focusedMat.code}</div>
                  <div className="text-sm font-bold text-white mb-2">{focusedMat.name}</div>
                  <div className="flex flex-wrap gap-4">
                    {focusedMat.usages.map((u, i) => {
                      const proc = PROCESSES.find((p) => p.code === u.proc);
                      return (
                        <div key={i} className="flex items-center gap-2 text-[11px]">
                          <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: proc?.color }} />
                          <span className="text-slate-300">{u.proc} {proc?.name}</span>
                          <span className="text-slate-500">{u.product}</span>
                          <span className="font-bold text-white">{u.qty.toLocaleString()}</span>
                          <span className="font-bold text-emerald-300">실적 {u.actualQty.toLocaleString()}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
          {selectedFab === "M20" && <LotRouteTrackerCard fabId="M20" product="HBM" onLiveFoupsChange={setLiveFoups} />}
        </div>}
      </div>

      {/* 자재 테이블 */}
      <div className="bg-white rounded-2xl overflow-hidden" data-testid="material-table" style={{ boxShadow: "var(--shadow-1)", border: "1px solid var(--border)" }}>
        {/* 필터 */}
        <div className="px-5 py-3 flex items-center gap-3 flex-wrap" style={{ borderBottom: "1px solid var(--border)" }}>
          <span className="rounded-full bg-[#20262D] px-2.5 py-1 text-[10px] font-black text-white">{selectedFab === "ALL" ? "전체 3FAB" : `${selectedFab} · ${filterProduct}`}</span>
          <span className="text-[11px] font-semibold text-[#999]">카테고리</span>
          {["ALL", "GAS", "CHM", "CSM", "UTL", "PKG"].map((c) => {
            const s = c !== "ALL" ? CATEGORY_STYLES[c] : null;
            return (
              <button
                key={c}
                onClick={() => setFilterCat(c)}
                className="text-[11px] font-bold px-2.5 py-1 rounded-full border transition-all"
                style={
                  filterCat === c
                    ? { background: s?.text ?? "#111", color: "#fff", borderColor: "transparent" }
                    : { background: s?.bg ?? "#fff", color: s?.text ?? "#555", borderColor: s?.bg ?? "#E8E8E8" }
                }
              >
                {c}
              </button>
            );
          })}
        </div>

        {/* 선택된 공정 배너 */}
        {selectedProc && (
          <div className="px-5 py-3 bg-[#FFF0F2] border-b border-[#FFD6DA] flex items-center gap-3">
            <span className="text-xs font-black text-[#EA002C]">{selectedProc}</span>
            <span className="text-xs text-[#EA002C] font-semibold">
              {PROCESSES.find((p) => p.code === selectedProc)?.name} — {filteredMaterials.length}종 자재 사용
            </span>
            <button
              onClick={() => router.push(`/mes?process=${selectedProc}`)}
              className="px-3 py-1 text-[10px] font-bold bg-[#EA002C] text-white rounded-full hover:bg-red-700 transition-colors"
            >
              MES 공정 준비 보기 →
            </button>
            <button
              onClick={() => setSelectedProc(null)}
              className="ml-auto text-[10px] text-[#EA002C] hover:underline"
            >
              선택 해제
            </button>
          </div>
        )}

        <table className="w-full text-xs">
          <thead>
            <tr style={{ backgroundColor: "var(--bg-page)", borderBottom: "1px solid var(--border)" }}>
              {(
                [
                  { col: "code"       as SortKey | null, label: "품번",     align: "left"  as const, px: "px-5" },
                  { col: "name"       as SortKey | null, label: "자재명",   align: "left"  as const, px: "px-4" },
                  { col: "category"   as SortKey | null, label: "구분",     align: "left"  as const, px: "px-4" },
                  { col: "quantity"   as SortKey | null, label: "현재고",   align: "right" as const, px: "px-4" },
                  { col: "dailyUsage" as SortKey | null, label: "일소요량", align: "right" as const, px: "px-4" },
                  { col: "doh"        as SortKey | null, label: "보관일수", align: "left"  as const, px: "px-4" },
                  { col: null,                           label: "적용 공정", align: "left"  as const, px: "px-4" },
                  { col: null,                           label: "Fab / 생산제품", align: "left" as const, px: "px-4" },
                  { col: "totalQty"   as SortKey | null, label: "월 소요량", align: "right" as const, px: "px-4" },
                  { col: null,                           label: "30일 실사용", align: "right" as const, px: "px-4" },
                  { col: null,                           label: "계획-실적 차이", align: "right" as const, px: "px-4" },
                ]
              ).map(({ col, label, align, px }) => (
                <th key={label} className={`${px} py-3`}>
                  {col ? (
                    <button
                      onClick={() => handleSort(col)}
                      className={`uppercase font-bold tracking-[0.06em] select-none transition-colors flex items-center gap-0.5 ${align === "right" ? "ml-auto" : ""}`}
                      style={{ fontSize: "11px", color: sortKey === col ? "var(--text-1)" : "var(--text-3)" }}
                    >
                      {label}
                      <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
                    </button>
                  ) : (
                    <span className={`uppercase font-bold tracking-[0.06em] flex ${align === "right" ? "justify-end" : ""}`} style={{ fontSize: "11px", color: "var(--text-3)" }}>{label}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredMaterials.map((mat) => {
              const cat = CATEGORY_STYLES[mat.category] ?? { bg: "#F5F5F5", text: "#666" };
              const totalQty = mat.usages
                .filter((u) => filterProduct === "ALL" || u.product === filterProduct)
                .reduce((s, u) => s + u.qty, 0);
              const actualQty = mat.usages
                .filter((u) => filterProduct === "ALL" || u.product === filterProduct)
                .reduce((sum, usage) => sum + usage.actualQty, 0);
              const usageGap = totalQty - actualQty;
              const isHovered = hoveredMat?.id === mat.id;
              const isPinned = pinnedMat?.id === mat.id;

              return (
                <tr
                  key={mat.id}
                  onMouseEnter={() => setHoveredMat(mat)}
                  onMouseLeave={() => setHoveredMat(null)}
                  onClick={() => setPinnedMatId((current) => current === mat.id ? null : mat.id)}
                  className="transition-colors cursor-pointer"
                  style={{ background: isHovered ? "#FFF5F5" : isPinned ? "#F2F8FF" : "transparent", borderBottom: "1px solid var(--border)" }}
                >
                  <td className="px-5 py-2.5 font-mono text-[11px] text-[#999]">{mat.code}</td>
                  <td className="px-4 py-2.5 font-semibold text-[#111]">{mat.name}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: cat.bg, color: cat.text }}
                    >
                      {mat.category}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-[#111]">
                    {mat.inventory
                      ? mat.inventory.doh === null && mat.inventory.quantity === 0
                        ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#D1FAE5] text-[#065F46]">현장생산</span>
                        : <>{mat.inventory.quantity.toLocaleString()} <span className="text-[#999] font-normal text-[10px]">{mat.inventory.unit}</span></>
                      : <span className="text-[#999]">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[#999] tabular-nums">
                    {mat.inventory && mat.inventory.dailyUsage > 0
                      ? `${mat.inventory.dailyUsage}/${mat.inventory.unit}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {mat.inventory?.doh != null ? (
                      (() => {
                        const doh = mat.inventory.doh;
                        const color = doh < 5 ? "#EA002C" : doh < 14 ? "#F7A600" : "#00B96B";
                        return (
                          <span className="text-xs font-bold tabular-nums" style={{ color }}>
                            {doh.toFixed(1)}일
                          </span>
                        );
                      })()
                    ) : <span className="text-[#999] text-xs">현장생산</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {mat.processes.length === 0 ? (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#D1FAE5] text-[#065F46]">시설 전체</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {mat.processes.sort().map((p) => {
                          const proc = PROCESSES.find((pr) => pr.code === p);
                          return (
                            <button
                              key={p}
                              type="button"
                              onClick={(event) => { event.stopPropagation(); setSelectedProc((current) => current === p ? null : p); }}
                              className="rounded px-1.5 py-0.5 text-[9px] font-bold text-white transition-colors"
                              style={{ background: selectedProc === p ? proc?.color ?? "#999" : isHovered || isPinned ? proc?.color ?? "#999" : "#cbd5e1" }}
                            >
                              {p} · {proc?.name ?? "미등록"}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1 flex-wrap">
                      {mat.products.length === 0 ? (
                        <span className="text-[9px] text-[#999]">전 제품</span>
                      ) : mat.products.toSorted((a, b) => {
                        const aIndex = a === "HBM" || a === "DRAM" || a === "NAND" ? FAB_IDS.indexOf(PRODUCT_FAB[a]) : FAB_IDS.length;
                        const bIndex = b === "HBM" || b === "DRAM" || b === "NAND" ? FAB_IDS.indexOf(PRODUCT_FAB[b]) : FAB_IDS.length;
                        return aIndex - bIndex;
                      }).map((pr) => (
                        <span
                          key={pr}
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white"
                          style={{ background: PRODUCT_COLORS[pr] }}
                        >
                          {pr === "HBM" || pr === "DRAM" || pr === "NAND" ? `${PRODUCT_FAB[pr]} · ${pr}` : pr}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                    {totalQty.toLocaleString()}
                    {mat.inventory?.unit && <span className="text-[#999] font-normal text-[10px] ml-0.5">{mat.inventory.unit}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums text-[#087A55]">
                    {actualQty > 0 ? <>
                      {actualQty.toLocaleString()}
                      {mat.inventory?.unit && <span className="ml-0.5 text-[10px] font-normal text-[#6F8D82]">{mat.inventory.unit}</span>}
                    </> : totalQty > 0
                      ? <span className="whitespace-nowrap rounded bg-[#FFF4D8] px-1.5 py-1 text-[9px] font-black text-[#8A5A00]">최근 30일 없음</span>
                      : <span className="whitespace-nowrap rounded bg-[#EEF1F4] px-1.5 py-1 text-[9px] font-black text-[#6F7881]">미연결</span>}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${actualQty === 0 ? "text-[#9AA1A8]" : usageGap >= 0 ? "text-[#1D5FBF]" : "text-[#C51636]"}`}>
                    {actualQty > 0 ? <>
                      {usageGap > 0 ? "+" : ""}{usageGap.toLocaleString()}
                      {mat.inventory?.unit && <span className="ml-0.5 text-[10px] font-normal">{mat.inventory.unit}</span>}
                    </> : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
