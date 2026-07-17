export const dynamic = "force-dynamic";

import { getInventoryRows } from "@/lib/queries";
import { collections } from "@/lib/db";
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
      materialId: inv.materialId,
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
        safetyStock: inv.material.safetyStock,
        ropDays: inv.material.ropDays,
      },
      warehouse: { name: inv.warehouse.name },
    };
  });
}

export default async function InventoryPage() {
  const baseItems = await getInventoryData();

  const { inventoryLots, inventoryPolicies, inboundPlans, simState: simStateColl } = await collections();
  const [lotAgg, policyDocs, activeInbound, simStateDoc] = await Promise.all([
    inventoryLots.aggregate<{ _id: string; count: number }>([
      { $match: { qualityStatus: "AVAILABLE" } },
      { $group: { _id: "$materialId", count: { $sum: 1 } } },
    ]).toArray(),
    inventoryPolicies.find({}).toArray(),
    inboundPlans.aggregate<{ _id: string; quantity: number }>([
      { $match: { status: { $in: ["DRAFT", "CONFIRMED"] }, remainingQuantity: { $gt: 0 } } },
      { $group: { _id: "$materialId", quantity: { $sum: "$remainingQuantity" } } },
    ]).toArray(),
    simStateColl.findOne({ _id: "singleton" }),
  ]);
  const lotCounts = Object.fromEntries(lotAgg.map((r) => [r._id, r.count]));
  const policyMap = new Map(policyDocs.map(policy => [policy.materialId, policy]));
  const inboundMap = new Map(activeInbound.map(item => [item._id, item.quantity]));
  const items = baseItems.map(item => {
    const policy = policyMap.get(item.materialId);
    const plannedInboundQuantity = inboundMap.get(item.materialId) ?? 0;
    const projectedQuantity = item.quantity + plannedInboundQuantity;
    const minimumTarget = Math.ceil(item.material.safetyStock + item.avgDailyUsage);
    return { ...item, targetQuantity: policy?.targetQuantity ?? null, shortageQuantity: policy?.shortageQuantity ?? null,
      policyStatus: policy?.status ?? null, policyReason: policy?.blockReason ?? null, protectedDays: policy?.protectedDays ?? null,
      plannedInboundQuantity, projectedQuantity, projectedDoh: item.avgDailyUsage > 0 ? projectedQuantity / item.avgDailyUsage : null,
      scaleUpTargetQuantity: Math.max(minimumTarget, policy?.targetQuantity ?? 0) };
  });

  return (
    <>
      {simStateDoc?.status === "RUNNING" && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-xl text-sm font-medium w-fit">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          시뮬레이션 진행 중 · {new Date(simStateDoc.simDate).toLocaleDateString("ko-KR")}
        </div>
      )}
      <div className="mb-1 text-2xl font-extrabold tracking-tight">재고 · 보관일수</div>
      <div className="text-sm text-[#999] mb-6">
        전체 자재 DOH = 전체 현재고 ÷ 전체 일평균사용량 · 위치/HU 단위 DOH는 수요 배정 전 계산하지 않음 · 기준: {new Date().toLocaleDateString("ko-KR")}
      </div>
      <InventoryClient items={items} lotCounts={lotCounts} />
    </>
  );
}
