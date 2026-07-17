import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireRole(WRITE_ROLES.transferTransition);
  if (access.error) return access.error;
  const { id } = await params;
  const body = await req.json() as {
    x?: number;
    y?: number;
    z?: number;
    progress?: number;
    telemetryAt?: string;
    version?: number;
  };
  if (![body.x, body.y, body.z].every((value) => typeof value === "number" && Number.isFinite(value))) {
    return NextResponse.json({ error: "유효한 x, y, z 좌표가 필요합니다." }, { status: 400 });
  }
  if (body.progress !== undefined && (!Number.isFinite(body.progress) || body.progress < 0 || body.progress > 1)) {
    return NextResponse.json({ error: "progress는 0~1 범위여야 합니다." }, { status: 400 });
  }
  const telemetryAt = body.telemetryAt ? new Date(body.telemetryAt) : new Date();
  if (Number.isNaN(telemetryAt.getTime())) {
    return NextResponse.json({ error: "telemetryAt 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const now = new Date();
  if (telemetryAt.getTime() > now.getTime() + 5_000) {
    return NextResponse.json({ error: "현재보다 5초 이상 미래인 telemetryAt은 허용되지 않습니다." }, { status: 400 });
  }

  const { transferOrders } = await collections();
  const transfer = await transferOrders.findOne({ _id: id });
  if (!transfer) return NextResponse.json({ error: "TransferOrder 없음" }, { status: 404 });
  if (transfer.status !== "IN_TRANSIT") {
    return NextResponse.json({ error: `IN_TRANSIT 상태에서만 위치를 갱신할 수 있습니다. 현재: ${transfer.status}` }, { status: 409 });
  }
  if (body.version !== undefined && body.version !== (transfer.version ?? 0)) {
    return NextResponse.json({ error: "TransferOrder 버전이 변경되었습니다." }, { status: 409 });
  }
  if (transfer.telemetryAt && telemetryAt <= transfer.telemetryAt) {
    return NextResponse.json({ error: "기존 위치보다 오래된 telemetry는 반영할 수 없습니다." }, { status: 409 });
  }

  const nextVersion = (transfer.version ?? 0) + 1;
  const result = await transferOrders.updateOne(
    { _id: id, status: "IN_TRANSIT", version: transfer.version ?? { $exists: false } },
    {
      $set: {
        lastPosition: { x: body.x!, y: body.y!, z: body.z!, ...(body.progress === undefined ? {} : { progress: body.progress }) },
        telemetryAt,
        updatedAt: now,
        version: nextVersion,
      },
    },
  );
  if (!result.modifiedCount) {
    return NextResponse.json({ error: "TransferOrder가 이미 변경되었습니다." }, { status: 409 });
  }
  return NextResponse.json({ ok: true, version: nextVersion, telemetryAt: telemetryAt.toISOString() });
}
