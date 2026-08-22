import type { MaterialDoc } from "@/lib/db";

// 팹 가동일 (24/7 → 월 30일 기준). 향후 가동률 계수화 가능.
export const WORKING_DAYS = 30;

// 설계기준 수요 대비 허용하는 실측 소모(avgDailyBurn EMA)의 상한 배수.
//
// 이 상수 하나가 두 곳을 동시에 지배한다 — engine의 EMA 클리핑 상한과, 창고 정원 산정
// (resize-warehouse-capacity-to-demand)의 여유 배수. 두 값이 갈라지면 "정원은 설계 기준으로
// 지었는데 발주는 EMA 기준으로 나가는" 모순이 생겨서, 정책이 정상 작동하는 것만으로 창고가
// 넘치고 → 박물류가 입고를 멈추고 → 자재가 결품나는 교착이 된다(실관측 2026-08-11: EMA 상한이
// 3배였을 때 최대 적재량이 정원의 106~261%. docs/fab-operating-baseline.md R2).
//
// 값 1.5의 근거: 가장 공격적인 증산 시나리오(EXPANSION, nominalWspm 143,000)도 기준선
// (NORMAL 117,000) 대비 1.22배라 1.5 안에 들어온다. 그보다 큰 관측치는 진짜 수요 증가가 아니라
// 라인 정지 후 밀린 로트가 한꺼번에 완료되는 catch-up burst다.
export const BURN_EMA_CEILING_MULTIPLIER = 1.5;

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
export function materialFactor(m: Pick<MaterialDoc, "unit" | "palletFactor" | "inventoryToStorageFactor">): number {
  if (typeof m.inventoryToStorageFactor === "number") return m.inventoryToStorageFactor;
  if (typeof m.palletFactor === "number") return m.palletFactor;
  return UNIT_PALLET_FACTOR[m.unit] ?? DEFAULT_PALLET_FACTOR;
}

// 창고 유형별 점유 환산계수. getWarehouseCapacity(런타임 점유율)와 창고 정원 산정
// (resize-warehouse-capacity-to-demand)이 서로 다른 환산을 쓰면 "정원은 A 기준으로 지었는데
// 점유율은 B 기준으로 잰다"가 돼서 정원을 맞춰도 100%를 넘는다 — 두 곳이 같은 함수를 쓴다.
//  · MRO는 개체관리(Probe Card·PVD Target 등)라 수량이 곧 슬롯 수다(환산 없음).
//  · HAZMAT·PRECURSOR는 실린더/캐니스터 슬롯이라 inventoryToStorageFactor만 쓰고,
//    없으면 1(1용기=1슬롯)로 본다 — 파렛트 환산표로 넘어가면 안 된다.
//  · 나머지 SPACE 창고는 파렛트 환산(materialFactor).
export function warehouseOccupancyFactor(
  warehouseType: string,
  m: Pick<MaterialDoc, "unit" | "palletFactor" | "inventoryToStorageFactor">,
): number {
  if (warehouseType === "MRO") return 1;
  if (warehouseType === "HAZMAT" || warehouseType === "PRECURSOR") {
    return typeof m.inventoryToStorageFactor === "number" ? m.inventoryToStorageFactor : 1;
  }
  return materialFactor(m);
}
