import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const materialId = searchParams.get("materialId") ?? undefined;
  const type = searchParams.get("type") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 200);

  const { inventoryMovements } = await collections();
  const filter: Record<string, unknown> = { type: { $in: ["RECEIPT", "ISSUE"] } };
  if (materialId) filter.materialId = materialId;
  if (type === "INBOUND") filter.type = "RECEIPT";
  if (type === "OUTBOUND") filter.type = "ISSUE";

  const pipeline = [
    { $match: filter },
    { $sort: { createdAt: -1 } },
    { $limit: limit },
    { $lookup: { from: "materials", localField: "materialId", foreignField: "_id", as: "material" } },
    { $unwind: { path: "$material", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "inventoryLots", localField: "lotId", foreignField: "_id", as: "lot" } },
    { $unwind: { path: "$lot", preserveNullAndEmptyArrays: true } },
  ];

  const docs = await inventoryMovements.aggregate(pipeline).toArray();
  return NextResponse.json(docs);
}
