import type { Filter } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections, type Product, type WaferLotDoc } from "@/lib/db";
import { FAB_IDS, type FabId } from "@/lib/fab-domain";
import { FOUP_WIP_BOOTSTRAP_VERSION } from "@/lib/foup-wip-model";
import { expandRouteMaster, getRouteMaster } from "@/lib/route-master";

export const dynamic = "force-dynamic";

const PRODUCTS: Product[] = ["HBM", "DRAM", "NAND"];

type NodeCountRow = { _id: string | null; count: number; watchedCount: number };

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
  if (fabId !== "M20" || product !== "HBM") {
    return NextResponse.json({ error: "V1 노드 밀도 집계는 M20 HBM만 지원합니다." }, { status: 409 });
  }

  try {
    const route = await getRouteMaster(fabId, product);
    if (!route) return NextResponse.json({ error: "route master를 찾을 수 없습니다." }, { status: 404 });

    const visits = expandRouteMaster(route);
    const stepRangeByNode = new Map<string, [number, number]>();
    for (const visit of visits) {
      const existing = stepRangeByNode.get(visit.nodeId);
      if (!existing) stepRangeByNode.set(visit.nodeId, [visit.stepIndex, visit.stepIndex]);
      else existing[1] = visit.stepIndex;
    }

    const { waferLots } = await collections();
    const baseFilter: Filter<WaferLotDoc> = {
      fabId,
      product,
      status: "IN_PROGRESS",
      cohort: { $in: ["WATCHED", "MODELED_FOUP"] },
      bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION,
    };

    const [total, watchedTotal, grouped] = await Promise.all([
      waferLots.countDocuments(baseFilter),
      waferLots.countDocuments({ ...baseFilter, cohort: "WATCHED" }),
      waferLots.aggregate<NodeCountRow>([
        { $match: baseFilter },
        { $group: {
          _id: "$currentNodeId",
          count: { $sum: 1 },
          watchedCount: { $sum: { $cond: [{ $eq: ["$cohort", "WATCHED"] }, 1, 0] } },
        } },
      ]).toArray(),
    ]);

    const countByNode = new Map(grouped.map((row) => [row._id, row]));
    const buckets = route.nodes.map((node, order) => {
      const row = countByNode.get(node.id);
      const count = row?.count ?? 0;
      return {
        nodeId: node.id,
        order,
        label: node.label,
        stage: node.stage,
        cycle: node.cycle,
        repeatCount: node.repeatCount,
        stepRange: stepRangeByNode.get(node.id) ?? [0, 0],
        count,
        watchedCount: row?.watchedCount ?? 0,
        percentOfTotal: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      };
    });

    return NextResponse.json({
      fabId,
      product,
      routeMasterId: route._id,
      routeVersion: route.version,
      asOf: new Date().toISOString(),
      total,
      summary: { watchedTotal, modeledTotal: total - watchedTotal },
      buckets,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "노드 밀도 집계 실패" }, { status: 409 });
  }
}
