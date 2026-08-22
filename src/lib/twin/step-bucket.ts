import type { Product } from "@/lib/db";
import type { FabId } from "@/lib/fab-domain";
import { collections } from "@/lib/db";
import type { StepConsumption } from "@/lib/twin/burn";

// DRAM/NAND WIP를 step별 FOUP-equivalent로 집계 진행하는 엔진.
// counts는 개별 실물 ID가 없는 연속량이므로 소수를 허용한다. 공통 운영 5분 퀀텀마다
// 평균 step dwell의 일부만 이동해 tick당 전체 한 스텝 시프트를 제거한다.

const FLOW_EPSILON = 1e-9;

export type StepFlowResult = {
  nextCounts: number[];
  completedFoup: number;
  completedWaferQty: number;
  advancedFoup: number;
  blockedFoup: number;
  releasedFoup: number;
  processedOperatingDays: number;
  burnByMaterial: Map<string, number>;
};

type StepFlowInput = {
  counts: number[];
  quantumCount: number;
  quantumOperatingDays: number;
  stepDwellDays: number;
  dailyRate: number;
  target: number;
  stepConsumption: StepConsumption;
  blockedMaterialIds: ReadonlySet<string>;
  finishedGoodsCapacityOver: boolean;
  wafersPerFoup: number;
};

function clampFlowValue(value: number): number {
  return Math.abs(value) < FLOW_EPSILON ? 0 : value;
}

function emptyStepFlow(counts: number[]): StepFlowResult {
  return {
    nextCounts: counts.slice(),
    completedFoup: 0,
    completedWaferQty: 0,
    advancedFoup: 0,
    blockedFoup: 0,
    releasedFoup: 0,
    processedOperatingDays: 0,
    burnByMaterial: new Map(),
  };
}

function computeStepFlowQuantum(input: Omit<StepFlowInput, "quantumCount">): StepFlowResult {
  const {
    counts,
    quantumOperatingDays,
    stepDwellDays,
    dailyRate,
    target,
    stepConsumption,
    blockedMaterialIds,
    finishedGoodsCapacityOver,
    wafersPerFoup,
  } = input;
  const result = emptyStepFlow(counts);
  result.processedOperatingDays = quantumOperatingDays;
  if (counts.length === 0 || quantumOperatingDays <= 0) return result;

  const moveFraction = Math.min(1, quantumOperatingDays / stepDwellDays);
  const nextCounts = counts.slice();

  // 모든 이동은 같은 이전 counts를 본다. 한 퀀텀 안에 유입된 물량이 다시 다음 스텝으로
  // 순간 통과하지 않도록 동시 이동으로 계산한다.
  for (let i = 0; i < counts.length; i++) {
    const count = Math.max(0, counts[i] ?? 0);
    if (count <= 0) continue;
    const movable = count * moveFraction;
    const consumers = stepConsumption.get(i);
    const materialBlocked = consumers?.some(({ materialId }) => blockedMaterialIds.has(materialId)) ?? false;
    const isLast = i === counts.length - 1;
    const finishedGoodsBlocked = isLast && finishedGoodsCapacityOver;

    if (materialBlocked || finishedGoodsBlocked) {
      result.blockedFoup += movable;
      continue;
    }

    result.advancedFoup += movable;
    nextCounts[i] -= movable;
    const wafers = movable * wafersPerFoup;
    if (consumers) {
      for (const { materialId, equivalentPerWafer } of consumers) {
        result.burnByMaterial.set(
          materialId,
          (result.burnByMaterial.get(materialId) ?? 0) + wafers * equivalentPerWafer,
        );
      }
    }

    if (isLast) {
      result.completedFoup += movable;
      result.completedWaferQty += wafers;
    } else {
      nextCounts[i + 1] += movable;
    }
  }

  const totalAfterAdvance = nextCounts.reduce((sum, count) => sum + count, 0);
  const room = Math.max(0, target - totalAfterAdvance);
  result.releasedFoup = Math.min(Math.max(0, dailyRate) * quantumOperatingDays, room);
  if (nextCounts.length > 0) nextCounts[0] += result.releasedFoup;
  result.nextCounts = nextCounts.map(clampFlowValue);
  return result;
}

/** 완성된 공통 운영 퀀텀 수만큼 STEP_BUCKET을 부분 이동한다. */
export function computeStepFlow(input: StepFlowInput): StepFlowResult {
  if (!Number.isInteger(input.quantumCount) || input.quantumCount < 0) {
    throw new Error("quantumCount는 0 이상의 정수여야 합니다.");
  }
  if (!Number.isFinite(input.stepDwellDays) || input.stepDwellDays <= 0) {
    throw new Error("stepDwellDays는 0보다 커야 합니다.");
  }
  if (!Number.isFinite(input.quantumOperatingDays) || input.quantumOperatingDays < 0) {
    throw new Error("quantumOperatingDays는 0 이상이어야 합니다.");
  }

  const total = emptyStepFlow(input.counts);
  for (let quantum = 0; quantum < input.quantumCount; quantum++) {
    const step = computeStepFlowQuantum({ ...input, counts: total.nextCounts });
    total.nextCounts = step.nextCounts;
    total.completedFoup += step.completedFoup;
    total.completedWaferQty += step.completedWaferQty;
    total.advancedFoup += step.advancedFoup;
    total.blockedFoup += step.blockedFoup;
    total.releasedFoup += step.releasedFoup;
    total.processedOperatingDays += step.processedOperatingDays;
    for (const [materialId, quantity] of step.burnByMaterial) {
      total.burnByMaterial.set(materialId, (total.burnByMaterial.get(materialId) ?? 0) + quantity);
    }
  }
  return total;
}

// steady-state seed: target FOUP-equivalent를 전체 스텝에 균등 분포한다.
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
  return doc ? doc.counts.reduce((sum, count) => sum + count, 0) : 0;
}

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
  gating: {
    stepConsumption: StepConsumption;
    blockedMaterialIds: ReadonlySet<string>;
    finishedGoodsCapacityOver: boolean;
    wafersPerFoup: number;
  },
  flow: {
    quantumCount: number;
    quantumOperatingDays: number;
    stepDwellDays: number;
    dailyRate: number;
    target: number;
  },
): Promise<StepFlowResult> {
  const { wipStepBuckets } = await collections();
  const doc = await wipStepBuckets.findOne({ _id: bucketId(fabId, product) });
  if (!doc || doc.counts.length === 0) return emptyStepFlow([]);
  if (flow.quantumCount === 0) return emptyStepFlow(doc.counts);

  const result = computeStepFlow({ counts: doc.counts, ...gating, ...flow });
  await wipStepBuckets.updateOne(
    { _id: doc._id },
    { $set: { counts: result.nextCounts, updatedAt: new Date() } },
  );
  return result;
}
