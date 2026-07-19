import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { advanceAggregateWip, ensureAggregateWip, getAggregateWipSummary } from "@/lib/lot-route";
import { FAB_IDS, type FabId } from "@/lib/fab-domain";
import type { Product } from "@/lib/db";

export const dynamic = "force-dynamic";

const PRODUCTS: Product[] = ["HBM", "DRAM", "NAND"];

export async function GET(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const fabId = req.nextUrl.searchParams.get("fabId") as FabId | null;
  const product = req.nextUrl.searchParams.get("product") as Product | null;
  if (!fabId || !FAB_IDS.includes(fabId)) {
    return NextResponse.json({ error: "fabId는 M20/M21/M22 중 하나여야 합니다." }, { status: 400 });
  }
  if (!product || !PRODUCTS.includes(product)) {
    return NextResponse.json({ error: "product는 HBM/DRAM/NAND 중 하나여야 합니다." }, { status: 400 });
  }

  try {
    const summary = await getAggregateWipSummary(fabId, product);
    return NextResponse.json({ ...summary, readOnly: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AGGREGATE WIP 조회 실패" }, { status: 409 });
  }
}

export async function POST(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.fabScenario);
  if (access.error) return access.error;

  const fabId = req.nextUrl.searchParams.get("fabId") as FabId | null;
  const product = req.nextUrl.searchParams.get("product") as Product | null;
  if (!fabId || !FAB_IDS.includes(fabId) || !product || !PRODUCTS.includes(product)) {
    return NextResponse.json({ error: "유효한 fabId와 product가 필요합니다." }, { status: 400 });
  }

  const body = await req.json() as { action?: "reconcile" | "advance" };
  try {
    if (body.action === "reconcile") {
      const result = await ensureAggregateWip(fabId, product, access.user.id);
      return NextResponse.json({ action: body.action, result, summary: await getAggregateWipSummary(fabId, product) });
    }
    if (body.action === "advance") {
      const result = await advanceAggregateWip(fabId, product);
      return NextResponse.json({ action: body.action, result, summary: await getAggregateWipSummary(fabId, product) });
    }
    return NextResponse.json({ error: "action은 reconcile 또는 advance여야 합니다." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AGGREGATE WIP 변경 실패" }, { status: 409 });
  }
}
