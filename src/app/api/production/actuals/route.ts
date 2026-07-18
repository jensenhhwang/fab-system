import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { confirmProductionActual, getActualsForDate, PRODUCTS, todayKST } from "@/lib/production-actuals";
import type { Product } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? todayKST();
  return NextResponse.json({ date, actuals: await getActualsForDate(date) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.productionActualConfirm);
  if (access.error) return access.error;
  const body = await req.json() as { product?: Product; date?: string; producedQty?: number; note?: string; reason?: string };
  if (!body.product || !PRODUCTS.includes(body.product)) {
    return NextResponse.json({ error: "product는 HBM/DRAM/NAND 중 하나여야 합니다." }, { status: 400 });
  }
  if (typeof body.producedQty !== "number" || !Number.isFinite(body.producedQty) || body.producedQty < 0) {
    return NextResponse.json({ error: "producedQty는 0 이상의 숫자여야 합니다." }, { status: 400 });
  }
  const date = body.date ?? todayKST();
  try {
    const doc = await confirmProductionActual({
      product: body.product, date, producedQty: body.producedQty, note: body.note, reason: body.reason, enteredBy: access.user.id,
    });
    return NextResponse.json(doc);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "생산실적 확정 실패" }, { status: 409 });
  }
}
