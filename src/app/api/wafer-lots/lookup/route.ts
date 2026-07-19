import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections } from "@/lib/db";
import { getRouteMaster, expandRouteMaster } from "@/lib/route-master";
import { getLotRouteState } from "@/lib/lot-route";
import { FAB_IDS, type FabId } from "@/lib/fab-domain";
import type { Product } from "@/lib/db";

export const dynamic = "force-dynamic";

const PRODUCTS: Product[] = ["HBM", "DRAM", "NAND"];

export async function GET(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const fabId = req.nextUrl.searchParams.get("fabId") as FabId | null;
  const product = req.nextUrl.searchParams.get("product") as Product | null;
  const foupCode = req.nextUrl.searchParams.get("foupCode")?.trim();
  if (!fabId || !FAB_IDS.includes(fabId)) {
    return NextResponse.json({ error: "fabId는 M20/M21/M22 중 하나여야 합니다." }, { status: 400 });
  }
  if (!product || !PRODUCTS.includes(product)) {
    return NextResponse.json({ error: "product는 HBM/DRAM/NAND 중 하나여야 합니다." }, { status: 400 });
  }
  if (!foupCode) {
    return NextResponse.json({ error: "foupCode 필수" }, { status: 400 });
  }

  const { waferLots } = await collections();
  const lot = await waferLots.find({ fabId, product, foupCode }).sort({ createdAt: -1 }).limit(1).next();
  if (!lot) {
    return NextResponse.json({ error: `해당 foupCode를 찾을 수 없습니다: ${foupCode}` }, { status: 404 });
  }

  if (lot.cohort === "AGGREGATE") {
    const routeMaster = await getRouteMaster(fabId, product);
    const totalSteps = routeMaster ? expandRouteMaster(routeMaster).length : 0;
    const nodeLabel = routeMaster?.nodes.find((node) => node.id === lot.currentNodeId)?.label ?? lot.currentNodeId ?? null;
    return NextResponse.json({
      foupCode: lot.foupCode, status: lot.status, cohort: "AGGREGATE" as const,
      nodeId: lot.currentNodeId ?? null, nodeLabel,
      stepIndex: lot.currentStepIndex ?? null, totalSteps,
      lastEventAt: lot.lastEventAt ?? null,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const state = await getLotRouteState(lot._id);
  const visit = state.currentVisit ?? state.history.at(-1);
  const node = visit ? state.nodes.find((candidate) => candidate.id === visit.nodeId) : undefined;
  return NextResponse.json({
    foupCode: lot.foupCode, status: lot.status, cohort: "VISUAL" as const,
    nodeId: visit?.nodeId ?? null, nodeLabel: node?.label ?? visit?.nodeId ?? null,
    stepIndex: visit?.stepIndex ?? null, totalSteps: state.totalSteps,
    lastEventAt: state.history.at(-1)?.completedAt ?? null,
  }, { headers: { "Cache-Control": "no-store" } });
}
