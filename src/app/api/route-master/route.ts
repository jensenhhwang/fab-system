import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { getRouteMaster, expandRouteMaster } from "@/lib/route-master";
import { FAB_IDS, type FabId } from "@/lib/fab-domain";
import type { Product } from "@/lib/db";

const PRODUCTS: readonly Product[] = ["HBM", "DRAM", "NAND"];

// route master를 선형 visit 시퀀스로 펼쳐서 반환한다 — 향후 공정 인접 빈도 기반
// 3D 배치(route-adjacency.ts)의 데이터 소스가 될 API. 오늘은 배치 알고리즘에 연결하지 않고
// 조회 전용으로만 둔다.
export async function GET(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const { searchParams } = req.nextUrl;
  const fabId = searchParams.get("fabId");
  const product = searchParams.get("product");
  if (!fabId || !FAB_IDS.includes(fabId as FabId)) {
    return NextResponse.json({ error: "fabId가 유효하지 않습니다." }, { status: 400 });
  }
  if (!product || !PRODUCTS.includes(product as Product)) {
    return NextResponse.json({ error: "product가 유효하지 않습니다." }, { status: 400 });
  }

  const doc = await getRouteMaster(fabId as FabId, product as Product);
  if (!doc) {
    return NextResponse.json({ error: "route master를 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({
    fabId: doc.fabId,
    product: doc.product,
    version: doc.version,
    visits: expandRouteMaster(doc),
  });
}
