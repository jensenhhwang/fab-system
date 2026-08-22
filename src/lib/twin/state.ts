import { collections } from "@/lib/db";
import type { TwinEngineStateDoc } from "@/lib/db";

const DEFAULT_TICK_INTERVAL_MS = 5_000;

export async function getOrInitTwinState(): Promise<TwinEngineStateDoc> {
  const { twinEngineState } = await collections();
  const existing = await twinEngineState.findOne({ _id: "singleton" });
  if (existing) return existing;
  const initial: TwinEngineStateDoc = {
    _id: "singleton",
    status: "PAUSED",
    lastTickAt: new Date(),
    tickIntervalMs: DEFAULT_TICK_INTERVAL_MS,
    lockedBy: null,
    lockExpiresAt: null,
    // 공통 운영시계 시작점. 0에서 출발하고 실제 경과 × 24로만 흐른다(§operating-clock.ts).
    operatingEpochMs: 0,
    operatingClockWallAt: new Date(),
    wipFlowCarryMs: 0,
  };
  await twinEngineState.insertOne(initial);
  return initial;
}

// 원자적 락: 미점유거나 만료된 경우에만 owner로 갱신.
export async function acquireTwinLock(owner: string, ttlMs: number): Promise<boolean> {
  const { twinEngineState } = await collections();
  const now = new Date();
  const res = await twinEngineState.updateOne(
    { _id: "singleton", $or: [{ lockedBy: null }, { lockExpiresAt: { $lte: now } }] },
    { $set: { lockedBy: owner, lockExpiresAt: new Date(now.getTime() + ttlMs) } },
  );
  return res.modifiedCount === 1;
}

export async function releaseTwinLock(owner: string): Promise<void> {
  const { twinEngineState } = await collections();
  await twinEngineState.updateOne(
    { _id: "singleton", lockedBy: owner },
    { $set: { lockedBy: null, lockExpiresAt: null } },
  );
}

export async function ensureTwinIndexes(): Promise<void> {
  const { twinPurchaseOrders, twinBurnEvents, waferLots } = await collections();
  await twinPurchaseOrders.createIndex({ status: 1, etaAt: 1 });
  await twinBurnEvents.createIndex({ materialId: 1, tickAt: -1 });
  await waferLots.createIndex({
    fabId: 1,
    product: 1,
    cohort: 1,
    status: 1,
    nextStepOperatingMs: 1,
  });
}
