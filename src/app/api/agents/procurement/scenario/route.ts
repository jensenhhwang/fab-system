import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections } from "@/lib/db";

export const dynamic = "force-dynamic";

const PRODUCTS = new Set(["HBM", "DRAM", "NAND"]);
const FABS = new Set(["M20", "M21", "M22"]);

type RawEvent = { id?: unknown; product?: unknown; startDay?: unknown; changePct?: unknown; durationDays?: unknown };

function parseEvents(raw: unknown): { id: string; product: "HBM" | "DRAM" | "NAND"; startDay: number; changePct: number; durationDays: number }[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const events = [];
  for (const item of raw as RawEvent[]) {
    if (
      typeof item.id !== "string"
      || typeof item.product !== "string" || !PRODUCTS.has(item.product)
      || typeof item.startDay !== "number"
      || typeof item.changePct !== "number"
      || typeof item.durationDays !== "number" || item.durationDays <= 0
    ) return null;
    events.push({ id: item.id, product: item.product as "HBM" | "DRAM" | "NAND", startDay: item.startDay, changePct: item.changePct, durationDays: item.durationDays });
  }
  return events;
}

// /simulation의 What-if 시나리오를 입고 관제(그림자 조종석)의 판단 입력으로 반영한다(MVP-1).
export async function POST(request: Request) {
  const access = await requireRole(WRITE_ROLES.procurementScenario);
  if (access.error) return access.error;

  const body = await request.json().catch(() => null) as {
    label?: unknown; events?: unknown; horizonDays?: unknown; coverageDays?: unknown; fabId?: unknown;
  } | null;

  const events = parseEvents(body?.events);
  const horizonDays = typeof body?.horizonDays === "number" && body.horizonDays > 0 ? Math.round(body.horizonDays) : null;
  const coverageDays = typeof body?.coverageDays === "number" && body.coverageDays > 0 ? Math.round(body.coverageDays) : null;
  const fabId = body?.fabId === null || body?.fabId === undefined ? null
    : typeof body.fabId === "string" && FABS.has(body.fabId) ? body.fabId as "M20" | "M21" | "M22"
    : undefined;
  const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim().slice(0, 200) : null;

  if (!events || !horizonDays || !coverageDays || fabId === undefined || !label) {
    return NextResponse.json({ error: "label·events(1건 이상)·horizonDays·coverageDays가 필요합니다." }, { status: 400 });
  }

  const { procurementActiveScenario } = await collections();
  const now = new Date();
  await procurementActiveScenario.updateOne(
    { _id: "singleton" },
    { $set: { label, events, horizonDays, coverageDays, fabId, submittedBy: access.user.id, submittedAt: now } },
    { upsert: true },
  );
  return NextResponse.json({ ok: true, label, submittedAt: now.toISOString() });
}

// 활성 시나리오를 지우고 "현재 재고 기준 위험 점검" 기본값으로 되돌린다.
export async function DELETE() {
  const access = await requireRole(WRITE_ROLES.procurementScenario);
  if (access.error) return access.error;

  const { procurementActiveScenario } = await collections();
  await procurementActiveScenario.deleteOne({ _id: "singleton" });
  return NextResponse.json({ ok: true });
}
