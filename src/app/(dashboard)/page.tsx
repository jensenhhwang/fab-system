export const dynamic = "force-dynamic";

import {
  getInventoryRows, getWarehouseCapacity,
  getActiveRisks, getInfra, getRecentTransactions,
} from "@/lib/queries";
import AIBriefing from "@/components/AIBriefing";

async function getDashboardData() {
  const inventories = await getInventoryRows();

  const dohList = inventories
    .filter((inv) => inv.doh !== null)
    .map((inv) => ({ ...inv, doh: inv.doh as number }));

  const alertItems = dohList.filter((i) => i.doh < i.material.ropDays);
  const criticalItems = dohList.filter((i) => i.doh < 5);

  const caps = await getWarehouseCapacity();
  const warehouseStats = caps.map((wh) => ({
    id: wh.id, name: wh.name, totalCapacity: wh.totalCapacity, unit: wh.unit,
    temperature: wh.temperature,
    usedCapacity: wh.occupancy, pct: Math.min(wh.utilization, 100),
  }));

  const risks = await getActiveRisks();

  const infraAlerts = await getInfra(true);
  const infraUrgent = infraAlerts.filter(
    (i) => i.currentUsage / i.replacementCriteria >= 0.8
  );

  const recentTx = await getRecentTransactions(5);

  return { dohList, alertItems, criticalItems, warehouseStats, risks, infraUrgent, recentTx };
}

function DOHBadge({ doh, ropDays }: { doh: number; ropDays: number }) {
  if (doh < 5) return <span className="bg-[#FFF0F2] text-[#EA002C] text-[10px] font-bold px-2 py-0.5 rounded-full">{doh.toFixed(1)}일 위급</span>;
  if (doh < ropDays) return <span className="bg-[#FFF8E6] text-[#B97500] text-[10px] font-bold px-2 py-0.5 rounded-full">{doh.toFixed(1)}일</span>;
  return <span className="text-[11px]" style={{ color: "var(--text-3)" }}>{doh.toFixed(1)}일</span>;
}

function WarehouseBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? "#EA002C" : pct >= 80 ? "#F7A600" : "#00B96B";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: "var(--border)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-bold w-8 text-right" style={{ color }}>{pct}%</span>
    </div>
  );
}

const RISK_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  HIGH:   { bg: "#FFF0F0", text: "#991B1B", label: "HIGH" },
  MEDIUM: { bg: "#FFFBEB", text: "#92400E", label: "MID"  },
  LOW:    { bg: "#ECFDF5", text: "#065F46", label: "LOW"  },
};

