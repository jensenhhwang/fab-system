import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections } from "@/lib/db";
import { finishedGoodsUnit } from "@/lib/finished-goods";

export const dynamic = "force-dynamic";

// 소모-산출 "물질 보존" 영수증 — 완제품 적립 이벤트(finishedGoodsEvents)를 기준으로 같은 tick(±1s)에
// 소모된 자재(twinBurnEvents)를 묶어 "이번 tick: GAS-001 −X … → +Y STACK" 형태로 보여준다. 자재는
// 3팹 공유라 제품 정확 귀속은 어려우므로 tick 시간축 대응으로 표현한다(설계상 소모→수율→산출 대응).
export async function GET() {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const { finishedGoodsEvents, twinBurnEvents, materials } = await collections();
  const fgEvents = await finishedGoodsEvents.find({}).sort({ tickAt: -1 }).limit(12).toArray();
  const matDocs = await materials.find({}, { projection: { code: 1 } }).toArray();
  const codeById = new Map(matDocs.map((m) => [m._id, m.code as string]));

  const receipts = await Promise.all(fgEvents.map(async (fg) => {
    const windowStart = new Date(fg.tickAt.getTime() - 1_000);
    const windowEnd = new Date(fg.tickAt.getTime() + 1_000);
    const burns = await twinBurnEvents
      .find({ tickAt: { $gte: windowStart, $lte: windowEnd }, burnedQty: { $gt: 0 } })
      .sort({ burnedQty: -1 })
      .limit(4)
      .toArray();
    return {
      tickAt: fg.tickAt.toISOString(),
      product: fg.product,
      unit: finishedGoodsUnit(fg.product),
      producedAdded: fg.addedQty,
      producedQueued: fg.queuedQty,
      consumed: burns.map((b) => ({
        materialId: b.materialId,
        code: codeById.get(b.materialId) ?? b.materialId,
        qty: Math.round(b.burnedQty),
        shortfall: Math.round(b.shortfallQty ?? 0),
      })),
    };
  }));

  return NextResponse.json({ receipts }, { headers: { "Cache-Control": "no-store" } });
}
