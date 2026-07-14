"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ReadinessCell = {
  materialId: string;
  materialName: string;
  dailyUsage: number;
  availableQty: number;
  doh: number;
  ropDays: number;
};

type ReadinessRow = {
  processCode: string;
  processName: string;
  site: string[];
  product: string;
  cells: ReadinessCell[];
};

function getDohStyle(doh: number, ropDays: number): string {
  if (doh < 5) return "bg-red-100 text-red-700 font-semibold";
  if (doh < ropDays) return "bg-amber-100 text-amber-700";
  return "bg-green-100 text-green-700";
}

const SITE_BADGE: Record<string, string> = {
  "이천": "bg-blue-100 text-blue-700",
  "청주": "bg-green-100 text-green-700",
};

export default function ProcessReadinessMatrix({
  onCellClick,
  highlightProcess,
}: {
  onCellClick: (processCode: string, product: string, materialId: string) => void;
  highlightProcess?: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ReadinessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [siteFilter, setSiteFilter] = useState<"ALL" | "이천" | "청주">("ALL");
  const [hoveredProcess, setHoveredProcess] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/mes/process-readiness")
      .then(r => r.json())
      .then(data => { setRows(data); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-sm" style={{ color: "var(--text-3)" }}>
        로딩 중...
      </div>
    );
  }

  const filteredRows = siteFilter === "ALL"
    ? rows
    : rows.filter(r => r.site.includes(siteFilter));

  const allMaterials = Array.from(
    new Map(
      filteredRows.flatMap(r => r.cells.map(c => [c.materialId, c.materialName]))
    ).entries()
  ).map(([id, name]) => ({ id, name }));

  const allCells = filteredRows.flatMap(r => r.cells);
  const criticalCount = allCells.filter(c => c.doh < 5).length;
  const warningCount = allCells.filter(c => c.doh >= 5 && c.doh < c.ropDays).length;
  const okCount = allCells.filter(c => c.doh >= c.ropDays).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "위험 (5일↓)", count: criticalCount, border: "border-red-400", bg: "bg-red-50", text: "text-red-700" },
          { label: "경고 (ROP 미달)", count: warningCount, border: "border-amber-400", bg: "bg-amber-50", text: "text-amber-700" },
          { label: "정상", count: okCount, border: "border-green-400", bg: "bg-green-50", text: "text-green-700" },
        ].map(({ label, count, border, bg, text }) => (
          <div key={label} className={`rounded-2xl shadow-sm p-4 border-t-4 ${border} ${bg}`}>
            <div className={`text-2xl font-bold ${text}`}>{count}</div>
            <div className="text-xs mt-1" style={{ color: "var(--text-3)" }}>{label}</div>
          </div>
        ))}
      </div>

      {/* 사이트 필터 */}
      <div className="flex gap-2 items-center">
        <span className="text-xs font-semibold" style={{ color: "var(--text-3)" }}>사이트</span>
        {(["ALL", "이천", "청주"] as const).map(s => (
          <button
            key={s}
            onClick={() => setSiteFilter(s)}
            className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
              siteFilter === s
                ? "bg-[#0078D4] text-white border-[#0078D4]"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-auto">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 bg-gray-50 px-3 py-2 text-left font-semibold border-b border-r" style={{ color: "var(--text-2)", minWidth: 170 }}>
                공정 / 자재
              </th>
              {allMaterials.map(m => (
                <th key={m.id} className="sticky top-0 z-10 bg-gray-50 px-3 py-2 text-center font-medium border-b border-r whitespace-nowrap" style={{ color: "var(--text-2)", minWidth: 90 }}>
                  {m.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(row => {
              const cellMap = new Map(row.cells.map(c => [c.materialId, c]));
              const isHighlighted = highlightProcess === row.processCode;
              const isHovered = hoveredProcess === row.processCode;
              return (
                <tr
                  key={`${row.processCode}-${row.product}`}
                  className={`hover:bg-gray-50 ${isHighlighted ? "outline outline-2 outline-[#0078D4]" : ""}`}
                  onMouseEnter={() => setHoveredProcess(row.processCode)}
                  onMouseLeave={() => setHoveredProcess(null)}
                >
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 border-b border-r whitespace-nowrap" style={{ color: "var(--text-1)" }}>
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[11px]">{row.processName}</span>
                        <span className="font-mono text-[10px] text-gray-400">{row.processCode}</span>
                        {isHovered && (
                          <button
                            onClick={() => router.push(`/usage?process=${row.processCode}`)}
                            className="text-[9px] text-[#0078D4] hover:underline ml-1"
                          >
                            → 사용량
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {row.site.map(s => (
                          <span key={s} className={`text-[9px] font-bold px-1 py-0.5 rounded ${SITE_BADGE[s] ?? "bg-gray-100 text-gray-600"}`}>
                            {s}
                          </span>
                        ))}
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100" style={{ color: "var(--text-3)" }}>
                          {row.product}
                        </span>
                      </div>
                    </div>
                  </td>
                  {allMaterials.map(m => {
                    const cell = cellMap.get(m.id);
                    if (!cell) {
                      return <td key={m.id} className="px-3 py-2 text-center border-b border-r text-gray-300">—</td>;
                    }
                    return (
                      <td
                        key={m.id}
                        className={`px-3 py-2 text-center border-b border-r cursor-pointer hover:opacity-75 transition-opacity ${getDohStyle(cell.doh, cell.ropDays)}`}
                        onClick={() => onCellClick(row.processCode, row.product, m.id)}
                        title={`가용: ${cell.availableQty.toFixed(1)} / 일소비: ${cell.dailyUsage.toFixed(1)}`}
                      >
                        {cell.doh}일
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
