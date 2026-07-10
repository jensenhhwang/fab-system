import { db } from "@/lib/db";

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  GAS: { bg: "#FEE2E2", text: "#B91C1C" },
  CHM: { bg: "#DBEAFE", text: "#1D4ED8" },
  CSM: { bg: "#EDE9FE", text: "#6D28D9" },
  UTL: { bg: "#D1FAE5", text: "#065F46" },
  PKG: { bg: "#F1F5F9", text: "#475569" },
};

async function getInventoryData() {
  const inventories = await db.inventory.findMany({
    include: { material: true, warehouse: true },
    orderBy: { material: { code: "asc" } },
  });

  return inventories.map((inv) => {
    const doh = inv.avgDailyUsage > 0 ? inv.quantity / inv.avgDailyUsage : null;
    const status =
      doh === null ? "nodata"
      : doh < 5        ? "critical"
      : doh < inv.material.ropDays ? "warning"
      : doh < inv.material.ropDays * 2 ? "ok"
      : "safe";
    return { ...inv, doh, status };
  });
}

function DOHBar({ doh, ropDays }: { doh: number; ropDays: number }) {
  const max = ropDays * 3;
  const pct = Math.min((doh / max) * 100, 100);
  const color = doh < 5 ? "#EA002C" : doh < ropDays ? "#F7A600" : "#00B96B";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-[#F0F0F0] rounded-full flex-shrink-0">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-bold tabular-nums" style={{ color }}>
        {doh.toFixed(1)}일
      </span>
    </div>
  );
}

const STATUS_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  critical: { label: "위급",   bg: "#FFF0F2", text: "#EA002C" },
  warning:  { label: "경보",   bg: "#FFF8E6", text: "#B97500" },
  ok:       { label: "적정",   bg: "#E6FAF1", text: "#065F46" },
  safe:     { label: "여유",   bg: "#F0F7FF", text: "#0078D4" },
  nodata:   { label: "데이터없음", bg: "#F5F5F5", text: "#999" },
};

export default async function InventoryPage() {
  const items = await getInventoryData();

  const critical = items.filter((i) => i.status === "critical");
  const warning  = items.filter((i) => i.status === "warning");
  const ok       = items.filter((i) => i.status === "ok");
  const safe     = items.filter((i) => i.status === "safe");

  return (
    <>
      <div className="mb-1 text-2xl font-extrabold tracking-tight">재고 · 보관일수</div>
      <div className="text-sm text-[#999] mb-6">
        보관일수(DOH) = 현재고 ÷ 일평균사용량 · 기준: {new Date().toLocaleDateString("ko-KR")}
      </div>

      {/* 요약 KPI */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "위급 (5일 미만)",         count: critical.length, color: "#EA002C", bg: "#FFF0F2" },
          { label: "경보 (ROP 이하)",          count: warning.length,  color: "#F7A600", bg: "#FFF8E6" },
          { label: "적정",                     count: ok.length,       color: "#00B96B", bg: "#E6FAF1" },
          { label: "여유 (ROP 2배 이상)",      count: safe.length,     color: "#0078D4", bg: "#E8F3FF" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl p-5 shadow-sm" style={{ borderTop: `4px solid ${s.color}` }}>
            <div className="text-[11px] text-[#999] mb-1">{s.label}</div>
            <div className="text-4xl font-black" style={{ color: s.color }}>{s.count}</div>
            <div className="text-xs text-[#999] mt-1">품목</div>
          </div>
        ))}
      </div>

      {/* 재고 테이블 */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[#F0F0F0] flex items-center justify-between">
          <span className="text-[13px] font-bold">전체 재고 현황</span>
          <span className="text-[10px] text-[#999]">총 {items.length}품목</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#FAFAFA] border-b border-[#F0F0F0]">
                <th className="text-left px-5 py-3 text-[11px] text-[#999] font-semibold">품번</th>
                <th className="text-left px-4 py-3 text-[11px] text-[#999] font-semibold">자재명</th>
                <th className="text-left px-4 py-3 text-[11px] text-[#999] font-semibold">구분</th>
                <th className="text-right px-4 py-3 text-[11px] text-[#999] font-semibold">현재고</th>
                <th className="text-right px-4 py-3 text-[11px] text-[#999] font-semibold">일사용량</th>
                <th className="text-left px-4 py-3 text-[11px] text-[#999] font-semibold">보관일수</th>
                <th className="text-left px-4 py-3 text-[11px] text-[#999] font-semibold">창고</th>
                <th className="text-center px-4 py-3 text-[11px] text-[#999] font-semibold">상태</th>
              </tr>
            </thead>
            <tbody>
              {items.map((inv) => {
                const cat = CATEGORY_STYLES[inv.material.category] ?? { bg: "#F5F5F5", text: "#666" };
                const badge = STATUS_BADGE[inv.status];
                return (
                  <tr key={inv.id} className="border-b border-[#F8F8F8] hover:bg-[#FAFAFA] transition-colors">
                    <td className="px-5 py-3 font-mono text-[11px] text-[#999]">{inv.material.code}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#111]">{inv.material.name}</div>
                      {inv.material.nameEn && (
                        <div className="text-[10px] text-[#999]">{inv.material.nameEn}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: cat.bg, color: cat.text }}>
                        {inv.material.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {inv.quantity.toLocaleString()} <span className="text-[#999] font-normal">{inv.material.unit}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-[#999] tabular-nums">
                      {inv.avgDailyUsage > 0 ? `${inv.avgDailyUsage}/${inv.material.unit}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {inv.doh !== null
                        ? <DOHBar doh={inv.doh} ropDays={inv.material.ropDays} />
                        : <span className="text-[#999]">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-[11px] text-[#555]">
                      {inv.warehouse.name.split("—")[0].trim()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: badge.bg, color: badge.text }}>
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
