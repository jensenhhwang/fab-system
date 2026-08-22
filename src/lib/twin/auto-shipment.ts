import type { Product } from "@/lib/db";
import type { ContractType } from "@/lib/customer-contracts";

// tick 자동출하 배분 — DB 접근 없는 순수 로직.
//
// 배경: 출하가 tick이 아니라 사람이 폼을 누르거나 정리 스크립트를 돌릴 때만 생겼다. 그래서
// 완제품이 쌓이기만 하다가 창고가 CAPACITY_OVER가 되면 마지막 공정 스텝이 막혀 라인이 섰고,
// 사람이 창고를 비워야만 다시 돌았다(실관측: 70%까지 비운 NAND 창고가 2시간 만에 192% 재포화).
// 계약 라인 rate만큼 tick이 스스로 내보내면 그 순환이 끊긴다.
//
// 폭주 방지: 이 배분은 (1) 재고를 줄이는 방향이고 (2) 상한이 계약량이며 (3) 가용재고를 절대
// 넘지 않는다. 세 조건 때문에 구조적으로 폭주가 불가능해서 별도 쿨다운·예산을 두지 않는다.

// 계약 월량을 일량으로 환산할 때 쓰는 기준월(엔진의 설계수요 산식과 동일하게 30일).
const DAYS_PER_MONTH = 30;

export type AutoShipmentLine = {
  customerId: string;
  product: Product;
  contractType: ContractType;
  priorityTier: 1 | 2 | 3;
  contractedMonthlyQty: number;
};

export type AutoShipmentAllocation = {
  customerId: string;
  product: Product;
  qty: number;
};

export function planAutoShipments(input: {
  lines: AutoShipmentLine[];
  availableQty: number;
  simDays: number;
}): { allocations: AutoShipmentAllocation[]; total: number } {
  const { lines, availableQty, simDays } = input;
  if (availableQty <= 0 || simDays <= 0) return { allocations: [], total: 0 };

  // 스팟은 약정 물량이 없다 — 자동으로 밀어내면 그건 출하가 아니라 재고 떠넘기기다.
  // 사람이 /finished-goods 폼에서 직접 스팟 출하하는 경로는 그대로 열려 있다.
  const eligible = lines
    .filter((l) => l.contractType !== "SPOT" && l.contractedMonthlyQty > 0)
    // 재고가 모자라면 계약 등급이 높은 라인부터 채운다(LTA는 미납 시 페널티가 있는 계약).
    .sort((a, b) => a.priorityTier - b.priorityTier);

  const allocations: AutoShipmentAllocation[] = [];
  let remaining = Math.floor(availableQty);

  for (const line of eligible) {
    if (remaining <= 0) break;
    const due = Math.floor((line.contractedMonthlyQty / DAYS_PER_MONTH) * simDays);
    const qty = Math.min(due, remaining);
    if (qty <= 0) continue;
    allocations.push({ customerId: line.customerId, product: line.product, qty });
    remaining -= qty;
  }

  return { allocations, total: allocations.reduce((s, a) => s + a.qty, 0) };
}
