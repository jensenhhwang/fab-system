export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { getFacilityTelemetry, getInventoryRows, getWarehouseCapacity, getWarehouseOperationalLayout } from "@/lib/queries";
import { buildVirtualWarehouseLayout } from "@/lib/warehouse-layout";
import { FAB_IDS, type FabId } from "@/lib/fab-domain";
import WarehouseDetailClient from "./WarehouseDetailClient";
import FinishedGoodsSiloClient from "./FinishedGoodsSiloClient";

type WarehouseTwinQuery = {
  fab?: string; material?: string; facility?: string; lot?: string; hu?: string;
  alert?: string; step?: string; mode?: string; time?: string; camera?: string;
};

export default async function WarehouseDetailPage({ params, searchParams }: {
  params: Promise<{ code: string }>;
  searchParams: Promise<WarehouseTwinQuery>;
}) {
  const { code } = await params;
  const query = await searchParams;
  const normalizedCode = code.toUpperCase();
  const [warehouses, inventoryRows, operationalLayout, telemetry] = await Promise.all([
    getWarehouseCapacity(), getInventoryRows(true), getWarehouseOperationalLayout(normalizedCode), getFacilityTelemetry(normalizedCode),
  ]);
  const warehouse = warehouses.find((item) => item.code === normalizedCode);
  if (!warehouse) notFound();

  // 완제품 창고는 LOT/HU 단위 3D 레이아웃 개념이 없다(WaferLot 1개=완제품 1개가 아니라
  // 다이싱→KGD→스택으로 팬아웃되는 aggregate 모델) — 위치 기반 3D 대신 탱크형 사일로로 분기한다.
  if (warehouse.type === "FINISHED_GOODS") {
    return (
      <div>
        <div className="mb-1 flex items-center gap-3">
          <Link href="/warehouse" className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0078D4] hover:underline">← 창고 Capacity</Link>
        </div>
        <div className="text-xl font-extrabold tracking-tight">{warehouse.name}</div>
        <div className="text-xs text-[#999] mt-0.5 mb-5">완제품 aggregate 재고 · 채움 높이가 점유율을 나타내는 사일로 뷰</div>
        <FinishedGoodsSiloClient warehouse={warehouse} />
      </div>
    );
  }

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
  // operationalLayout이 있어도 점유율 괴리가 20%p 이상이면 가상 레이아웃 사용
  // (DB 슬롯 데이터가 inventory 기반 utilization과 동기화 안 된 경우 방지)
  const opOccPct = operationalLayout
    ? Math.round(operationalLayout.filter(l => l.status !== "AVAILABLE").length / Math.max(operationalLayout.length, 1) * 100)
    : null;
  const useVirtual = !operationalLayout || Math.abs((opOccPct ?? 0) - warehouse.utilization) > 20;
  const locations = useVirtual
    ? buildVirtualWarehouseLayout(warehouse.code, warehouse.type, inventory, { utilization: warehouse.utilization, byCategory: warehouse.byCategory })
    : operationalLayout!;
  const fabScope = query.fab && FAB_IDS.includes(query.fab as FabId) ? query.fab as FabId : "CAMPUS";
  return (
    <div className="h-[calc(100dvh-148px)] min-h-[520px] flex flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-4 mb-3 shrink-0">
        <div>
          <div className="mb-1 flex items-center gap-3">
            <Link href="/warehouse" className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0078D4] hover:underline">← 창고 Capacity</Link>
          </div>
          <div className="text-xl font-extrabold tracking-tight">{warehouse.name}</div>
          <div className="text-xs text-[#999] mt-0.5">위치 기반 상세 3D · 위치별 수요가 배정되기 전에는 HU 단위 DOH를 계산하지 않습니다.</div>
        </div>
        <div className="flex items-center gap-2">
          {(query.material || query.facility) && <span className="rounded-full bg-[#EAF4FF] px-3 py-1.5 font-mono text-[10px] font-black text-[#0078D4]">TWIN · {fabScope}{query.material ? ` · ${query.material} 위치 강조` : " · 전체 재고"}</span>}
          <span className="rounded-full bg-[#EAF4FF] text-[#0078D4] px-3 py-1.5 text-[11px] font-bold">Phase 1 · 위치 시뮬레이션</span>
        </div>
      </div>

      <WarehouseDetailClient warehouse={warehouse} locations={locations} telemetry={telemetry} initialMaterialId={query.material} />
    </div>
  );
}
