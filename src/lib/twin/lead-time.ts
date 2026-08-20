import type { MaterialSupplierDoc, SupplierDoc } from "@/lib/db";
import { buildProcurementSummary } from "@/lib/procurement";

// sim-engine과 twin engine이 공유하는 카테고리별 조달 리드타임(일).
// 이 표는 조달 마스터가 아직 없는 자재의 폴백일 뿐이다 — 진실원은 resolveLeadTimeDays다.
export const LEAD_TIME_RANGE: Record<string, [number, number]> = {
  CHM: [7, 14],
  GAS: [3, 7],
  PKG: [5, 10],
};

export function getBaseLeadTime(category: string): number {
  const [lo, hi] = LEAD_TIME_RANGE[category] ?? [7, 7];
  return Math.round((lo + hi) / 2);
}

/**
 * 트윈 발주에 쓸 리드타임. 승인 주공급사 마스터가 진실원이고, 없을 때만 카테고리 평균으로 폴백한다.
 *
 * 왜 필요했나 — 트윈은 `getBaseLeadTime(category)`로 발주하고 ERP 재고정책
 * (calibrate-inventory-policy → buildProcurementSummary)은 승인 주공급사 마스터를 썼다. 같은
 * 자재의 리드타임이 두 값으로 갈라져서, 어느 쪽도 맞지 않는 발주가 나갔다(실관측 2026-08-18):
 *   · GAS-006 NF₃  — 마스터 21일인데 트윈은 GAS 평균 5일로 발주 → 도착 전에 16일치 결품
 *   · CSM-016 Edge Trim Blade — 마스터 45일인데 트윈은 기본 7일
 *   · CHM-003 황산 — 마스터 7일(=ropDays)인데 트윈이 CHM 평균 11일로 발주 → ropDays를 4일 초과
 * 공급사 선정 규칙(승인 + 주공급사 우선)을 buildProcurementSummary에 위임해서, ERP 정책과
 * 트윈이 문자 그대로 같은 함수로 같은 공급사·같은 리드타임을 고르게 한다.
 */
export function resolveLeadTimeDays(
  links: MaterialSupplierDoc[],
  suppliers: SupplierDoc[],
  category: string,
  now = new Date(),
): number {
  const summary = buildProcurementSummary(links, suppliers, now);
  const days = summary?.normalDays ?? null;
  return days != null && days > 0 ? days : getBaseLeadTime(category);
}
