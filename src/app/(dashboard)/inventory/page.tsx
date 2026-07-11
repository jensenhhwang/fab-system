export const dynamic = "force-dynamic";

import { getInventoryRows } from "@/lib/queries";
import InventoryClient from "./InventoryClient";

async function getInventoryData() {
  // 일사용량·DOH는 ProcessUsage 마스터에서 유도 (공정별 사용량 탭과 정합)
  const inventories = await getInventoryRows(true);

  return inventories.map((inv) => {
    // ropDays=0 인 자재(UPW 등 현장생산)는 DOH 개념이 없어 nodata 처리
    const doh = inv.material.ropDays === 0 ? null : inv.doh;
    const status =
      doh === null      ? "nodata"
      : doh < 5         ? "critical"
      : doh < inv.material.ropDays ? "warning"
      : doh < inv.material.ropDays * 2 ? "ok"
      : "safe";
    return {
      id: inv.id,
      quantity: inv.quantity,
      avgDailyUsage: Math.round(inv.dailyUsage * 10) / 10,
      monthlyQty: Math.round(inv.monthlyQty),
      usageSource: inv.usageSource,
      doh,
      status,
      material: {
        code: inv.material.code,
        name: inv.material.name,
        nameEn: inv.material.nameEn ?? null,
        category: inv.material.category,
        unit: inv.material.unit,
        ropDays: inv.material.ropDays,
      },
      warehouse: { name: inv.warehouse.name },
    };
  });
}

export default async function InventoryPage() {
  const items = await getInventoryData();
  return (
    <>
      <div className="mb-1 text-2xl font-extrabold tracking-tight">재고 · 보관일수</div>
      <div className="text-sm text-[#999] mb-6">
        보관일수(DOH) = 현재고 ÷ 일평균사용량 · 일사용량은 공정별 사용량에서 유도 · 기준: {new Date().toLocaleDateString("ko-KR")}
      </div>
      <InventoryClient items={items} />
    </>
  );
}
