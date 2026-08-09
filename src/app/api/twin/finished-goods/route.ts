import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections } from "@/lib/db";
import { FINISHED_GOODS_WAREHOUSE_ID, capacityGbPerUnit, finishedGoodsUnit } from "@/lib/finished-goods";
import { ACTIVE_PRODUCTION_PRODUCTS } from "@/lib/fab-production-config";

export const dynamic = "force-dynamic";

// 완제품(HBM 스택·DRAM 칩·NAND 다이) 재고 현황 — engine.ts가 매 tick 완료된 웨이퍼를 제품별로 적립하는
// finishedGoods 컬렉션을 제품 배열로 노출한다. capacityGbPerUnit으로 프런트에서 Gb 공통 환산이 가능하다.
export async function GET() {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const { finishedGoods, finishedGoodsEvents, warehouses } = await collections();
  const warehouse = await warehouses.findOne({ _id: FINISHED_GOODS_WAREHOUSE_ID });

  const products = await Promise.all(ACTIVE_PRODUCTION_PRODUCTS.map(async ({ fabId, product }) => {
    const [doc, events] = await Promise.all([
      finishedGoods.findOne({ _id: `${fabId}__${product}__${FINISHED_GOODS_WAREHOUSE_ID}` }),
      finishedGoodsEvents.find({ product }).sort({ tickAt: -1 }).limit(6).toArray(),
    ]);
    return {
      fabId, product, warehouseId: FINISHED_GOODS_WAREHOUSE_ID,
      warehouseName: warehouse?.name ?? FINISHED_GOODS_WAREHOUSE_ID,
      quantity: doc?.quantity ?? 0,
      unit: finishedGoodsUnit(product),
      capacityGbPerUnit: capacityGbPerUnit(product),
      pendingTestQuantity: doc?.pendingTestQuantity ?? 0,
      pendingTestReadyAt: doc?.pendingTestReadyAt?.toISOString() ?? null,
      updatedAt: doc?.updatedAt?.toISOString() ?? null,
      recentEvents: events.map((e) => ({ id: e._id, at: e.tickAt.toISOString(), addedQty: e.addedQty, queuedQty: e.queuedQty })),
    };
  }));

  return NextResponse.json({ products }, { headers: { "Cache-Control": "no-store" } });
}
