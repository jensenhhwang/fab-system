import type { Product } from "@/lib/db";
import { getProductionConfig } from "@/lib/fab-production-config";
import { operatingDaysToMs } from "@/lib/twin/operating-clock";

// 하위호환용 — 옛 코드경로가 참조. 제품별 단위는 finishedGoodsUnit(product)를 쓴다.
export const FINISHED_GOODS_UNIT = "STACK" as const;
// 하위호환용 — HBM(M20) 전용 창고. 제품별 창고는 finishedGoodsWarehouseFor(product)를 쓴다.
export const FINISHED_GOODS_WAREHOUSE_ID = "WH-FG01";

// 완제품 창고는 팹별로 분리한다. 하나를 3제품이 공유하면 (1) getWarehouseCapacity가 단위가 다른
// STACK/CHIP/DIE를 raw 합산해 점유율이 무의미해지고 (2) 한 제품의 재고 적체가 나머지 두 제품의
// 생산까지 CAPACITY_OVER 게이팅으로 멈춘다 — 실관측: HBM 132일치(25.1M STACK) 적체로 WH-FG01이
// 198%가 되면서 DRAM/NAND WIP까지 마지막 스텝에서 동반 정지했다.
const FINISHED_GOODS_WAREHOUSE_BY_PRODUCT: Record<Product, string> = {
  HBM: FINISHED_GOODS_WAREHOUSE_ID,
  DRAM: "WH-FG02",
  NAND: "WH-FG03",
};

export function finishedGoodsWarehouseFor(product: Product): string {
  return FINISHED_GOODS_WAREHOUSE_BY_PRODUCT[product];
}

export function finishedGoodsWarehouseIds(): string[] {
  return Object.values(FINISHED_GOODS_WAREHOUSE_BY_PRODUCT);
}

export function fabForProduct(product: Product): "M20" | "M21" | "M22" {
  return product === "HBM" ? "M20" : product === "DRAM" ? "M21" : "M22";
}

// 완제품(=완료된 웨이퍼)을 재고로 적립할 때 쓰는 환산. 제품별 config(fab-production-config.ts →
// docs/foup-wip-master.md 연동)의 output model을 그대로 재사용한다:
// good die/wafer × dieToUnit × assembly yield = 웨이퍼 1장이 만드는 완제품 단위 수.
// HBM: dieToUnit=1/12(12-die 스택 팬아웃). DRAM/NAND: dieToUnit=1(1 die=1 완제품 단위).
export function finishedGoodsPerWafer(product: Product = "HBM"): number {
  const cfg = getProductionConfig(fabForProduct(product), product);
  if (!cfg) return 0;
  const om = cfg.outputModel;
  return om.knownGoodDiesPerWafer * om.dieToUnit * om.assemblyYield;
}

export function finishedGoodsUnit(product: Product): "STACK" | "CHIP" | "DIE" {
  return getProductionConfig(fabForProduct(product), product)?.outputModel.unit ?? "STACK";
}

export function capacityGbPerUnit(product: Product): number {
  return getProductionConfig(fabForProduct(product), product)?.outputModel.capacityGbPerUnit ?? 0;
}

// 패키징(WIP 완료)이 끝났다고 바로 판매 가능 재고가 되지 않는다 — 실제로는 최종테스트(Final
// Test)를 통과해야 한다. assemblyYield가 이미 조립 단계 수율을 반영하므로 여기서 새 수율(불량률)
// 을 또 만들지 않고, "테스트에 걸리는 시간" 게이트만 둔다 — 즉시 판매재고로 안 잡히고
// 한 배치(FINAL_TEST_DURATION_DAYS)만큼 대기한 뒤 한꺼번에 풀린다.
export const FINAL_TEST_DURATION_DAYS = 1;

export function applyFinalTestQueue(input: {
  /** 지금 운영시각(ms). 최종테스트 대기는 운영시간으로 흐른다(RULES.md § Twin 운영시간). */
  operatingEpochMs: number;
  pendingTestQuantity: number;
  /** 운영시각 기준 방출 예정 시각. 벽시계가 아니다 — 필드명으로 구분한다. */
  pendingTestReadyOperatingMs: number | null;
  newlyCompletedQuantity: number;
}): { releasedQuantity: number; nextPendingTestQuantity: number; nextPendingTestReadyOperatingMs: number | null } {
  let pending = input.pendingTestQuantity;
  let readyAt = input.pendingTestReadyOperatingMs;
  let released = 0;

  if (readyAt != null && input.operatingEpochMs >= readyAt && pending > 0) {
    released = pending;
    pending = 0;
    readyAt = null;
  }

  if (input.newlyCompletedQuantity > 0) {
    if (pending <= 0 || readyAt == null) {
      readyAt = input.operatingEpochMs + operatingDaysToMs(FINAL_TEST_DURATION_DAYS);
    }
    pending += input.newlyCompletedQuantity;
  }

  return { releasedQuantity: released, nextPendingTestQuantity: pending, nextPendingTestReadyOperatingMs: readyAt };
}
