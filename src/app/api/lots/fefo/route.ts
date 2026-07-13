import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { computeFefo } from "@/lib/fefo";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const materialId = searchParams.get("materialId");
  const qty = Number(searchParams.get("qty") ?? "0");

  if (!materialId || qty <= 0) {
    return NextResponse.json({ error: "materialId, qty 필수" }, { status: 400 });
  }

  const { inventoryLots } = await collections();
  const lots = await inventoryLots
    .find({ materialId, qualityStatus: "AVAILABLE", availableQuantity: { $gt: 0 } })
    .toArray();

  const result = computeFefo(lots, qty);
  return NextResponse.json(result);
}
