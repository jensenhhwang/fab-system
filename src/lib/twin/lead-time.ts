// sim-engine과 twin engine이 공유하는 카테고리별 조달 리드타임(일).
export const LEAD_TIME_RANGE: Record<string, [number, number]> = {
  CHM: [7, 14],
  GAS: [3, 7],
  PKG: [5, 10],
};

export function getBaseLeadTime(category: string): number {
  const [lo, hi] = LEAD_TIME_RANGE[category] ?? [7, 7];
  return Math.round((lo + hi) / 2);
}
