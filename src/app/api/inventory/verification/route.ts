import { NextRequest, NextResponse } from "next/server";
import type { InventoryVerificationCaseStatus } from "@/lib/db";
import { requireRole } from "@/lib/api-auth";
import { VERIFICATION_READ_ROLES } from "@/lib/inventory-verification";
import {
  getInventoryVerificationSummary,
  listInventoryVerificationCases,
} from "@/lib/inventory-verification-server";

export const dynamic = "force-dynamic";

const STATUSES = new Set<InventoryVerificationCaseStatus>([
  "AWAITING_OBSERVATION",
  "OBSERVED",
  "SOURCE_DRIFT",
]);

export async function GET(request: NextRequest) {
  const access = await requireRole(VERIFICATION_READ_ROLES);
  if (access.error) return access.error;
  const search = request.nextUrl.searchParams;
  const rawStatus = search.get("status");
  if (rawStatus && !STATUSES.has(rawStatus as InventoryVerificationCaseStatus)) {
    return NextResponse.json({ error: "지원하지 않는 검증 상태입니다." }, { status: 400 });
  }
  const rawLimit = search.get("limit");
  const limit = rawLimit ? Number(rawLimit) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
    return NextResponse.json({ error: "limit은 1~100 정수여야 합니다." }, { status: 400 });
  }
  const [page, summary] = await Promise.all([
    listInventoryVerificationCases({
      ...(rawStatus ? { status: rawStatus as InventoryVerificationCaseStatus } : {}),
      ...(search.get("warehouseId") ? { warehouseId: search.get("warehouseId")! } : {}),
      ...(search.get("materialId") ? { materialId: search.get("materialId")! } : {}),
      ...(search.get("cursor") ? { cursor: search.get("cursor")! } : {}),
      ...(limit ? { limit } : {}),
    }),
    getInventoryVerificationSummary(),
  ]);
  return NextResponse.json({ ...page, summary });
}
