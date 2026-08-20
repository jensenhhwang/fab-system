import type { Product } from "@/lib/db";
import { ACTIVE_PRODUCTION_PRODUCTS, getProductionConfig } from "@/lib/fab-production-config";
import { fabForProduct, finishedGoodsPerWafer, finishedGoodsUnit } from "@/lib/finished-goods";
import { operatingMonthOf, OPERATING_DAYS_PER_MONTH, operatingDaysToMs } from "@/lib/twin/operating-clock";

// 고객 계약을 제품축으로 쪼개는 순수 로직 (DB 접근 없음).
//
// 배경: CustomerDoc.contractedMonthlyQty가 제품 구분 없는 단일 숫자(HBM 설계산출 기준, 단위 STACK)
// 였고, /api/customers는 이번 달 출하를 customerId로만 group·$sum 했다. 그래서 HBM STACK과
// NAND DIE가 같은 분자에 더해진 뒤 HBM 기준 분모로 나뉘어 이행률 820%가 화면에 떠 있었다.
//
// seed(/api/customers의 자동 재시드)와 migrate 스크립트가 각자 TIER_SHARE를 하드코딩해 두면
// 언젠가 갈라지므로, 배분 규칙은 여기서만 정의하고 양쪽이 가져다 쓴다.

export const TIER_SHARE: Record<string, number> = {
  "CUST-A": 0.30, "CUST-B": 0.30, "CUST-C": 0.15, "CUST-D": 0.15, "CUST-E": 0.10,
};

// 실제 반도체 계약 구조: HBM은 LTA(capacity reservation·선급금, 미납 시 페널티)라 이행률이
// 의미 있는 라인이고, 범용 DRAM은 blanket PO + rolling forecast로 커밋 물량이 잡히며,
// 스팟은 애초에 약정 물량이 없다 — 스팟에 이행률을 매기면 820%와 같은 종류의 거짓말이 된다.
export type ContractType = "LTA" | "COMMITTED" | "SPOT";

export function contractTypeFor(priorityTier: 1 | 2 | 3): ContractType {
  if (priorityTier === 1) return "LTA";
  if (priorityTier === 2) return "COMMITTED";
  return "SPOT";
}

// 제품별 월 설계산출 = 팹 config의 월 웨이퍼 투입 × 웨이퍼당 완제품 환산.
// (DRAM/NAND의 waferStartsPerMonth에는 가동률이 이미 반영돼 있다 — fab-production-config.wspmFor)
export function designMonthlyOutput(product: Product): number {
  const cfg = getProductionConfig(fabForProduct(product), product);
  if (!cfg) return 0;
  return cfg.waferStartsPerMonth * finishedGoodsPerWafer(product);
}

export type ContractLine = {
  customerId: string;
  customerName: string;
  priorityTier: 1 | 2 | 3;
  product: Product;
  unit: "STACK" | "CHIP" | "DIE";
  contractedMonthlyQty: number;
  contractType: ContractType;
};

export function buildContractLines(
  customers: { _id: string; name: string; priorityTier: 1 | 2 | 3 }[],
): ContractLine[] {
  const lines: ContractLine[] = [];
  for (const c of customers) {
    const share = TIER_SHARE[c._id] ?? 0;
    for (const { product } of ACTIVE_PRODUCTION_PRODUCTS) {
      const contractType = contractTypeFor(c.priorityTier);
      lines.push({
        customerId: c._id,
        customerName: c.name,
        priorityTier: c.priorityTier,
        product,
        unit: finishedGoodsUnit(product),
        // 스팟은 약정 물량이 없다. 출하는 되지만 "계약 대비 몇 %"가 성립하지 않는다.
        contractedMonthlyQty: contractType === "SPOT" ? 0 : Math.round(designMonthlyOutput(product) * share),
        contractType,
      });
    }
  }
  return lines;
}

// 이행률. 스팟이거나 계약물량이 0이면 퍼센트가 존재하지 않는 개념이므로 null을 돌려주고,
// 화면은 게이지 대신 "배정" 표기로 바꾼다. 100% 초과는 자르지 않는다 — 계약 밖 물량이
// 얼마나 나갔는지가 그대로 보여야 한다.
export function fulfillmentPctOf(
  line: { contractType: ContractType; contractedMonthlyQty: number },
  shippedThisMonth: number,
): number | null {
  if (line.contractType === "SPOT") return null;
  if (line.contractedMonthlyQty <= 0) return null;
  return Math.round((shippedThisMonth / line.contractedMonthlyQty) * 100);
}

/**
 * 지금 운영시각이 속한 **운영월**의 [시작, 끝) 범위(운영 ms).
 *
 * 계약 `contractedMonthlyQty`는 운영 1개월치이고 자동출하도 운영일 기준으로 나간다. 집계 창을
 * 벽시계 달력 월로 잡으면 24배속에서 분자에 운영 24개월치가 쌓여 이행률이 그만큼 부풀려진다
 * (실측 2026-08-18: DRAM 6.5배 · NAND 6.4배 · HBM 3.8배).
 */
export function operatingMonthRange(operatingEpochMs: number): { startMs: number; endMs: number } {
  const month = operatingMonthOf(operatingEpochMs);
  const startMs = operatingDaysToMs(month * OPERATING_DAYS_PER_MONTH);
  return { startMs, endMs: startMs + operatingDaysToMs(OPERATING_DAYS_PER_MONTH) };
}
