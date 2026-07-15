"use client";

import { useState } from "react";
import Link from "next/link";

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  GAS: { bg: "#FEE2E2", text: "#B91C1C" },
  CHM: { bg: "#DBEAFE", text: "#1D4ED8" },
  CSM: { bg: "#EDE9FE", text: "#6D28D9" },
  UTL: { bg: "#D1FAE5", text: "#065F46" },
  PKG: { bg: "#F1F5F9", text: "#475569" },
};

const STATUS_BADGE: Record<string, { label: string; bg: string; text: string; color: string }> = {
  critical: { label: "위급",   bg: "#FFF0F2", text: "#EA002C", color: "#EA002C" },
  warning:  { label: "경보",   bg: "#FFF8E6", text: "#B97500", color: "#F7A600" },
  ok:       { label: "적정",   bg: "#E6FAF1", text: "#065F46", color: "#00B96B" },
  safe:     { label: "여유",   bg: "#F0F7FF", text: "#0078D4", color: "#0078D4" },
  nodata:   { label: "데이터없음", bg: "#F5F5F5", text: "#999", color: "#999" },
};

type InventoryItem = {
  id: string;
  materialId: string;
  quantity: number;
  avgDailyUsage: number;
  monthlyQty: number;
  usageSource?: "process" | "fallback";
  doh: number | null;
  status: string;
  material: {
    code: string;
    name: string;
    nameEn: string | null;
    category: string;
    unit: string;
    ropDays: number;
  };
  warehouse: { name: string };
};

function DOHBar({ doh, ropDays }: { doh: number; ropDays: number }) {
  const max = ropDays > 0 ? ropDays * 3 : 1;
  const pct = ropDays > 0 ? Math.min((doh / max) * 100, 100) : 0;
  const color = doh < 5 ? "#EA002C" : doh < ropDays ? "#F7A600" : "#00B96B";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-[#F0F0F0] rounded-full flex-shrink-0 relative">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
        {/* ROP 위치 마커 (1/3 지점) */}
        <div className="absolute top-0 bottom-0 w-px bg-[#999] opacity-40" style={{ left: "33.3%" }} />
      </div>
      <div className="flex flex-col leading-none">
        <span className="text-xs font-bold tabular-nums" style={{ color }}>{doh.toFixed(1)}일</span>
        <span className="text-[9px] text-[#bbb] tabular-nums">/ {max}일</span>
      </div>
    </div>
  );
}

type FilterKey = "ALL" | "critical" | "warning" | "ok" | "safe";
type CatKey = "ALL" | "GAS" | "CHM" | "CSM" | "UTL" | "PKG";
const CAT_LIST: { key: CatKey; label: string }[] = [
  { key: "ALL", label: "전체" }, { key: "GAS", label: "GAS 가스" }, { key: "CHM", label: "CHM 케미컬" },
  { key: "CSM", label: "CSM 소모성" }, { key: "UTL", label: "UTL 유틸리티" }, { key: "PKG", label: "PKG 패키징" },
];
type SortKey = "code" | "name" | "category" | "quantity" | "dailyUsage" | "monthlyQty" | "doh" | "warehouse" | "status";
type SortDir = "asc" | "desc";

const STATUS_ORDER: Record<string, number> = { critical: 0, warning: 1, ok: 2, safe: 3, nodata: 4 };

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  const active = col === sortKey;
  return (
    <span className="inline-flex flex-col ml-1 -translate-y-px">
      <span style={{ opacity: active && sortDir === "asc" ? 1 : 0.25, fontSize: 8, lineHeight: 1 }}>▲</span>
      <span style={{ opacity: active && sortDir === "desc" ? 1 : 0.25, fontSize: 8, lineHeight: 1 }}>▼</span>
    </span>
  );
}

