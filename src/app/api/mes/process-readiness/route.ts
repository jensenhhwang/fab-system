import { NextResponse } from "next/server";
import { collections } from "@/lib/db";
import type { Product } from "@/lib/db";

export const dynamic = "force-dynamic";

type ProcessReadinessCell = {
  materialId: string;
  materialName: string;
  dailyUsage: number;
  availableQty: number;
  doh: number;
  ropDays: number;
};

type ProcessReadinessRow = {
  processCode: string;
  product: Product;
  cells: ProcessReadinessCell[];
};

export async function GET() {
  const { processUsage, inventoryLots, materials } = await collections();

  const [usages, lots, mats] = await Promise.all([
    processUsage.find({}).toArray(),
    inventoryLots.find({ qualityStatus: "AVAILABLE" }).toArray(),
    materials.find({}).toArray(),
  ]);

  const matMap = new Map(mats.map(m => [m._id, m]));

  const availMap = new Map<string, number>();
  for (const lot of lots) {
    availMap.set(lot.materialId, (availMap.get(lot.materialId) ?? 0) + lot.availableQuantity);
  }

  const rowMap = new Map<string, ProcessReadinessRow>();
  for (const u of usages) {
    const key = `${u.processCode}-${u.product}`;
    if (!rowMap.has(key)) {
      rowMap.set(key, { processCode: u.processCode, product: u.product as Product, cells: [] });
    }
    const mat = matMap.get(u.materialId);
    const dailyUsage = u.monthlyQty / 30;
    const availableQty = availMap.get(u.materialId) ?? 0;
    const doh = dailyUsage > 0 ? Math.round(availableQty / dailyUsage) : 0;
    rowMap.get(key)!.cells.push({
      materialId: u.materialId,
      materialName: mat?.name ?? u.materialId,
      dailyUsage,
      availableQty,
      doh,
      ropDays: mat?.ropDays ?? 7,
    });
  }

  const rows = Array.from(rowMap.values()).sort((a, b) =>
    a.processCode.localeCompare(b.processCode)
  );

  return NextResponse.json(rows);
}