export default async function DashboardPage() {
  const { dohList, alertItems, criticalItems, warehouseStats, risks, infraUrgent, recentTx } = await getDashboardData();

  const avgCapacity = Math.round(warehouseStats.reduce((s, w) => s + w.pct, 0) / warehouseStats.length);

  return (
    <>
      {/* 페이지 헤더 */}
      <div className="mb-5">
        <div
          className="uppercase font-bold tracking-[0.08em] mb-1"
          style={{ fontSize: "11px", color: "var(--text-3)" }}
        >
          이천 M14/M16 · 자재관리팀
        </div>
        <div className="text-2xl font-bold" style={{ color: "var(--text-1)", letterSpacing: "-0.025em" }}>
          종합 현황
        </div>
      </div>

      {/* AI 담당자 브리핑 */}
      <AIBriefing />

      {/* KPI 카드 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div
          className="bg-white rounded-2xl p-5 border-t-4 border-[#F7A600]"
          style={{ boxShadow: "var(--shadow-1)", border: "1px solid var(--border)", borderTopColor: "#F7A600", borderTopWidth: "4px" }}
        >
          <div className="uppercase font-bold tracking-[0.08em] mb-3" style={{ fontSize: "11px", color: "var(--text-3)" }}>
            전체 창고 Capacity
          </div>
          <div className="text-4xl font-bold text-[#F7A600] leading-none" style={{ letterSpacing: "-0.02em" }}>
            {avgCapacity}<span className="text-lg font-semibold">%</span>
          </div>
          <div className="h-1.5 rounded-full mt-4" style={{ backgroundColor: "var(--border)" }}>
            <div className="h-full bg-[#F7A600] rounded-full" style={{ width: `${avgCapacity}%` }} />
          </div>
        </div>

        <div
          className="bg-white rounded-2xl p-5"
          style={{ boxShadow: "var(--shadow-1)", border: "1px solid var(--border)", borderTopColor: "#EA002C", borderTopWidth: "4px" }}
        >
          <div className="uppercase font-bold tracking-[0.08em] mb-3" style={{ fontSize: "11px", color: "var(--text-3)" }}>
            재고 경보 품목
          </div>
          <div className="text-4xl font-bold text-[#EA002C] leading-none" style={{ letterSpacing: "-0.02em" }}>
            {alertItems.length}
          </div>
          <div className="text-xs mt-2 text-[#EA002C]">위급 {criticalItems.length}건 (5일 미만)</div>
          <div className="h-1.5 rounded-full mt-2" style={{ backgroundColor: "var(--border)" }}>
            <div className="h-full bg-[#EA002C] rounded-full" style={{ width: `${Math.min((alertItems.length / dohList.length) * 100, 100)}%` }} />
          </div>
        </div>

        <div
          className="bg-white rounded-2xl p-5"
          style={{ boxShadow: "var(--shadow-1)", border: "1px solid var(--border)", borderTopColor: "#F7A600", borderTopWidth: "4px" }}
        >
          <div className="uppercase font-bold tracking-[0.08em] mb-3" style={{ fontSize: "11px", color: "var(--text-3)" }}>
            활성 리스크
          </div>
          <div className="text-4xl font-bold text-[#F7A600] leading-none" style={{ letterSpacing: "-0.02em" }}>
            {risks.length}
          </div>
          <div className="text-xs mt-2" style={{ color: "var(--text-3)" }}>
            HIGH {risks.filter((r) => r.level === "HIGH").length} · MID {risks.filter((r) => r.level === "MEDIUM").length}
          </div>
          <div className="h-1.5 rounded-full mt-2" style={{ backgroundColor: "var(--border)" }}>
            <div className="h-full bg-[#F7A600] rounded-full" style={{ width: `${Math.min(risks.length * 10, 100)}%` }} />
          </div>
        </div>

        <div
          className="bg-white rounded-2xl p-5"
          style={{ boxShadow: "var(--shadow-1)", border: "1px solid var(--border)", borderTopColor: "#EA002C", borderTopWidth: "4px" }}
        >
          <div className="uppercase font-bold tracking-[0.08em] mb-3" style={{ fontSize: "11px", color: "var(--text-3)" }}>
            인프라 교체 임박
          </div>
          <div className="text-4xl font-bold text-[#EA002C] leading-none" style={{ letterSpacing: "-0.02em" }}>
            {infraUrgent.length}
          </div>
          <div className="text-xs mt-2" style={{ color: "var(--text-3)" }}>사용률 80% 초과</div>
          <div className="h-1.5 rounded-full mt-2" style={{ backgroundColor: "var(--border)" }}>
            <div className="h-full bg-[#EA002C] rounded-full" style={{ width: `${Math.min(infraUrgent.length * 15, 100)}%` }} />
          </div>
        </div>
      </div>

      {/* 창고 현황 + 리스크 */}
      <div className="grid grid-cols-2 gap-5 mb-5">
        {/* 창고 현황 */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "var(--shadow-1)", border: "1px solid var(--border)" }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
            <span className="text-[13px] font-bold" style={{ color: "var(--text-1)", letterSpacing: "-0.01em" }}>창고별 Capacity 현황</span>
            <span className="text-[10px] font-semibold bg-[#E8F3FF] text-[#0078D4] px-2.5 py-1 rounded-full uppercase tracking-[0.04em]">실시간</span>
          </div>
          <div className="px-5 py-4 space-y-4">
            {warehouseStats.map((wh) => (
              <div key={wh.id}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="font-semibold" style={{ color: "var(--text-1)" }}>{wh.name}</span>
                </div>
                <WarehouseBar pct={wh.pct} />
                <div className="mt-1" style={{ fontSize: "11px", color: "var(--text-3)" }}>
                  {wh.usedCapacity.toLocaleString()} / {wh.totalCapacity.toLocaleString()} {wh.unit}
                  {wh.temperature && <span className="ml-2">· {wh.temperature}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 리스크 */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "var(--shadow-1)", border: "1px solid var(--border)" }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
            <span className="text-[13px] font-bold" style={{ color: "var(--text-1)", letterSpacing: "-0.01em" }}>활성 리스크</span>
            <span className="text-[10px] font-semibold bg-[#FFF0F2] text-[#EA002C] px-2.5 py-1 rounded-full">{risks.length}건</span>
          </div>
          <div className="px-5 py-4 space-y-3">
            {risks.map((risk) => {
              const s = RISK_STYLES[risk.level] ?? RISK_STYLES.LOW;
              return (
                <div key={risk.id} className="rounded-xl p-3" style={{ backgroundColor: s.bg, color: s.text }}>
                  <div className="flex items-start gap-2">
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-[0.04em]" style={{ background: s.text, color: "#fff" }}>{s.label}</span>
                    <div className="flex-1">
                      <div className="text-xs font-semibold leading-snug">{risk.title}</div>
                      <div className="text-[10px] opacity-75 mt-0.5">담당: {risk.owner} · {risk.category}</div>
                    </div>
                  </div>
                </div>
              );
            })}
            {risks.length === 0 && (
              <div className="text-sm text-center py-6" style={{ color: "var(--text-3)" }}>활성 리스크 없음</div>
            )}
          </div>
        </div>
      </div>

      {/* 재고 경보 + 최근 트랜잭션 */}
      <div className="grid grid-cols-2 gap-5">
        {/* 재고 경보 */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "var(--shadow-1)", border: "1px solid var(--border)" }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
            <span className="text-[13px] font-bold" style={{ color: "var(--text-1)", letterSpacing: "-0.01em" }}>재고 경보 품목</span>
            <span className="text-[10px] font-semibold bg-[#FFF0F2] text-[#EA002C] px-2.5 py-1 rounded-full">{alertItems.length}건</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: "var(--bg-page)", borderBottom: "1px solid var(--border)" }}>
                  <th className="text-left px-5 py-2.5 uppercase font-bold tracking-[0.06em]" style={{ fontSize: "11px", color: "var(--text-3)" }}>자재</th>
                  <th className="text-right px-5 py-2.5 uppercase font-bold tracking-[0.06em]" style={{ fontSize: "11px", color: "var(--text-3)" }}>현재고</th>
                  <th className="text-right px-5 py-2.5 uppercase font-bold tracking-[0.06em]" style={{ fontSize: "11px", color: "var(--text-3)" }}>보관일수</th>
                </tr>
              </thead>
              <tbody>
                {alertItems.slice(0, 6).map((inv, i) => (
                  <tr
                    key={inv.id}
                    style={{ borderBottom: "1px solid var(--border)" }}
                  >
                    <td className="px-5 py-2.5">
                      <div className="font-semibold" style={{ color: "var(--text-1)" }}>{inv.material.name}</div>
                      <div className="font-mono" style={{ fontSize: "10px", color: "var(--text-3)" }}>{inv.material.code}</div>
                    </td>
                    <td className="px-5 py-2.5 text-right font-semibold">{inv.quantity.toLocaleString()} {inv.material.unit}</td>
                    <td className="px-5 py-2.5 text-right">
                      <DOHBadge doh={inv.doh} ropDays={inv.material.ropDays} />
                    </td>
                  </tr>
                ))}
                {alertItems.length === 0 && (
                  <tr><td colSpan={3} className="px-5 py-8 text-center" style={{ color: "var(--text-3)" }}>재고 경보 없음</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 최근 입출고 */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "var(--shadow-1)", border: "1px solid var(--border)" }}>
          <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
            <span className="text-[13px] font-bold" style={{ color: "var(--text-1)", letterSpacing: "-0.01em" }}>최근 입출고</span>
          </div>
          <div className="px-5 py-4 space-y-3">
            {recentTx.length === 0 && (
              <div className="text-sm text-center py-6" style={{ color: "var(--text-3)" }}>입출고 내역 없음</div>
            )}
            {recentTx.map((tx) => (
              <div key={tx.id} className="flex items-center gap-3">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-[0.04em] ${tx.type === "IN" ? "bg-[#E6FAF1] text-[#065F46]" : "bg-[#FFF0F2] text-[#991B1B]"}`}>
                  {tx.type === "IN" ? "입고" : "출고"}
                </span>
                <div className="flex-1">
                  <div className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>{tx.material.name}</div>
                  <div style={{ fontSize: "10px", color: "var(--text-3)" }}>{tx.user.name} · {new Date(tx.date).toLocaleDateString("ko-KR")}</div>
                </div>
                <span className="text-xs font-bold" style={{ color: "var(--text-1)" }}>{tx.quantity.toLocaleString()} {tx.material.unit}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
