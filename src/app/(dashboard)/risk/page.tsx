import { getWarehouseCapacity, getWarehouses } from "@/lib/queries";
import Link from "next/link";

const WH_CAPACITY_PALLET: Record<string, number> = {
  "MWH-01": 7000, "MWH-02": 2600, "HZW-01": 800, "MRO-01": 2200,
};

export const dynamic = "force-dynamic";

async function getCapacityAlerts() {
  const [capacities, warehouses] = await Promise.all([getWarehouseCapacity(), getWarehouses()]);
  const capMap = new Map(capacities.map((c) => [c.code, c]));
  return warehouses
    .filter((w) => WH_CAPACITY_PALLET[w.code])
    .map((w) => {
      const cap = capMap.get(w.code);
      const util = cap?.utilization ?? 0;
      const palletCap = WH_CAPACITY_PALLET[w.code];
      const usedPallets = Math.round(palletCap * util / 100);
      const freePallets = palletCap - usedPallets;
      const level: "high" | "medium" | "low" =
        util >= 80 ? "high" : util >= 60 ? "medium" : "low";
      return { code: w.code, name: w.name, util, palletCap, usedPallets, freePallets, level };
    });
}

export default async function RiskPage() {
  const alerts = await getCapacityAlerts();
  const highRisk = alerts.filter((a) => a.level === "high");
  const medRisk = alerts.filter((a) => a.level === "medium");

  return (
    <>
      <div className="mb-1 text-2xl font-extrabold tracking-tight">리스크 관리</div>
      <div className="text-sm text-[#999] mb-8">공급·창고·인프라 리스크 등록·모니터링</div>

      {/* FAB 확장 어드바이저 */}
      <section className="mb-6">
        <div className="text-xs font-bold uppercase tracking-widest text-[#999] mb-3">FAB 확장 어드바이저</div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          {alerts.map((a) => {
            const barColor = a.level === "high" ? "#EA002C" : a.level === "medium" ? "#F97316" : "#00875A";
            const bgColor = a.level === "high" ? "#FFF0F2" : a.level === "medium" ? "#FFF7ED" : "#F0FDF4";
            return (
              <Link key={a.code} href={`/warehouse/${a.code}`}
                className="bg-white rounded-2xl border border-[#E8E8E8] p-5 hover:shadow-md transition-shadow block">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <span className="text-sm font-bold text-[#1A1A1A]">{a.code}</span>
                    <span className="text-xs text-[#999] ml-2">{a.name}</span>
                  </div>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ color: barColor, backgroundColor: bgColor }}>
                    {a.level === "high" ? "고위험" : a.level === "medium" ? "주의" : "정상"}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-1 h-2 bg-[#F0EFED] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${a.util}%`, backgroundColor: barColor }} />
                  </div>
                  <span className="text-sm font-bold" style={{ color: barColor }}>{a.util}%</span>
                </div>
                <div className="flex justify-between text-[10px] text-[#999] mt-1">
                  <span>사용 {a.usedPallets.toLocaleString()} / {a.palletCap.toLocaleString()} pallet</span>
                  <span>여유 {a.freePallets.toLocaleString()} pallet</span>
                </div>
              </Link>
            );
          })}
        </div>

        {/* 확장 권고 배너 */}
        {highRisk.length > 0 && (
          <div className="bg-[#FFF0F2] border border-[#FFCDD5] rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base">🏗️</span>
              <span className="text-sm font-bold text-[#EA002C]">창고 증설 검토 필요</span>
            </div>
            <div className="text-xs text-[#555] mb-3">
              {highRisk.map((h) => h.code).join(", ")} 창고 점유율이 80% 이상입니다.
              수요 시나리오 시뮬레이터에서 증가 시나리오를 적용하면 더 빠른 포화가 예상됩니다.
            </div>
            <Link href="/simulation/market"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#EA002C] text-white text-xs font-bold rounded-lg hover:bg-[#C8001F] transition-colors">
              수요 시나리오 시뮬레이터 →
            </Link>
          </div>
        )}

        {highRisk.length === 0 && medRisk.length === 0 && (
          <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-2xl p-5 text-sm text-[#00875A] font-medium">
            현재 모든 창고가 정상 수준입니다. 수요 증가 시나리오를 통해 미래 리스크를 미리 확인하세요.
          </div>
        )}
      </section>

      {/* 기타 리스크 — 추후 구현 */}
      <section>
        <div className="text-xs font-bold uppercase tracking-widest text-[#999] mb-3">공급·인프라 리스크</div>
        <div className="flex flex-col items-center justify-center gap-4 py-16 bg-white rounded-2xl border border-dashed border-[#E8E8E8]">
          <div className="text-3xl">🚧</div>
          <div className="text-base font-bold text-[#555]">개발 중</div>
          <div className="text-sm text-[#999] text-center leading-relaxed">
            공급망·인프라 리스크 등록·모니터링<br/>곧 완성될 예정이에요.
          </div>
        </div>
      </section>
    </>
  );
}
