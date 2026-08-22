import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections } from "@/lib/db";
import { finishedGoodsWarehouseFor, capacityGbPerUnit, finishedGoodsUnit } from "@/lib/finished-goods";
import { ACTIVE_PRODUCTION_PRODUCTS } from "@/lib/fab-production-config";

export const dynamic = "force-dynamic";

// 완제품(HBM 스택·DRAM 칩·NAND 다이) 재고 현황 — engine.ts가 매 tick 완료된 웨이퍼를 제품별로 적립하는
// finishedGoods 컬렉션을 제품 배열로 노출한다. capacityGbPerUnit으로 프런트에서 Gb 공통 환산이 가능하다.
export async function GET() {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const { finishedGoods, finishedGoodsEvents, warehouses } = await collections();

  // 완제품 창고는 팹별로 분리돼 있다(WH-FG01/02/03) — 제품마다 자기 창고를 조회한다.
  const products = await Promise.all(ACTIVE_PRODUCTION_PRODUCTS.map(async ({ fabId, product }) => {
    const warehouseId = finishedGoodsWarehouseFor(product);
    const [doc, events, warehouse] = await Promise.all([
      finishedGoods.findOne({ _id: `${fabId}__${product}__${warehouseId}` }),
      finishedGoodsEvents.find({ product }).sort({ tickAt: -1 }).limit(6).toArray(),
      warehouses.findOne({ _id: warehouseId }),
    ]);
    return {
      fabId, product, warehouseId,
      warehouseName: warehouse?.name ?? warehouseId,
      quantity: doc?.quantity ?? 0,
      unit: finishedGoodsUnit(product),
      capacityGbPerUnit: capacityGbPerUnit(product),
      pendingTestQuantity: doc?.pendingTestQuantity ?? 0,
      // 운영시각(ms) — 벽시계가 아니다. 화면에서 표기를 구분한다(RULES.md).
      pendingTestReadyOperatingMs: doc?.pendingTestReadyOperatingMs ?? null,
      updatedAt: doc?.updatedAt?.toISOString() ?? null,
      recentEvents: events.map((e) => ({ id: e._id, at: e.tickAt.toISOString(), addedQty: e.addedQty, queuedQty: e.queuedQty })),
    };
  }));

  return NextResponse.json({ products }, { headers: { "Cache-Control": "no-store" } });
}
