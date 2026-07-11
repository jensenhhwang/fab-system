export const dynamic = "force-dynamic";

import {
  getInventoryRows, getWarehouseCapacity,
  getActiveRisks, getInfra, getRecentTransactions,
} from "@/lib/queries";
import AIBriefing from "@/components/AIBriefing";

async function getDashboardData() {
  // 재고 + 유도 DOH (일사용량은 ProcessUsage 마스터에서 유도 → 공정 탭과 정합)
  const inventories = await getInventoryRows();

  const dohList = inventories
    .filter((inv) => inv.doh !== null)
    .map((inv) => ({ ...inv, doh: inv.doh as number }));

  const alertItems = dohList.filter((i) => i.doh < i.material.ropDays);
  const criticalItems = dohList.filter((i) => i.doh < 5);

  // 창고 현황 — 실제 공간환산 기반 Capacity
  const caps = await getWarehouseCapacity();
  const warehouseStats = caps.map((wh) => ({
    id: wh.id, name: wh.name, totalCapacity: wh.totalCapacity, unit: wh.unit,
    temperature: wh.temperature,
    usedCapacity: wh.occupancy, pct: Math.min(wh.utilization, 100),
  }));

  // 활성 리스크
  const risks = await getActiveRisks();

  // 인프라 교체 임박 항목 (80% 이상 사용)
  const infraAlerts = await getInfra(true);
  const infraUrgent = infraAlerts.filter(
    (i) => i.currentUsage / i.replacementCriteria >= 0.8
  );

  // 최근 트랜잭션
  const recentTx = await getRecentTransactions(5);

  return { dohList, alertItems, criticalItems, warehouseStats, risks, infraUrgent, recentTx };
}

function DOHBadge({ doh, ropDays }: { doh: number; ropDays: number }) {
  if (doh < 5) return <span className="chip bg-[#FFF0F2] text-[#EA002C] text-[10px] font-bold px-2 py-0.5 rounded-full">{doh.toFixed(1)}일 ⚠️</span>;
  if (doh < ropDays) return <span className="chip bg-[#FFF8E6] text-[#B97500] text-[10px] font-bold px-2 py-0.5 rounded-full">{doh.toFixed(1)}일</span>;
  return <span className="text-[11px] text-[#999]">{doh.toFixed(1)}일</span>;
}

function WarehouseBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? "#EA002C" : pct >= 80 ? "#F7A600" : "#00B96B";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-[#F0F0F0] rounded-full">
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
      <div className="mb-1 text-2xl font-extrabold tracking-tight">종합 현황</div>
      <div className="text-sm text-[#999] mb-4">이천 M14/M16 · 자재관리팀 / 기준: {new Date().toLocaleDateString("ko-KR")}</div>

      {/* AI 담당자 브리핑 */}
      <AIBriefing />

      {/* KPI 카드 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-2xl p-5 shadow-sm border-t-4 border-[#F7A600]">
          <div className="text-[11px] text-[#999] mb-1 font-medium">전체 창고 Capacity</div>
          <div className="text-4xl font-black text-[#F7A600] leading-none">{avgCapacity}<span className="text-lg font-semibold">%</span></div>
          <div className="h-1.5 bg-[#F0F0F0] rounded-full mt-3"><div className="h-full bg-[#F7A600] rounded-full" style={{ width: `${avgCapacity}%` }} /></div>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm border-t-4 border-[#EA002C]">
          <div className="text-[11px] text-[#999] mb-1 font-medium">재고 경보 품목</div>
          <div className="text-4xl font-black text-[#EA002C] leading-none">{alertItems.length}</div>
          <div className="text-xs mt-2 text-[#EA002C]">위급 {criticalItems.length}건 (5일 미만)</div>
          <div className="h-1.5 bg-[#F0F0F0] rounded-full mt-2"><div className="h-full bg-[#EA002C] rounded-full" style={{ width: `${Math.min((alertItems.length / dohList.length) * 100, 100)}%` }} /></div>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm border-t-4 border-[#F7A600]">
          <div className="text-[11px] text-[#999] mb-1 font-medium">활성 리스크</div>
          <div className="text-4xl font-black text-[#F7A600] leading-none">{risks.length}</div>
          <div className="text-xs mt-2 text-[#999]">
            HIGH {risks.filter((r) => r.level === "HIGH").length} · MID {risks.filter((r) => r.level === "MEDIUM").length}
          </div>
          <div className="h-1.5 bg-[#F0F0F0] rounded-full mt-2"><div className="h-full bg-[#F7A600] rounded-full" style={{ width: `${Math.min(risks.length * 10, 100)}%` }} /></div>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm border-t-4 border-[#EA002C]">
          <div className="text-[11px] text-[#999] mb-1 font-medium">인프라 교체 임박</div>
          <div className="text-4xl font-black text-[#EA002C] leading-none">{infraUrgent.length}</div>
          <div className="text-xs mt-2 text-[#999]">사용률 80% 초과</div>
          <div className="h-1.5 bg-[#F0F0F0] rounded-full mt-2"><div className="h-full bg-[#EA002C] rounded-full" style={{ width: `${Math.min(infraUrgent.length * 15, 100)}%` }} /></div>
        </div>
      </div>

      {/* 창고 현황 + 리스크 */}
      <div className="grid grid-cols-2 gap-5 mb-5">
        {/* 창고 현황 */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#F0F0F0] flex items-center justify-between">
            <span className="text-[13px] font-bold">창고별 Capacity 현황</span>
            <span className="text-[10px] font-semibold bg-[#E8F3FF] text-[#0078D4] px-2.5 py-1 rounded-full">실시간</span>
          </div>
          <div className="px-5 py-4 space-y-4">
            {warehouseStats.map((wh) => (
              <div key={wh.id}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="font-semibold">{wh.name}</span>
                </div>
                <WarehouseBar pct={wh.pct} />
                <div className="text-[11px] text-[#999] mt-1">
                  {wh.usedCapacity.toLocaleString()} / {wh.totalCapacity.toLocaleString()} {wh.unit}
                  {wh.temperature && <span className="ml-2">· {wh.temperature}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 리스크 */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#F0F0F0] flex items-center justify-between">
            <span className="text-[13px] font-bold">활성 리스크</span>
            <span className="text-[10px] font-semibold bg-[#FFF0F2] text-[#EA002C] px-2.5 py-1 rounded-full">{risks.length}건</span>
          </div>
          <div className="px-5 py-4 space-y-3">
            {risks.map((risk) => {
              const s = RISK_STYLES[risk.level] ?? RISK_STYLES.LOW;
              return (
                <div key={risk.id} className="rounded-xl p-3" style={{ backgroundColor: s.bg, color: s.text }}>
                  <div className="flex items-start gap-2">
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded mt-0.5" style={{ background: s.text, color: "#fff" }}>{s.label}</span>
                    <div className="flex-1">
                      <div className="text-xs font-semibold leading-snug">{risk.title}</div>
                      <div className="text-[10px] opacity-75 mt-0.5">담당: {risk.owner} · {risk.category}</div>
                    </div>
                  </div>
                </div>
              );
            })}
            {risks.length === 0 && (
              <div className="text-sm text-[#999] text-center py-6">활성 리스크 없음</div>
            )}
          </div>
        </div>
      </div>

      {/* 재고 경보 + 최근 트랜잭션 */}
      <div className="grid grid-cols-2 gap-5">
        {/* 재고 경보 */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#F0F0F0] flex items-center justify-between">
            <span className="text-[13px] font-bold">재고 경보 품목</span>
            <span className="text-[10px] font-semibold bg-[#FFF0F2] text-[#EA002C] px-2.5 py-1 rounded-full">{alertItems.length}건</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#FAFAFA] border-b border-[#F0F0F0]">
                  <th className="text-left px-5 py-2.5 text-[11px] text-[#999] font-semibold">자재</th>
                  <th className="text-right px-5 py-2.5 text-[11px] text-[#999] font-semibold">현재고</th>
                  <th className="text-right px-5 py-2.5 text-[11px] text-[#999] font-semibold">보관일수</th>
                </tr>
              </thead>
              <tbody>
                {alertItems.slice(0, 6).map((inv) => (
                  <tr key={inv.id} className="border-b border-[#F8F8F8] hover:bg-[#FAFAFA]">
                    <td className="px-5 py-2.5">
                      <div className="font-semibold text-[#111]">{inv.material.name}</div>
                      <div className="text-[10px] text-[#999] font-mono">{inv.material.code}</div>
                    </td>
                    <td className="px-5 py-2.5 text-right font-semibold">{inv.quantity.toLocaleString()} {inv.material.unit}</td>
                    <td className="px-5 py-2.5 text-right">
                      <DOHBadge doh={inv.doh} ropDays={inv.material.ropDays} />
                    </td>
                  </tr>
                ))}
                {alertItems.length === 0 && (
                  <tr><td colSpan={3} className="px-5 py-8 text-center text-[#999]">재고 경보 없음 ✅</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 최근 입출고 */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#F0F0F0]">
            <span className="text-[13px] font-bold">최근 입출고</span>
          </div>
          <div className="px-5 py-4 space-y-3">
            {recentTx.length === 0 && (
              <div className="text-sm text-center text-[#999] py-6">입출고 내역 없음</div>
            )}
            {recentTx.map((tx) => (
              <div key={tx.id} className="flex items-center gap-3">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${tx.type === "IN" ? "bg-[#E6FAF1] text-[#065F46]" : "bg-[#FFF0F2] text-[#991B1B]"}`}>
                  {tx.type === "IN" ? "입고" : "출고"}
                </span>
                <div className="flex-1">
                  <div className="text-xs font-semibold">{tx.material.name}</div>
                  <div className="text-[10px] text-[#999]">{tx.user.name} · {new Date(tx.date).toLocaleDateString("ko-KR")}</div>
                </div>
                <span className="text-xs font-bold">{tx.quantity.toLocaleString()} {tx.material.unit}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
