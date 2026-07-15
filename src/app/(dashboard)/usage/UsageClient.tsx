"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { PROCESSES } from "@/lib/processes";

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

type Material = {
  id: string; code: string; name: string; category: string;
  processes: string[]; products: string[];
  usages: { proc: string; product: string; qty: number }[];
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
  materials, warehouseLinks = [], warehouses = [],
}: {
  materials: Material[];
  warehouseLinks?: WarehouseLink[];
  warehouses?: WarehouseInfo[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [hoveredMat, setHoveredMat] = useState<Material | null>(null);
  const [selectedProc, setSelectedProc] = useState<string | null>(() => searchParams.get("process"));
  const [filterProduct, setFilterProduct] = useState<"ALL" | "HBM" | "DRAM" | "NAND">("ALL");
  const [filterCat, setFilterCat] = useState<string>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function handleSort(col: SortKey) {
    if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(col); setSortDir("asc"); }
  }

  const highlightedProcesses = hoveredMat
    ? hoveredMat.processes
    : selectedProc
    ? [selectedProc]
    : [];

  const activeProcesses = [...new Set(materials.flatMap((m) => m.processes))];

  const materialCounts = Object.fromEntries(
    PROCESSES.map((p) => [p.code, materials.filter((m) => m.processes.includes(p.code)).length])
  );

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
          자재에 커서를 올리면 해당 공정이 흐름도에 하이라이트됩니다
        </div>
      </div>

      {/* 공정 흐름도 */}
      <div className="bg-white rounded-2xl p-5 mb-5" style={{ boxShadow: "var(--shadow-1)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-bold text-[#111]">
            반도체 공정 흐름도 + 자재 공급망 (Fab Process &amp; Material Flow)
          </div>
          <div className="text-[10px] text-[#999]">
            자재 hover → 공정 하이라이트 · 공정 클릭 → 자재 필터 · 창고 hover → 공급 배관 강조
          </div>
        </div>

        {/* 자재창고 + 배관 범례 */}
        {warehouses.length > 0 && (
          <div className="flex items-center gap-4 flex-wrap mb-3 px-1">
            <span className="text-[10px] font-semibold text-[#999]">자재창고</span>
            {warehouses.map((wh) => (
              <div key={wh.code} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm"
                  style={{ background: CAT_COLOR[wh.categories[0] ?? "GAS"] }} />
                <span className="text-[10px] font-bold text-[#333]">{wh.code}</span>
                <span className="text-[9px] text-[#aaa]">{wh.processCount}공정</span>
              </div>
            ))}
            <div className="w-px h-3 bg-[#E8E8E8]" />
            <span className="text-[9px] text-[#bbb]">배관 굵기 = 월 사용량 · 색 = 자재 카테고리</span>
          </div>
        )}

        {/* 3D 캔버스 + hoveredMat 패널을 relative 컨테이너 안에 묶어서 레이아웃 시프트 완전 차단 */}
        <div className="relative" style={{ height: 480 }}>
          <Suspense fallback={<div className="w-full h-full bg-[#e8f0f8] rounded-2xl flex items-center justify-center text-sm text-[#999]">3D 로딩 중…</div>}>
            <ProcessFlow3D
              highlightedProcesses={highlightedProcesses}
              activeProcesses={activeProcesses}
              onProcessClick={(code) =>
                setSelectedProc((prev) => (prev === code ? null : code))
              }
              onWarehouseClick={(code) => router.push(`/warehouse/${code}`)}
              materialCounts={materialCounts}
              warehouses={warehouses}
              warehouseLinks={warehouseLinks}
            />
          </Suspense>

          {/* hover 중인 자재 상세 — absolute overlay라 레이아웃에 영향 없음 */}
          <div
            className="absolute bottom-0 left-0 right-0 rounded-b-2xl overflow-hidden pointer-events-none transition-opacity duration-150"
            style={{ opacity: hoveredMat ? 1 : 0, background: "rgba(15,23,42,0.92)", backdropFilter: "blur(6px)" }}
          >
            {hoveredMat && (
              <div className="p-4">
                <div className="text-[10px] text-slate-400 font-mono mb-0.5">{hoveredMat.code}</div>
                <div className="text-sm font-bold text-white mb-2">{hoveredMat.name}</div>
                <div className="flex flex-wrap gap-4">
                  {hoveredMat.usages.map((u, i) => {
                    const proc = PROCESSES.find((p) => p.code === u.proc);
                    return (
                      <div key={i} className="flex items-center gap-2 text-[11px]">
                        <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: proc?.color }} />
                        <span className="text-slate-300">{u.proc} {proc?.name}</span>
                        <span className="text-slate-500">{u.product}</span>
                        <span className="font-bold text-white">{u.qty.toLocaleString()}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 자재 테이블 */}
      <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "var(--shadow-1)", border: "1px solid var(--border)" }}>
        {/* 필터 */}
        <div className="px-5 py-3 flex items-center gap-3 flex-wrap" style={{ borderBottom: "1px solid var(--border)" }}>
          <span className="text-[11px] font-semibold text-[#999]">제품</span>
          {(["ALL", "HBM", "DRAM", "NAND"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setFilterProduct(p)}
              className="text-[11px] font-bold px-2.5 py-1 rounded-full border transition-all"
              style={
                filterProduct === p
                  ? { background: p === "ALL" ? "#111" : PRODUCT_COLORS[p], color: "#fff", borderColor: "transparent" }
                  : { background: "#fff", color: "#555", borderColor: "#E8E8E8" }
              }
            >
              {p}
            </button>
          ))}
          <div className="w-px h-4 bg-[#E8E8E8]" />
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
                  { col: null,                           label: "제품",     align: "left"  as const, px: "px-4" },
                  { col: "totalQty"   as SortKey | null, label: "월 소요량", align: "right" as const, px: "px-4" },
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
              const isHovered = hoveredMat?.id === mat.id;

              return (
                <tr
                  key={mat.id}
                  onMouseEnter={() => setHoveredMat(mat)}
                  onMouseLeave={() => setHoveredMat(null)}
                  className="transition-colors cursor-pointer"
                  style={{ background: isHovered ? "#FFF5F5" : "transparent", borderBottom: "1px solid var(--border)" }}
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
                            <span
                              key={p}
                              className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white"
                              style={{ background: isHovered ? proc?.color ?? "#999" : "#cbd5e1" }}
                            >
                              {p}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1 flex-wrap">
                      {mat.products.length === 0 ? (
                        <span className="text-[9px] text-[#999]">전 제품</span>
                      ) : mat.products.map((pr) => (
                        <span
                          key={pr}
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white"
                          style={{ background: PRODUCT_COLORS[pr] }}
                        >
                          {pr}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                    {totalQty.toLocaleString()}
                    {mat.inventory?.unit && <span className="text-[#999] font-normal text-[10px] ml-0.5">{mat.inventory.unit}</span>}
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
