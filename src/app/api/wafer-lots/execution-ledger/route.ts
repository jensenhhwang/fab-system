import type { Filter } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections, type Product, type WaferLotDoc } from "@/lib/db";
import { FAB_IDS, type FabId } from "@/lib/fab-domain";
import { FOUP_WIP_BOOTSTRAP_VERSION } from "@/lib/foup-wip-model";
import { expandRouteMaster } from "@/lib/route-master";
import { normalizeProcessCode } from "@/lib/route-contract";

export const dynamic = "force-dynamic";

const PRODUCTS: Product[] = ["HBM", "DRAM", "NAND"];
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

function positiveInteger(value: string | null, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
    return NextResponse.json({ error: "V1 실행 원장은 M20 HBM만 지원합니다." }, { status: 409 });
  }

  const requestedPage = positiveInteger(req.nextUrl.searchParams.get("page"), 1);
  const pageSize = positiveInteger(req.nextUrl.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const query = req.nextUrl.searchParams.get("q")?.trim().slice(0, 80) ?? "";
  const baseFilter: Filter<WaferLotDoc> = {
    fabId,
    product,
    status: "IN_PROGRESS",
    cohort: { $in: ["WATCHED", "MODELED_FOUP"] },
    bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION,
  };
  const filter: Filter<WaferLotDoc> = query
    ? { ...baseFilter, $or: [
      { _id: { $regex: escapeRegex(query), $options: "i" } },
      { foupCode: { $regex: escapeRegex(query), $options: "i" } },
      { currentNodeId: { $regex: escapeRegex(query), $options: "i" } },
    ] }
    : baseFilter;

  try {
    const { waferLots, routeMasters, productionCarriers, lotCarrierAssignments } = await collections();
    const [total, activeTotal, watchedTotal] = await Promise.all([
      waferLots.countDocuments(filter),
      waferLots.countDocuments(baseFilter),
      waferLots.countDocuments({ ...baseFilter, cohort: "WATCHED" }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const lots = await waferLots.find(filter)
      .sort({ watched: -1, modeledReleaseAt: -1, _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray();

    const routeIds = [...new Set(lots.map((lot) => lot.routeMasterId))];
    const lotIds = lots.map((lot) => lot._id);
    const carrierIds = lots.map((lot) => lot.foupCode);
    const [routes, carriers, assignments] = await Promise.all([
      routeMasters.find({ _id: { $in: routeIds } }).toArray(),
      productionCarriers.find({ _id: { $in: carrierIds } }).toArray(),
      lotCarrierAssignments.find({ lotId: { $in: lotIds }, status: "ACTIVE" }).toArray(),
    ]);
    const routeById = new Map(routes.map((route) => [route._id, { route, visits: expandRouteMaster(route) }]));
    const carrierById = new Map(carriers.map((carrier) => [carrier._id, carrier]));
    const assignmentByLot = new Map(assignments.map((assignment) => [assignment.lotId, assignment]));

    const rows = lots.map((lot) => {
      const routeState = routeById.get(lot.routeMasterId);
      const totalSteps = routeState?.visits.length ?? 0;
      const currentStepIndex = Math.max(0, Math.min(lot.currentStepIndex ?? 0, Math.max(0, totalSteps - 1)));
      const visit = routeState?.visits[currentStepIndex];
      const carrier = carrierById.get(lot.foupCode);
      const assignment = assignmentByLot.get(lot._id);
      const node = routeState?.route.nodes.find((candidate) => candidate.id === (lot.currentNodeId ?? visit?.nodeId));
      return {
        lotId: lot._id,
        foupCode: lot.foupCode,
        cohort: lot.cohort,
        watched: lot.watched === true,
        status: lot.status,
        waferQty: lot.waferQty ?? 25,
        routeMasterId: lot.routeMasterId,
        routeVersion: routeState?.route.version ?? null,
        currentStepIndex,
        totalSteps,
        progressPct: totalSteps > 0 ? Math.round(currentStepIndex / totalSteps * 100) : 0,
        processCode: normalizeProcessCode(carrier?.currentProcessCode ?? visit?.processCode ?? "-"),
        nodeId: lot.currentNodeId ?? visit?.nodeId ?? null,
        nodeLabel: node?.label ?? visit?.label ?? lot.currentNodeId ?? null,
        operationCode: visit?.operationCode ?? null,
        stage: visit?.stage ?? null,
        carrierState: carrier?.state ?? null,
        movementStatus: carrier?.movementStatus ?? null,
        currentLocationId: carrier?.currentLocationId ?? null,
        assignmentStatus: assignment?.status ?? null,
        assignedAt: assignment?.assignedAt ?? null,
        modeledReleaseAt: lot.modeledReleaseAt ?? null,
        nextTransitionAt: lot.nextTransitionAt ?? null,
        lastEventAt: lot.lastEventAt ?? null,
        dwellModel: lot.dwellModel ?? null,
        source: lot.source ?? "MODELED_BASELINE",
      };
    });

    return NextResponse.json({
      bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION,
      page,
      pageSize,
      total,
      totalPages,
      query,
      summary: { activeTotal, watchedTotal, modeledTotal: activeTotal - watchedTotal },
      rows,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Lot 실행 원장 조회 실패" }, { status: 409 });
  }
}
