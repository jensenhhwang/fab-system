import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { createInventoryScaleUpDrafts, getInventoryScaleUpOverview } from "@/lib/inventory-scaleup-service";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getInventoryScaleUpOverview());
}

export async function POST(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.inboundPlan);
  if (access.error) return access.error;
  const body = await req.json() as { requestId?: string };
  const requestId = String(body.requestId ?? "").trim();
  if (!requestId) return NextResponse.json({ error: "중복 방지 요청 ID가 필요합니다." }, { status: 400 });
  const result = await createInventoryScaleUpDrafts({ userId: access.user.id, requestId });
  return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
}
