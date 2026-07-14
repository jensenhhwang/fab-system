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
  processName: string;
  site: string[];
  product: Product;
  cells: ProcessReadinessCell[];
};

export async function GET() {
  const { processUsage, inventory, materials, processMetadata } = await collections();

  const [usages, invRows, mats, metaDocs] = await Promise.all([
    processUsage.find({}).toArray(),
    inventory.find({}).toArray(),
    materials.find({}).toArray(),
    processMetadata.find({}).toArray(),
  ]);

  const matMap = new Map(mats.map(m => [m._id, m]));
  const metaMap = new Map(metaDocs.map(m => [m._id, m]));

  const availMap = new Map<string, number>();
  for (const inv of invRows) {
    availMap.set(inv.materialId, (availMap.get(inv.materialId) ?? 0) + inv.quantity);
  }

  const rowMap = new Map<string, ProcessReadinessRow>();
  for (const u of usages) {
    const key = `${u.processCode}-${u.product}`;
    if (!rowMap.has(key)) {
      const meta = metaMap.get(u.processCode);
      rowMap.set(key, {
        processCode: u.processCode,
        processName: meta?.name ?? u.processCode,
        site: meta?.site ?? [],
        product: u.product as Product,
        cells: [],
      });
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
