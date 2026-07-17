import "server-only";

import { collections } from "@/lib/db";
import type { LiveTransfer } from "@/lib/live-transfer";

export async function getLiveTransfers(): Promise<LiveTransfer[]> {
  const { transferOrders, materials } = await collections();
  const orders = await transferOrders.find({ status: { $in: ["CREATED", "PICKING", "STAGED", "IN_TRANSIT", "RECEIVED"] } }).sort({ updatedAt: -1 }).limit(500).toArray();
  if (!orders.length) return [];
  const materialDocs = await materials.find({ _id: { $in: [...new Set(orders.map((order) => order.materialId))] } }).toArray();
  const materialMap = new Map(materialDocs.map((material) => [material._id, material]));
  return orders.map((order) => {
    const material = materialMap.get(order.materialId);
    return {
      id: order._id,
      allocationId: order.allocationId,
      workOrderId: order.workOrderId,
      materialId: order.materialId,
      materialCode: material?.code ?? order.materialId,
      materialName: material?.name ?? order.materialId,
      category: material?.category ?? "UNKNOWN",
      fabId: order.fabId,
      quantity: order.quantity,
      unit: order.unit,
      fromFacilityId: order.fromFacilityId,
      toFacilityId: order.toFacilityId,
      fromLocationId: order.fromLocationId,
      toLocationId: order.toLocationId,
      lotId: order.lotId,
      handlingUnitId: order.handlingUnitId,
      status: order.status,
      requestedAt: (order.requestedAt ?? order.createdAt).toISOString(),
      pickedAt: order.pickedAt?.toISOString(),
      stagedAt: order.stagedAt?.toISOString(),
      departedAt: order.departedAt?.toISOString(),
      eta: order.eta?.toISOString(),
      receivedAt: order.receivedAt?.toISOString(),
      deliveredAt: order.deliveredAt?.toISOString(),
      telemetryAt: order.telemetryAt?.toISOString(),
      lastPosition: order.lastPosition,
      version: order.version ?? 0,
      updatedAt: order.updatedAt.toISOString(),
    };
  });
}