export default function InventoryClient({ items, lotCounts = {} }: { items: InventoryItem[]; lotCounts?: Record<string, number> }) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("ALL");
  const [catFilter, setCatFilter] = useState<CatKey>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function handleSort(col: SortKey) {
    if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(col); setSortDir("asc"); }
  }

  // 카테고리 필터 먼저 적용 → 상태 카운트/필터는 그 안에서
  const base = catFilter === "ALL" ? items : items.filter((i) => i.material.category === catFilter);
  const catCount = (k: CatKey) => k === "ALL" ? items.length : items.filter((i) => i.material.category === k).length;

  const counts = {
    critical: base.filter((i) => i.status === "critical").length,
    warning:  base.filter((i) => i.status === "warning").length,
    ok:       base.filter((i) => i.status === "ok").length,
    safe:     base.filter((i) => i.status === "safe").length,
  };

  const filtered = (activeFilter === "ALL" ? base : base.filter((i) => i.status === activeFilter))
    .slice()
    .sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "code":      cmp = a.material.code.localeCompare(b.material.code); break;
        case "name":      cmp = a.material.name.localeCompare(b.material.name); break;
        case "category":  cmp = a.material.category.localeCompare(b.material.category); break;
        case "quantity":  cmp = a.quantity - b.quantity; break;
        case "dailyUsage": cmp = a.avgDailyUsage - b.avgDailyUsage; break;
        case "monthlyQty": cmp = a.monthlyQty - b.monthlyQty; break;
        case "doh":       cmp = (a.doh ?? -1) - (b.doh ?? -1); break;
        case "warehouse": cmp = a.warehouse.name.localeCompare(b.warehouse.name); break;
        case "status":    cmp = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

  const TABS: { key: Exclude<FilterKey, "ALL">; label: string; sublabel: string; color: string; bg: string }[] = [
    { key: "critical", label: "위급",  sublabel: "5일 미만",    color: "#EA002C", bg: "#FFF0F2" },
    { key: "warning",  label: "경보",  sublabel: "ROP 이하",    color: "#F7A600", bg: "#FFF8E6" },
    { key: "ok",       label: "적정",  sublabel: "ROP~2×ROP",  color: "#00B96B", bg: "#E6FAF1" },
    { key: "safe",     label: "여유",  sublabel: "ROP 2배 이상", color: "#0078D4", bg: "#E8F3FF" },
  ];

  return (
    <>
      {/* KPI 탭 카드 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {/* 전체 버튼 */}
        <button
          onClick={() => setActiveFilter("ALL")}
          className="col-span-4 -mb-2 text-left"
        >
          {activeFilter !== "ALL" && (
            <span className="text-xs text-[#999] hover:text-[#111] transition-colors">
              ← 전체 보기 ({items.length}품목)
            </span>
          )}
        </button>

        {TABS.map((tab) => {
          const isActive = activeFilter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveFilter((prev) => prev === tab.key ? "ALL" : tab.key)}
              className="text-left rounded-2xl p-5 shadow-sm transition-all duration-200 focus:outline-none"
              style={{
                backgroundColor: isActive ? tab.color : "#fff",
                borderTop: `4px solid ${tab.color}`,
                transform: isActive ? "translateY(-2px)" : "translateY(0)",
                boxShadow: isActive
                  ? `0 8px 24px ${tab.color}33`
                  : "0 1px 3px rgba(0,0,0,0.06)",
              }}
            >
              <div
                className="text-[11px] mb-1 font-medium"
                style={{ color: isActive ? "rgba(255,255,255,0.8)" : "#999" }}
              >
                {tab.label} ({tab.sublabel})
              </div>
              <div
                className="text-4xl font-black"
                style={{ color: isActive ? "#fff" : tab.color }}
              >
                {counts[tab.key]}
              </div>
              <div
                className="text-xs mt-1"
                style={{ color: isActive ? "rgba(255,255,255,0.7)" : "#999" }}
              >
                {isActive ? "클릭하여 전체 보기" : "품목 · 클릭하여 필터"}
              </div>
            </button>
          );
        })}
      </div>

      {/* 자재 유형(카테고리) 필터 */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <span className="text-[11px] font-semibold text-[#999] mr-1">자재 유형</span>
        {CAT_LIST.map((c) => {
          const isActive = catFilter === c.key;
          const s = c.key !== "ALL" ? CATEGORY_STYLES[c.key] : null;
          return (
            <button
              key={c.key}
              onClick={() => setCatFilter(c.key)}
              className="text-[11px] font-bold px-3 py-1.5 rounded-full border transition-all"
              style={
                isActive
                  ? { background: s?.text ?? "#111", color: "#fff", borderColor: "transparent" }
                  : { background: s?.bg ?? "#fff", color: s?.text ?? "#555", borderColor: s?.bg ?? "#E8E8E8" }
              }
            >
              {c.label} <span className="opacity-70">{catCount(c.key)}</span>
            </button>
          );
        })}
      </div>

      {/* 재고 테이블 */}
      <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "var(--shadow-1)", border: "1px solid var(--border)" }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-bold" style={{ color: "var(--text-1)", letterSpacing: "-0.01em" }}>
              {activeFilter === "ALL" ? "전체 재고 현황" : `${STATUS_BADGE[activeFilter]?.label} 품목`}
            </span>
            {activeFilter !== "ALL" && (
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: STATUS_BADGE[activeFilter]?.bg,
                  color: STATUS_BADGE[activeFilter]?.text,
                }}
              >
                {STATUS_BADGE[activeFilter]?.label}
              </span>
            )}
          </div>
          <span style={{ fontSize: "10px", color: "var(--text-3)" }}>
            {filtered.length}품목{activeFilter !== "ALL" ? ` / 전체 ${items.length}품목` : ""}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ backgroundColor: "var(--bg-page)", borderBottom: "1px solid var(--border)" }}>
                {(
                  [
                    { col: "code"      as SortKey, label: "품번",     align: "left",   px: "px-5" },
                    { col: "name"      as SortKey, label: "자재명",   align: "left",   px: "px-4" },
                    { col: "category"  as SortKey, label: "구분",     align: "left",   px: "px-4" },
                    { col: "quantity"  as SortKey, label: "현재고",   align: "right",  px: "px-4" },
                    { col: "dailyUsage"  as SortKey, label: "일사용량",  align: "right",  px: "px-4" },
                    { col: "monthlyQty" as SortKey, label: "월소요량",  align: "right",  px: "px-4" },
                    { col: "doh"        as SortKey, label: "보관일수",  align: "left",   px: "px-4" },
                    { col: "warehouse" as SortKey, label: "창고",     align: "left",   px: "px-4" },
                    { col: "status"    as SortKey, label: "상태",     align: "center", px: "px-4" },
                  ] as const
                ).map(({ col, label, align, px }) => (
                  <th key={col} className={`${px} py-3`}>
                    <button
                      onClick={() => handleSort(col)}
                      className={`uppercase font-bold tracking-[0.06em] select-none transition-colors flex items-center gap-0.5 ${align === "right" ? "ml-auto" : align === "center" ? "mx-auto" : ""}`}
                      style={{ fontSize: "11px", color: sortKey === col ? "var(--text-1)" : "var(--text-3)" }}
                    >
                      {label}
                      <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center text-sm" style={{ color: "var(--text-3)" }}>
                    해당 상태의 품목이 없습니다.
                  </td>
                </tr>
              ) : (
                filtered.map((inv) => {
                  const cat = CATEGORY_STYLES[inv.material.category] ?? { bg: "#F5F5F5", text: "#666" };
                  const badge = STATUS_BADGE[inv.status];
                  return (
                    <tr
                      key={inv.id}
                      className="transition-colors"
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      <td className="px-5 py-3 font-mono text-[11px]">
                        <Link href={`/inventory/materials/${encodeURIComponent(inv.materialId)}`} className="font-bold text-[#0078D4] hover:underline">
                          {inv.material.code}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Link href={`/inventory/materials/${encodeURIComponent(inv.materialId)}`} className="font-semibold hover:text-[#0078D4] hover:underline" style={{ color: "var(--text-1)" }}>
                            {inv.material.name}
                          </Link>
                          {(lotCounts[inv.materialId] ?? 0) > 0 && (
                            <span className="ml-1 text-[10px] font-bold text-[#0078D4] bg-[#E6F0FA] px-1.5 py-0.5 rounded-full">
                              전체 {lotCounts[inv.materialId]} Lots
                            </span>
                          )}
                        </div>
                        {inv.material.nameEn && (
                          <div className="text-[10px] text-[#999]">{inv.material.nameEn}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: cat.bg, color: cat.text }}
                        >
                          {inv.material.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {inv.material.ropDays === 0 ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#D1FAE5] text-[#065F46]">현장생산</span>
                        ) : (
                          <>{inv.quantity.toLocaleString()}{" "}<span className="text-[#999] font-normal">{inv.material.unit}</span></>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-[#999] tabular-nums">
                        {inv.material.ropDays === 0 ? (
                          <span className="text-[10px] text-[#999]">연속공급</span>
                        ) : inv.avgDailyUsage > 0 ? (
                          `${inv.avgDailyUsage}/${inv.material.unit}`
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-[#111]">
                        {inv.monthlyQty > 0
                          ? <>{inv.monthlyQty.toLocaleString()} <span className="text-[#999] font-normal text-[10px]">{inv.material.unit}</span></>
                          : <span className="text-[#999]">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {inv.doh !== null ? (
                          <DOHBar doh={inv.doh} ropDays={inv.material.ropDays} />
                        ) : (
                          <span className="text-[#999]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-[#555]">
                        {inv.warehouse.name.split("—")[0].trim()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: badge.bg, color: badge.text }}
                        >
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
