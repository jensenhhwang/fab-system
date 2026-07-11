import type { MaterialDoc } from "@/lib/db";

// 팹 가동일 (24/7 → 월 30일 기준). 향후 가동률 계수화 가능.
export const WORKING_DAYS = 30;

// 단위종류별 파렛트 환산계수 (파렛트-포지션 / 1단위)
// 자재 담당자의 표준 환산 방식. Material.palletFactor 로 개별 override.
export const UNIT_PALLET_FACTOR: Record<string, number> = {
  "봄베": 0.5,
  "드럼": 0.4,
  "캔(20L)": 0.06,
  "캔(1L)": 0.015,
  "병(20L)": 0.06,
  "롤": 0.15,
  "장": 0.04,
  "개": 0.08,
  "세트": 0.3,
  "kg": 0.003,
  "wafer-lot": 0.2,
  "톤": 0, // UPW 등 현장생산 — 창고 미점유
};
export const DEFAULT_PALLET_FACTOR = 0.1;

// 자재 1단위가 차지하는 파렛트 환산 (override > 단위표 > 기본)
export function materialFactor(m: Pick<MaterialDoc, "unit" | "palletFactor">): number {
  if (typeof m.palletFactor === "number") return m.palletFactor;
  return UNIT_PALLET_FACTOR[m.unit] ?? DEFAULT_PALLET_FACTOR;
}
