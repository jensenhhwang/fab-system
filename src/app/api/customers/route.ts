import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections } from "@/lib/db";
import type { CustomerDoc, Product } from "@/lib/db";
import { finishedGoodsUnit } from "@/lib/finished-goods";
import { ACTIVE_PRODUCTION_PRODUCTS } from "@/lib/fab-production-config";
import { buildContractLines, designMonthlyOutput, fulfillmentPctOf, operatingMonthRange, TIER_SHARE } from "@/lib/customer-contracts";
import { getOrInitTwinState } from "@/lib/twin/state";

export const dynamic = "force-dynamic";

// 가상 고객사 시드 — 실제 영업/계약 데이터가 없어(패브 검증 결과) 명시적으로 가상임을
// 라벨링한 참고 데이터다. 실제 반도체 고객사명을 흉내내지 않고 일반 명칭을 쓴다.
// contractedMonthlyQty(문서에 저장되는 단일 값)는 하위호환용 HBM 기준 총량으로 남긴다 —
// 제품별 계약은 buildContractLines가 응답 시점에 만들어 lines[]로 내보낸다.
// 티어 배분 비율은 customer-contracts.ts가 단일 출처다 — 시드/마이그레이션/출하 스크립트가
// 각자 하드코딩해두면 계약 비율과 출하 비율이 서로 다른 소스를 보게 된다.
function buildVirtualCustomers(): CustomerDoc[] {
  const monthlyOutput = designMonthlyOutput("HBM");
  const base: { _id: string; name: string; priorityTier: 1 | 2 | 3 }[] = [
    { _id: "CUST-A", name: "고객사 A (전략 파트너)", priorityTier: 1 },
    { _id: "CUST-B", name: "고객사 B (전략 파트너)", priorityTier: 1 },
    { _id: "CUST-C", name: "고객사 C (일반 계약)", priorityTier: 2 },
    { _id: "CUST-D", name: "고객사 D (일반 계약)", priorityTier: 2 },
    { _id: "CUST-E", name: "고객사 E (스팟)", priorityTier: 3 },
  ];
  return base.map((c) => ({ ...c, contractedMonthlyQty: Math.round(monthlyOutput * TIER_SHARE[c._id]), virtual: true as const }));
}

export async function GET() {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const { customers, shipments } = await collections();
  const count = await customers.countDocuments();
  if (count === 0) {
    await customers.insertMany(buildVirtualCustomers(), { ordered: false }).catch(() => {});
  }
  const list = await customers.find({}).sort({ priorityTier: 1, name: 1 }).toArray();

  // 집계 창은 **운영월**이다 — 계약 월량이 운영 1개월치이고 자동출하도 운영일 기준으로 나가기
  // 때문이다. 벽시계 달력 월로 잡으면 24배속에서 운영 24개월치가 한 창에 쌓인다
  // (실측 2026-08-18: DRAM 6.5배 · NAND 6.4배 · HBM 3.8배 과대).
  const twinState = await getOrInitTwinState();
  const { startMs, endMs } = operatingMonthRange(twinState.operatingEpochMs ?? 0);
  // 제품별로 group해야 한다. customerId로만 묶으면 단위가 다른 STACK/CHIP/DIE가 한 숫자로
  // 더해지고, 그걸 HBM 기준 분모로 나눠 이행률 820% 같은 값이 나온다.
  const shippedAgg = await shipments.aggregate<{ _id: { customerId: string; product: Product }; total: number; count: number }>([
    // 운영시각이 없는 과거 출하는 제외한다 — 벽시계로 폴백하면 같은 오류가 섞인다.
    { $match: { shippedOperatingMs: { $gte: startMs, $lt: endMs } } },
    { $group: { _id: { customerId: "$customerId", product: "$product" }, total: { $sum: "$quantity" }, count: { $sum: 1 } } },
  ]).toArray();
  const shippedByLine = new Map(shippedAgg.map((s) => [`${s._id.customerId}__${s._id.product}`, s]));

  const lines = buildContractLines(list).map((line) => {
    const hit = shippedByLine.get(`${line.customerId}__${line.product}`);
    const shippedThisMonth = hit?.total ?? 0;
    return {
      ...line,
      shippedThisMonth,
      shipmentCount: hit?.count ?? 0,
      fulfillmentPct: fulfillmentPctOf(line, shippedThisMonth),
      shortfall: Math.max(0, line.contractedMonthlyQty - shippedThisMonth),
    };
  });

  // 제품별 집계 — 스팟 라인은 계약 개념이 없으므로 분자·분모 양쪽에서 제외한다.
  const totals = ACTIVE_PRODUCTION_PRODUCTS.map(({ product }) => {
    const of = lines.filter((l) => l.product === product);
    const committed = of.filter((l) => l.contractType !== "SPOT");
    const contracted = committed.reduce((s, l) => s + l.contractedMonthlyQty, 0);
    const shipped = committed.reduce((s, l) => s + l.shippedThisMonth, 0);
    return {
      product,
      unit: finishedGoodsUnit(product),
      designMonthlyQty: Math.round(designMonthlyOutput(product)),
      contracted,
      shipped,
      spotShipped: of.filter((l) => l.contractType === "SPOT").reduce((s, l) => s + l.shippedThisMonth, 0),
      contractLineCount: committed.length,
      spotLineCount: of.length - committed.length,
      pct: contracted > 0 ? Math.round((shipped / contracted) * 100) : null,
    };
  });

  return NextResponse.json({
    // 하위호환 — 기존 호출자가 고객 목록만 쓰는 경우를 위해 남긴다(제품별 값은 lines에 있다).
    customers: list,
    lines,
    totals,
  }, { headers: { "Cache-Control": "no-store" } });
}
