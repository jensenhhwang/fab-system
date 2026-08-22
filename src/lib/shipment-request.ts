import type { Product } from "@/lib/db";
import type { FabId } from "@/lib/fab-domain";
import { fabForProduct, finishedGoodsUnit, finishedGoodsWarehouseFor } from "@/lib/finished-goods";

// 출하 요청 해석 — DB 접근 없는 순수 로직.
//
// 예전 POST /api/twin/shipments는 fabId "M20" / product "HBM" / unit "STACK" / 창고를 전부
// 하드코딩해서 DRAM/NAND는 출하 자체가 불가능했다. 완제품이 나갈 문이 한 제품에만 있으니
// DRAM/NAND는 만들수록 자기 창고를 CAPACITY_OVER로 채워 마지막 스텝을 스스로 막았다
// (실관측: 재가동 15분 만에 DRAM 128%, NAND 142% 도달하며 3제품 전부 차단).

const SHIPPABLE_PRODUCTS: Product[] = ["HBM", "DRAM", "NAND"];

export type ShipmentRequest = {
  customerId: string;
  quantity: number;
  product: Product;
  fabId: FabId;
  warehouseId: string;
  unit: "STACK" | "CHIP" | "DIE";
  finishedGoodsId: string;
};

export function parseShipmentRequest(body: {
  customerId?: unknown;
  quantity?: unknown;
  product?: unknown;
}): ShipmentRequest | { error: string } {
  const { customerId, quantity, product } = body;

  if (typeof customerId !== "string" || customerId.length === 0) {
    return { error: "customerId가 필요합니다." };
  }
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
    return { error: "quantity(양수)가 필요합니다." };
  }
  // 제품 미지정은 HBM으로 본다 — 3제품 출하가 열리기 전 호출자와의 하위호환.
  const resolved: Product = product == null ? "HBM" : (product as Product);
  if (!SHIPPABLE_PRODUCTS.includes(resolved)) {
    return { error: `출하할 수 없는 제품입니다: ${String(product)}` };
  }

  const fabId = fabForProduct(resolved);
  const warehouseId = finishedGoodsWarehouseFor(resolved);

  return {
    customerId,
    quantity,
    product: resolved,
    fabId,
    warehouseId,
    unit: finishedGoodsUnit(resolved),
    finishedGoodsId: `${fabId}__${resolved}__${warehouseId}`,
  };
}
