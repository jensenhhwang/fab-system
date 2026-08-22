import type { Product } from "@/lib/db";
import type { FabId } from "@/lib/fab-domain";
import { collections } from "@/lib/db";
import type { StepConsumption } from "@/lib/twin/burn";
import { computeAggregateReleasePlan } from "@/lib/lot-route";

// DRAM/NAND WIP를 step별 FOUP-equivalent count로 집계 진행하는 엔진(docs/foup-wip-master.md §22).
// per-lot(waferLots)과 결과는 같되(같은 route·원단위·완제품 환산), 매 틱 write가 O(스텝수)로 줄어
// 대규모 WIP(17K/18K FOUP)를 빠르게 돌린다. 순수 계산부(computeStepAdvance/Release)는 DB 없이 테스트한다.

export type StepAdvanceResult = {
  nextCounts: number[];
  completedFoup: number;
  completedWaferQty: number;
  advancedFoup: number;
  blockedFoup: number;
  burnByMaterial: Map<string, number>;
};

// counts를 한 스텝씩 시프트한다. 스텝 i를 "떠나는"(i→i+1) 것이 스텝 i의 자재를 소모한다
// (per-lot의 advancedFromStepIndex=fromStep과 동일). 다음 스텝 자재가 CRITICAL이면 그 스텝 count는
// 진행하지 못하고 제자리에 남는다(자재 서킷브레이커). 마지막 스텝은 완제품 창고 CAPACITY_OVER면 막힌다.
export function computeStepAdvance(input: {
  counts: number[];
  stepConsumption: StepConsumption;
  blockedMaterialIds: ReadonlySet<string>;
  finishedGoodsCapacityOver: boolean;
  wafersPerFoup: number;
}): StepAdvanceResult {
  const { counts, stepConsumption, blockedMaterialIds, finishedGoodsCapacityOver, wafersPerFoup } = input;
  const n = counts.length;
  const nextCounts = new Array<number>(n).fill(0);
  const burnByMaterial = new Map<string, number>();
  let completedFoup = 0;
  let completedWaferQty = 0;
  let advancedFoup = 0;
  let blockedFoup = 0;

  for (let i = 0; i < n; i++) {
    const c = counts[i];
    if (!c) continue;
    const consumers = stepConsumption.get(i);
    const materialBlocked = consumers ? consumers.some((x) => blockedMaterialIds.has(x.materialId)) : false;
    const isLast = i === n - 1;
    const fgBlocked = isLast && finishedGoodsCapacityOver;
    if (materialBlocked || fgBlocked) {
      nextCounts[i] += c; // 제자리 유지(차단)
      blockedFoup += c;
      continue;
    }
    // 진행: 스텝 i 자재 소모
    advancedFoup += c;
    const wafers = c * wafersPerFoup;
    if (consumers) {
      for (const { materialId, equivalentPerWafer } of consumers) {
        burnByMaterial.set(materialId, (burnByMaterial.get(materialId) ?? 0) + wafers * equivalentPerWafer);
      }
    }
    if (isLast) {
      completedFoup += c;
      completedWaferQty += wafers;
    } else {
      nextCounts[i + 1] += c;
    }
  }
  return { nextCounts, completedFoup, completedWaferQty, advancedFoup, blockedFoup, burnByMaterial };
}

export function computeStepRelease(input: {
  counts: number[];
  dailyRate: number;
  simDays: number;
  carry: number;
  target: number;
}): { nextCounts: number[]; released: number; nextCarry: number } {
  const totalWip = input.counts.reduce((s, c) => s + c, 0);
  const { releaseCount, nextCarry } = computeAggregateReleasePlan({
    dailyRate: input.dailyRate, simDays: input.simDays, carry: input.carry,
    currentOccupied: totalWip, targetOccupied: input.target,
  });
  const nextCounts = input.counts.slice();
  if (releaseCount > 0) nextCounts[0] = (nextCounts[0] ?? 0) + releaseCount;
  return { nextCounts, released: releaseCount, nextCarry };
}

