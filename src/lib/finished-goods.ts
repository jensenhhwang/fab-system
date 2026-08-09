import type { Product } from "@/lib/db";
import { getProductionConfig } from "@/lib/fab-production-config";

// 하위호환용 — 옛 코드경로가 참조. 제품별 단위는 finishedGoodsUnit(product)를 쓴다.
export const FINISHED_GOODS_UNIT = "STACK" as const;
export const FINISHED_GOODS_WAREHOUSE_ID = "WH-FG01";

function fabForProduct(product: Product): "M20" | "M21" | "M22" {
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
  now: Date;
  pendingTestQuantity: number;
  pendingTestReadyAt: Date | null;
  newlyCompletedQuantity: number;
  simMsPerDay: number;
}): { releasedQuantity: number; nextPendingTestQuantity: number; nextPendingTestReadyAt: Date | null } {
  let pending = input.pendingTestQuantity;
  let readyAt = input.pendingTestReadyAt;
  let released = 0;

  if (readyAt && input.now.getTime() >= readyAt.getTime() && pending > 0) {
    released = pending;
    pending = 0;
    readyAt = null;
  }

  if (input.newlyCompletedQuantity > 0) {
    if (pending <= 0 || !readyAt) {
      readyAt = new Date(input.now.getTime() + FINAL_TEST_DURATION_DAYS * input.simMsPerDay);
    }
    pending += input.newlyCompletedQuantity;
  }

  return { releasedQuantity: released, nextPendingTestQuantity: pending, nextPendingTestReadyAt: readyAt };
}
