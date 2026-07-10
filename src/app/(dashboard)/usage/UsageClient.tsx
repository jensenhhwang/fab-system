"use client";

import { useState, Suspense } from "react";
import dynamic from "next/dynamic";
import { PROCESSES } from "@/components/ProcessFlow3D";

// Three.js는 SSR 불가 → dynamic import
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
};

export default function UsageClient({ materials }: { materials: Material[] }) {
  const [hoveredMat, setHoveredMat] = useState<Material | null>(null);
  const [selectedProc, setSelectedProc] = useState<string | null>(null);
  const [filterProduct, setFilterProduct] = useState<"ALL" | "HBM" | "DRAM" | "NAND">("ALL");
  const [filterCat, setFilterCat] = useState<string>("ALL");

  const highlightedProcesses = hoveredMat ? hoveredMat.processes : selectedProc ? [selectedProc] : [];
  const activeProcesses = [...new Set(materials.flatMap((m) => m.processes))];

  const filteredMaterials = materials.filter((m) => {
    if (filterProduct !== "ALL" && !m.products.includes(filterProduct)) return false;
    if (filterCat !== "ALL" && m.category !== filterCat) return false;
    return true;
  });

  const selectedProcMaterials = selectedProc
    ? materials.filter((m) => m.processes.includes(selectedProc))
    : [];

  return (
    <>
      <div className="mb-1 text-2xl font-extrabold tracking-tight">공정별 사용량</div>
      <div className="text-sm text-[#999] mb-5">
        자재에 커서를 올리면 해당 공정이 3D 흐름도에 하이라이트됩니다
      </div>

      <div className="grid grid-cols-[1fr_420px] gap-5 items-start">

        {/* 왼쪽 — 자재 테이블 */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          {/* 필터 */}
          <div className="px-5 py-3 border-b border-[#F0F0F0] flex items-center gap-3 flex-wrap">
            <span className="text-[11px] font-semibold text-[#999]">제품</span>
            {(["ALL", "HBM", "DRAM", "NAND"] as const).map((p) => (
              <button key={p}
                onClick={() => setFilterProduct(p)}
                className="text-[11px] font-bold px-2.5 py-1 rounded-full border transition-all"
                style={filterProduct === p
                  ? { background: p === "ALL" ? "#111" : PRODUCT_COLORS[p], color: "#fff", borderColor: "transparent" }
                  : { background: "#fff", color: "#555", borderColor: "#E8E8E8" }}
              >{p}</button>
            ))}
            <div className="w-px h-4 bg-[#E8E8E8]" />
            <span className="text-[11px] font-semibold text-[#999]">카테고리</span>
            {["ALL", "GAS", "CHM", "CSM", "UTL", "PKG"].map((c) => {
              const s = c !== "ALL" ? CATEGORY_STYLES[c] : null;
              return (
                <button key={c}
                  onClick={() => setFilterCat(c)}
                  className="text-[11px] font-bold px-2.5 py-1 rounded-full border transition-all"
                  style={filterCat === c
                    ? { background: s?.text ?? "#111", color: "#fff", borderColor: "transparent" }
                    : { background: s?.bg ?? "#fff", color: s?.text ?? "#555", borderColor: s?.bg ?? "#E8E8E8" }}
                >{c}</button>
              );
            })}
          </div>

          {/* 선택된 공정 정보 */}
          {selectedProc && (
            <div className="px-5 py-3 bg-[#FFF0F2] border-b border-[#FFD6DA] flex items-center gap-3">
              <span className="text-xs font-black text-[#EA002C]">{selectedProc}</span>
              <span className="text-xs text-[#EA002C] font-semibold">
                {PROCESSES.find((p) => p.code === selectedProc)?.name} — {selectedProcMaterials.length}종 자재 사용
              </span>
              <button onClick={() => setSelectedProc(null)} className="ml-auto text-[10px] text-[#EA002C] hover:underline">
                선택 해제
              </button>
            </div>
          )}

          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#FAFAFA] border-b border-[#F0F0F0]">
                <th className="text-left px-5 py-3 text-[11px] text-[#999] font-semibold">품번</th>
                <th className="text-left px-4 py-3 text-[11px] text-[#999] font-semibold">자재명</th>
                <th className="text-left px-4 py-3 text-[11px] text-[#999] font-semibold">구분</th>
                <th className="text-left px-4 py-3 text-[11px] text-[#999] font-semibold">적용 공정</th>
                <th className="text-left px-4 py-3 text-[11px] text-[#999] font-semibold">제품</th>
                <th className="text-right px-4 py-3 text-[11px] text-[#999] font-semibold">월 사용량 합계</th>
              </tr>
            </thead>
            <tbody>
              {filteredMaterials.map((mat) => {
                const cat = CATEGORY_STYLES[mat.category] ?? { bg: "#F5F5F5", text: "#666" };
                const totalQty = mat.usages
                  .filter((u) => filterProduct === "ALL" || u.product === filterProduct)
                  .reduce((s, u) => s + u.qty, 0);
                const isHovered = hoveredMat?.id === mat.id;
                const isSelectedProcMatch = selectedProc && mat.processes.includes(selectedProc);

                return (
                  <tr
                    key={mat.id}
                    onMouseEnter={() => setHoveredMat(mat)}
                    onMouseLeave={() => setHoveredMat(null)}
                    className="border-b border-[#F8F8F8] transition-colors cursor-pointer"
                    style={{
                      background: isHovered ? "#FFF5F5"
                        : isSelectedProcMatch ? "#FFFBEB"
                        : undefined,
                    }}
                  >
                    <td className="px-5 py-2.5 font-mono text-[11px] text-[#999]">{mat.code}</td>
                    <td className="px-4 py-2.5 font-semibold text-[#111]">{mat.name}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: cat.bg, color: cat.text }}>
                        {mat.category}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {mat.processes.sort().map((p) => {
                          const proc = PROCESSES.find((pr) => pr.code === p);
                          return (
                            <span key={p} className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white"
                              style={{ background: isHovered || isSelectedProcMatch ? proc?.color ?? "#999" : "#cbd5e1" }}>
                              {p}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1 flex-wrap">
                        {mat.products.map((pr) => (
                          <span key={pr} className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white"
                            style={{ background: PRODUCT_COLORS[pr] }}>
                            {pr}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                      {totalQty.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 오른쪽 — 3D 공정 흐름도 */}
        <div className="sticky top-5">
          <div className="rounded-2xl overflow-hidden shadow-lg" style={{ height: 460 }}>
            <Suspense fallback={<div className="w-full h-full bg-[#0f172a] rounded-2xl flex items-center justify-center text-white text-sm">3D 로딩 중…</div>}>
              <ProcessFlow3D
                highlightedProcesses={highlightedProcesses}
                activeProcesses={activeProcesses}
                onProcessClick={(code) => setSelectedProc((prev) => prev === code ? null : code)}
              />
            </Suspense>
          </div>

          {/* 공정 범례 */}
          <div className="mt-3 bg-white rounded-xl p-3 shadow-sm">
            <div className="text-[10px] text-[#999] font-semibold mb-2 uppercase tracking-wider">공정 범례</div>
            <div className="grid grid-cols-2 gap-1">
              {PROCESSES.map((p) => (
                <button
                  key={p.code}
                  onClick={() => setSelectedProc((prev) => prev === p.code ? null : p.code)}
                  className="flex items-center gap-1.5 text-left p-1 rounded-lg hover:bg-[#F8F8F8] transition-colors"
                >
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: p.color }} />
                  <span className="text-[10px] font-semibold text-[#555]">{p.code}</span>
                  <span className="text-[10px] text-[#999]">{p.name}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 pt-2 border-t border-[#F0F0F0] text-[10px] text-[#999]">
              자재에 hover → 공정 하이라이트 · 3D는 드래그로 회전
            </div>
          </div>

          {/* hover 중인 자재 상세 */}
          {hoveredMat && (
            <div className="mt-3 bg-[#0f172a] rounded-xl p-3 text-white">
              <div className="text-[10px] text-slate-400 mb-1 font-mono">{hoveredMat.code}</div>
              <div className="text-sm font-bold mb-2">{hoveredMat.name}</div>
              <div className="space-y-1">
                {hoveredMat.usages.map((u, i) => {
                  const proc = PROCESSES.find((p) => p.code === u.proc);
                  return (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      <span className="w-2 h-2 rounded-sm" style={{ background: proc?.color }} />
                      <span className="text-slate-300">{u.proc} {proc?.name}</span>
                      <span className="text-slate-500 ml-1">{u.product}</span>
                      <span className="ml-auto font-bold text-white">{u.qty.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