// steady-state 시드: target FOUP-equivalent를 전체 스텝에 균등 분포. 각 스텝 대략 target/N개가 있어
// 매 틱 마지막 스텝 ~target/N개가 완제품이 된다(문서 처리량과 정합).
export function buildSeedCounts(totalSteps: number, target: number): number[] {
  const counts = new Array<number>(totalSteps).fill(0);
  if (totalSteps <= 0) return counts;
  const base = Math.floor(target / totalSteps);
  let remainder = target - base * totalSteps;
  for (let i = 0; i < totalSteps; i++) {
    counts[i] = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
  }
  return counts;
}

function bucketId(fabId: FabId, product: Product): string {
  return `${fabId}__${product}`;
}

export async function getStepBucketWipTotal(fabId: FabId, product: Product): Promise<number> {
  const { wipStepBuckets } = await collections();
  const doc = await wipStepBuckets.findOne({ _id: bucketId(fabId, product) });
  return doc ? doc.counts.reduce((s, c) => s + c, 0) : 0;
}

// 스텝별 WIP 원본(counts)과 최종 갱신 시각. 화면(노드 밀도·bay 부하)이 twin이 실제로 진행시키는
// 이 원장을 그대로 읽게 하기 위한 read 경로다.
//
// 2026-08-12까지 node-density API는 M21/M22에서 별도 원장(productionWipBuckets, 자체 스케줄러가
// 굴리던 것)을 읽고 있었다. 그쪽은 자재 소모·완제품 적립·출하와 연결돼 있지 않은데도 화면에는
// 그 숫자가 떴다 — 실측 당시 M21 19,626 vs twin 17,173, M22 21,600 vs twin 18,720으로 값이
// 달랐다. twin이 3제품 루프로 일반화(2026-08-09)되면서 역할이 중복됐는데 제거가 안 된 잔재였다.
export async function getStepBucketCounts(
  fabId: FabId,
  product: Product,
): Promise<{ counts: number[]; updatedAt: Date | null } | null> {
  const { wipStepBuckets } = await collections();
  const doc = await wipStepBuckets.findOne({ _id: bucketId(fabId, product) });
  if (!doc) return null;
  return { counts: doc.counts, updatedAt: doc.updatedAt ?? null };
}

export async function advanceStepBucketWip(
  fabId: FabId,
  product: Product,
  gating: { stepConsumption: StepConsumption; blockedMaterialIds: ReadonlySet<string>; finishedGoodsCapacityOver: boolean; wafersPerFoup: number },
): Promise<StepAdvanceResult> {
  const { wipStepBuckets } = await collections();
  const doc = await wipStepBuckets.findOne({ _id: bucketId(fabId, product) });
  const empty: StepAdvanceResult = { nextCounts: [], completedFoup: 0, completedWaferQty: 0, advancedFoup: 0, blockedFoup: 0, burnByMaterial: new Map() };
  if (!doc || doc.counts.length === 0) return empty;
  const result = computeStepAdvance({ counts: doc.counts, ...gating });
  await wipStepBuckets.updateOne({ _id: doc._id }, { $set: { counts: result.nextCounts, updatedAt: new Date() } });
  return result;
}

export async function releaseStepBucketWip(
  fabId: FabId,
  product: Product,
  simDays: number,
  carry: number,
  dailyRate: number,
  target: number,
): Promise<{ released: number; nextCarry: number }> {
  const { wipStepBuckets } = await collections();
  const doc = await wipStepBuckets.findOne({ _id: bucketId(fabId, product) });
  if (!doc || doc.counts.length === 0) return { released: 0, nextCarry: carry };
  const { nextCounts, released, nextCarry } = computeStepRelease({ counts: doc.counts, dailyRate, simDays, carry, target });
  if (released > 0) await wipStepBuckets.updateOne({ _id: doc._id }, { $set: { counts: nextCounts, updatedAt: new Date() } });
  return { released, nextCarry };
}
