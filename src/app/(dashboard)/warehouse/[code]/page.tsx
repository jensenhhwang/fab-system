export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { getFacilityTelemetry, getInventoryRows, getWarehouseCapacity, getWarehouseOperationalLayout } from "@/lib/queries";
import { buildVirtualWarehouseLayout } from "@/lib/warehouse-layout";
import WarehouseDetailClient from "./WarehouseDetailClient";

export default async function WarehouseDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const normalizedCode = code.toUpperCase();
  const [warehouses, inventoryRows, operationalLayout, telemetry] = await Promise.all([
    getWarehouseCapacity(), getInventoryRows(true), getWarehouseOperationalLayout(normalizedCode), getFacilityTelemetry(normalizedCode),
  ]);
  const warehouse = warehouses.find((item) => item.code === normalizedCode);
  if (!warehouse) notFound();

  const inventory = inventoryRows
    .filter((item) => item.warehouseId === warehouse.id)
    .map((item) => ({
      materialId: item.materialId,
      quantity: item.quantity,
      dailyUsage: item.dailyUsage,
      doh: item.doh,
      status: item.status,
      material: {
        code: item.material.code,
        name: item.material.name,
        category: item.material.category,
        unit: item.material.unit,
      },
    }));
  const locations = operationalLayout ?? buildVirtualWarehouseLayout(warehouse.code, warehouse.type, inventory);

  return (
    <div className="h-[calc(100dvh-148px)] min-h-[520px] flex flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-4 mb-3 shrink-0">
        <div>
          <Link href="/warehouse" className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0078D4] hover:underline mb-1">
            ← 창고 Capacity
          </Link>
          <div className="text-xl font-extrabold tracking-tight">{warehouse.name}</div>
          <div className="text-xs text-[#999] mt-0.5">가상 위치 기반 상세 3D · 위치를 선택해 보관 자재를 확인하세요</div>
        </div>
        <span className="rounded-full bg-[#EAF4FF] text-[#0078D4] px-3 py-1.5 text-[11px] font-bold">Phase 1 · 위치 시뮬레이션</span>
      </div>

      <WarehouseDetailClient warehouse={warehouse} locations={locations} telemetry={telemetry} />
    </div>
  );
}
