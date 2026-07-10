import { db } from "@/lib/db";
import InventoryClient from "./InventoryClient";

async function getInventoryData() {
  const inventories = await db.inventory.findMany({
    include: { material: true, warehouse: true },
    orderBy: { material: { code: "asc" } },
  });

  return inventories.map((inv) => {
    const doh = inv.avgDailyUsage > 0 ? inv.quantity / inv.avgDailyUsage : null;
    const status =
      doh === null      ? "nodata"
      : doh < 5         ? "critical"
      : doh < inv.material.ropDays ? "warning"
      : doh < inv.material.ropDays * 2 ? "ok"
      : "safe";
    return {
      id: inv.id,
      quantity: inv.quantity,
      avgDailyUsage: inv.avgDailyUsage,
      doh,
      status,
      material: {
        code: inv.material.code,
        name: inv.material.name,
        nameEn: inv.material.nameEn,
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
        보관일수(DOH) = 현재고 ÷ 일평균사용량 · 기준: {new Date().toLocaleDateString("ko-KR")}
      </div>
      <InventoryClient items={items} />
    </>
  );
}
