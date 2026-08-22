# WIP Common Operating Clock Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M20·M21·M22 WIP 진행을 tick 횟수와 벽시계 5초 판정에서 분리하고, 실제 경과시간 × 24인 공통 Twin 운영시계에 맞춘다.

**Architecture:** 공통 수치적분 도우미가 운영 5분 퀀텀과 평균 스텝 체류시간을 계산한다. M20은 개별 로트의 `nextStepOperatingMs` 예정 이벤트를 처리하고, M21·M22는 FOUP-equivalent 버킷을 완성된 운영 퀀텀 수만큼 부분 이동한다. 엔진은 이동량·자재 소모·EMA 분모를 동일한 처리 운영시간에 연결한다.

**Tech Stack:** TypeScript, Next.js 16.2.10 server runtime, MongoDB Node driver, `tsx` 스크립트 테스트, Node `assert`.

## Global Constraints

- 모든 모델 운영시간은 `src/lib/twin/operating-clock.ts`의 공통 시계를 사용한다.
- 배속은 반드시 `OPERATING_SPEED_MULTIPLIER = 24`이며 제품별·기능별 별도 시계를 만들지 않는다.
- `lastEventAt`, `createdAt`, `updatedAt`은 감사용 벽시계이며 WIP due 판정에 사용하지 않는다.
- 평균 스텝 체류시간은 승인된 `cycleTimeDays / totalRouteSteps` 균등 배분을 사용한다.
- M20 기존 로트와 M21·M22 기존 버킷을 삭제하거나 재부트스트랩하지 않는다.
- 자재 `COVERAGE_CRITICAL`과 완제품 창고 `CAPACITY_OVER` 게이트를 보존한다.
- 공통 운영시계의 catch-up 상한은 운영 1일을 유지한다.
- 기존 dirty worktree의 무관한 변경과 `.superpowers/`, `tmp-verify.ts`는 수정하거나 stage하지 않는다.
- 구현 기준 설계는 `docs/superpowers/specs/2026-08-22-wip-operating-clock-alignment-design.md`다.

---

## File Map

- Create `src/lib/twin/wip-flow.ts`: 운영 5분 퀀텀, 잔여시간, 평균 스텝 체류시간, 안정적 로트 위상 계산만 담당한다.
- Modify `src/lib/db.ts`: `TwinEngineStateDoc.wipFlowCarryMs`, `WaferLotDoc.nextStepOperatingMs`, 소수 FOUP-equivalent 계약을 선언한다.
- Modify `src/lib/twin/state.ts`: 새 상태를 만드는 경우 `wipFlowCarryMs: 0`으로 시작한다.
- Modify `src/lib/twin/step-bucket.ts`: 전체 한 칸 시프트를 퀀텀 기반 부분 흐름으로 교체하고 투입까지 한 계산 안에서 처리한다.
- Modify `src/lib/lot-route.ts`: M20 due 기준을 운영 예정시각으로 교체하고 기존 로트를 lazy backfill한다.
- Modify `src/lib/twin/engine.ts`: 공통 퀀텀 계획, 두 WIP 모드 호출, 제품별 소모율 정규화, 상태 저장을 연결한다.
- Create `scripts/test-wip-operating-flow.ts`: 공통 시간 수학과 tick 분할 불변성을 검증한다.
- Modify `scripts/test-step-bucket.ts`: 부분 흐름·질량보존·게이팅·장기 처리량을 검증한다.
- Modify M20 DB 회귀 스크립트들: 운영 예정시각을 명시해 새 함수 계약을 검증한다.
- Delete `scripts/test-lot-desync.ts`: 제거되는 벽시계 지터 계약 테스트를 없앤다.
- Modify `package.json`: 새 순수 테스트를 등록하고 obsolete desync 테스트를 제거한다.
- Modify `docs/foup-wip-master.md`, `docs/route-master.md`, `docs/roles/production.md`: “미정합” 현재형 설명을 새 운영 계약으로 바꾼다.

---

### Task 1: 공통 WIP 시간 수학과 상태 스키마

**Files:**
- Create: `src/lib/twin/wip-flow.ts`
- Modify: `src/lib/db.ts:76-94,629-659,728-736`
- Modify: `src/lib/twin/state.ts:5-25`
- Create: `scripts/test-wip-operating-flow.ts`
- Modify: `package.json:24-40`

**Interfaces:**
- Consumes: `operatingDaysToMs(days: number): number`, `operatingMsToDays(ms: number): number` from `src/lib/twin/operating-clock.ts`.
- Produces: `WIP_FLOW_QUANTUM_MS`, `planWipFlowWindow`, `stepDwellOperatingMs`, `stableOperatingPhaseMs`.
- Produces schema: `TwinEngineStateDoc.wipFlowCarryMs?: number`, `WaferLotDoc.nextStepOperatingMs?: number`.

- [ ] **Step 1: Write the failing common-flow test**

Create `scripts/test-wip-operating-flow.ts` with these assertions:

```ts
import assert from "node:assert/strict";
import {
  WIP_FLOW_QUANTUM_MS,
  planWipFlowWindow,
  stableOperatingPhaseMs,
  stepDwellOperatingMs,
} from "../src/lib/twin/wip-flow";
import { operatingDaysToMs } from "../src/lib/twin/operating-clock";

assert.equal(WIP_FLOW_QUANTUM_MS, 5 * 60_000, "운영 5분 퀀텀");
assert.equal(stepDwellOperatingMs(105, 140), operatingDaysToMs(0.75));
assert.throws(() => stepDwellOperatingMs(0, 140), /cycleTimeDays/);
assert.throws(() => stepDwellOperatingMs(105, 0), /totalSteps/);

const once = planWipFlowWindow({ elapsedOperatingMs: 17 * 60_000, carryMs: 0 });
const first = planWipFlowWindow({ elapsedOperatingMs: 7 * 60_000, carryMs: 0 });
const second = planWipFlowWindow({ elapsedOperatingMs: 10 * 60_000, carryMs: first.nextCarryMs });
assert.equal(once.quantumCount, first.quantumCount + second.quantumCount);
assert.equal(once.nextCarryMs, second.nextCarryMs);
assert.equal(once.processedOperatingMs + once.nextCarryMs, 17 * 60_000);

const phaseA = stableOperatingPhaseMs("WLOT-A", operatingDaysToMs(0.75));
assert.equal(phaseA, stableOperatingPhaseMs("WLOT-A", operatingDaysToMs(0.75)));
assert.ok(phaseA > 0 && phaseA < operatingDaysToMs(0.75));
assert.notEqual(phaseA, stableOperatingPhaseMs("WLOT-B", operatingDaysToMs(0.75)));

console.log("✅ WIP 운영시간 흐름 계산 통과");
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `npx tsx scripts/test-wip-operating-flow.ts`

Expected: FAIL with `Cannot find module '../src/lib/twin/wip-flow'`.

- [ ] **Step 3: Implement the focused time helper**

Create `src/lib/twin/wip-flow.ts` with this public shape and integer-safe calculation:

```ts
import { operatingDaysToMs, operatingMsToDays } from "@/lib/twin/operating-clock";

export const WIP_FLOW_QUANTUM_MS = 5 * 60_000;

export type WipFlowWindow = {
  quantumCount: number;
  processedOperatingMs: number;
  processedOperatingDays: number;
  nextCarryMs: number;
};

export function planWipFlowWindow(input: {
  elapsedOperatingMs: number;
  carryMs: number;
}): WipFlowWindow {
  const elapsed = Math.max(0, input.elapsedOperatingMs);
  const carry = Math.max(0, input.carryMs);
  const total = carry + elapsed;
  const quantumCount = Math.floor(total / WIP_FLOW_QUANTUM_MS);
  const processedOperatingMs = quantumCount * WIP_FLOW_QUANTUM_MS;
  return {
    quantumCount,
    processedOperatingMs,
    processedOperatingDays: operatingMsToDays(processedOperatingMs),
    nextCarryMs: total - processedOperatingMs,
  };
}

export function stepDwellOperatingMs(cycleTimeDays: number, totalSteps: number): number {
  if (!Number.isFinite(cycleTimeDays) || cycleTimeDays <= 0) {
    throw new Error("cycleTimeDays는 0보다 커야 합니다.");
  }
  if (!Number.isInteger(totalSteps) || totalSteps <= 0) {
    throw new Error("totalSteps는 양의 정수여야 합니다.");
  }
  return operatingDaysToMs(cycleTimeDays / totalSteps);
}

export function stableOperatingPhaseMs(key: string, spanMs: number): number {
  if (!Number.isFinite(spanMs) || spanMs <= 1) throw new Error("spanMs는 1보다 커야 합니다.");
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return Math.max(1, Math.min(spanMs - 1, Math.floor(((hash + 1) / 0x1_0000_0001) * spanMs)));
}
```

- [ ] **Step 4: Add optional persistence fields and comments**

In `TwinEngineStateDoc` add:

```ts
/** STEP_BUCKET 공통 5분 운영 퀀텀에 못 미친 잔여 운영시간. 별도 시계가 아니다. */
wipFlowCarryMs?: number;
```

In `WaferLotDoc` add:

```ts
/** 다음 route 스텝을 완료할 운영 절대시각. 엔진 due 판정의 유일한 시간 근거. */
nextStepOperatingMs?: number;
```

Change the `WipStepBucketDoc.counts` comment to state that fractional FOUP-equivalent values are allowed. Add `wipFlowCarryMs: 0` to the singleton created by `getOrInitTwinState()`.

- [ ] **Step 5: Register and run the test**

Add to `package.json`:

```json
"test:wip-operating-flow": "tsx scripts/test-wip-operating-flow.ts"
```

Run: `npm run test:wip-operating-flow && npm run test:operating-clock`

Expected: both commands print their success messages and exit 0.

- [ ] **Step 6: Commit the isolated time-contract change**

```bash
git add src/lib/twin/wip-flow.ts src/lib/db.ts src/lib/twin/state.ts scripts/test-wip-operating-flow.ts package.json
git commit -m "feat(twin): add shared WIP operating-time flow"
```

---

### Task 2: M21·M22 부분 흐름 STEP_BUCKET 엔진

**Files:**
- Modify: `src/lib/twin/step-bucket.ts:1-160`
- Modify: `scripts/test-step-bucket.ts:1-60`

**Interfaces:**
- Consumes: `WipFlowWindow.quantumCount`, `WIP_FLOW_QUANTUM_MS`, `stepDwellOperatingMs` from Task 1.
- Produces: `computeStepFlow(input): StepFlowResult` and `advanceStepBucketWip(...): Promise<StepFlowResult>`.
- Removes: `computeStepRelease`, `releaseStepBucketWip`, and tick당 전체 시프트 의미의 `computeStepAdvance`.

- [ ] **Step 1: Replace old whole-shift assertions with fractional-flow failures**

Rewrite `scripts/test-step-bucket.ts` around this contract:

```ts
import assert from "node:assert/strict";
import { buildSeedCounts, computeStepFlow } from "../src/lib/twin/step-bucket";
import type { StepConsumption } from "../src/lib/twin/burn";

const noConsumption: StepConsumption = new Map();
const result = computeStepFlow({
  counts: [10, 20, 30],
  quantumCount: 1,
  quantumOperatingDays: 0.1,
  stepDwellDays: 1,
  dailyRate: 3,
  target: 60,
  stepConsumption: noConsumption,
  blockedMaterialIds: new Set(),
  finishedGoodsCapacityOver: false,
  wafersPerFoup: 25,
});
assert.deepEqual(result.nextCounts, [9.3, 19, 29]);
assert.equal(result.advancedFoup, 6);
assert.equal(result.completedFoup, 3);
assert.equal(result.releasedFoup, 0.3);
assert.ok(Math.abs(result.nextCounts.reduce((a, b) => a + b, 0) - 57.3) < 1e-9);
```

Add cases for `quantumCount: 0`, material block, finished-goods block, material burn, ten 0.1-day quanta versus one call with `quantumCount: 10`, and the conservation equation:

```text
next total = previous total + releasedFoup - completedFoup
```

- [ ] **Step 2: Run the step-bucket test and verify it fails**

Run: `npx tsx scripts/test-step-bucket.ts`

Expected: FAIL because `computeStepFlow` is not exported.

- [ ] **Step 3: Implement one simultaneous fractional quantum**

Inside `src/lib/twin/step-bucket.ts`, add an internal `computeStepFlowQuantum` that:

```ts
const moveFraction = Math.min(1, quantumOperatingDays / stepDwellDays);
const nextCounts = counts.slice();
for (let i = 0; i < counts.length; i++) {
  const movable = counts[i] * moveFraction;
  if (stepIsBlocked) {
    blockedFoup += movable;
    continue;
  }
  nextCounts[i] -= movable;
  if (i === counts.length - 1) completedFoup += movable;
  else nextCounts[i + 1] += movable;
}
const room = Math.max(0, target - nextCounts.reduce((sum, count) => sum + count, 0));
const releasedFoup = Math.min(dailyRate * quantumOperatingDays, room);
nextCounts[0] += releasedFoup;
```

Use the original `counts` snapshot for every step so material cannot cross multiple route steps inside one quantum. Compute burn only from `movable * wafersPerFoup`. Clamp values with absolute magnitude below `1e-9` to zero.

- [ ] **Step 4: Implement multi-quantum accumulation**

Export:

```ts
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

export function computeStepFlow(input: {
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
}): StepFlowResult;
```

Loop exactly `quantumCount` times, feed each result's `nextCounts` into the next quantum, and sum all scalar and material results. `processedOperatingDays` must equal `quantumCount * quantumOperatingDays`.

- [ ] **Step 5: Replace the database wrapper**

Change `advanceStepBucketWip` to accept this timing/config object:

```ts
flow: {
  quantumCount: number;
  quantumOperatingDays: number;
  stepDwellDays: number;
  dailyRate: number;
  target: number;
}
```

Return without writing when `quantumCount === 0`. Otherwise read once, call `computeStepFlow`, and update the bucket once. Remove `releaseStepBucketWip`; release is now part of every processed quantum.

- [ ] **Step 6: Run focused tests**

Run: `npm run test:wip-operating-flow && npx tsx scripts/test-step-bucket.ts`

Expected: both pass; the step-bucket test confirms conservation, gates, burn, and multi-quantum equivalence.

- [ ] **Step 7: Commit the aggregate flow engine**

```bash
git add src/lib/twin/step-bucket.ts scripts/test-step-bucket.ts
git commit -m "feat(twin): advance aggregate WIP by operating time"
```

---

### Task 3: M20 개별 로트 운영 예정시각

**Files:**
- Modify: `src/lib/lot-route.ts:1-410`
- Modify: `src/lib/twin/state.ts:35-55`
- Modify: `scripts/test-twin-advance-steps.ts`
- Modify: `scripts/test-completed-wafer-qty.ts`
- Modify: `scripts/test-advance-aggregate-batch-cap.ts`
- Delete: `scripts/test-lot-desync.ts`
- Modify: `package.json:34-42`

**Interfaces:**
- Consumes: `stepDwellOperatingMs`, `stableOperatingPhaseMs` from Task 1.
- Produces: `AggregateWipTiming`, revised `advanceAggregateWip`, revised `releaseAggregateWip`.
- Preserves: `advancedFromStepIndex`, material/FG gates, completed wafer quantities, release carry.

- [ ] **Step 1: Change direct M20 tests to express operating due time**

In each M20 test, replace stale wall-clock setup with a fixed timing object:

```ts
const timing = {
  operatingEpochMs: 10 * 86_400_000,
  elapsedOperatingMs: 5 * 60_000,
  recordedAt: new Date("2026-08-22T00:00:00Z"),
};
```

Insert test lots with `nextStepOperatingMs: timing.operatingEpochMs - 1` and call:

```ts
await advanceAggregateWip("M20", "HBM", timing, gating);
```

Add assertions that a lot with `lastEventAt: new Date(0)` but future `nextStepOperatingMs` does not advance, and a due lot with a recent `lastEventAt` does advance.

- [ ] **Step 2: Run one direct test and verify the signature fails**

Run: `npm run test:twin-advance-steps`

Expected: FAIL because the old implementation interprets the timing object as the gate argument or ignores
`nextStepOperatingMs`, so the new due-time assertion cannot pass.

- [ ] **Step 3: Remove wall-clock auto advance and jitter**

Delete `AUTO_ADVANCE_INTERVAL_MS`, `DESYNC_EXTRA_DELAY_CHANCE`, `jitteredLastEventAt`, and `autoAdvanceIfDue`. Change `listActiveLotStates` to create/return the WATCHED lots without progressing them:

```ts
export async function listActiveLotStates(fabId: FabId, product: Product, actorId: string): Promise<LotRouteState[]> {
  const lots = await Promise.all(FOUP_CODES.map((code) => getOrCreateActiveLot(fabId, product, code, actorId)));
  return Promise.all(lots.map((lot) => getLotRouteState(lot._id)));
}
```

Delete `scripts/test-lot-desync.ts` and remove `test:lot-desync` from `package.json`.

- [ ] **Step 4: Add the timing contract and lazy schedule initialization**

Export:

```ts
export type AggregateWipTiming = {
  operatingEpochMs: number;
  elapsedOperatingMs: number;
  recordedAt: Date;
};
```

Before due selection, query active engine-managed M20 lots whose `nextStepOperatingMs` does not exist. Bulk update each with:

```ts
nextStepOperatingMs: timing.operatingEpochMs + stableOperatingPhaseMs(lot._id, stepDwellMs)
```

Also set `updatedAt: timing.recordedAt`. Do not change current step, status, or `lastEventAt`. A phase is strictly greater than zero, so initialized lots cannot progress in the same tick.

In `ensureTwinIndexes()`, include `waferLots` and create the due-query index:

```ts
await waferLots.createIndex({
  fabId: 1,
  product: 1,
  cohort: 1,
  status: 1,
  nextStepOperatingMs: 1,
});
```

- [ ] **Step 5: Replace due selection and process scheduled events**

Query only:

```ts
{
  fabId,
  product,
  cohort: { $in: ["AGGREGATE", "MODELED_FOUP"] },
  status: "IN_PROGRESS",
  nextStepOperatingMs: { $lte: timing.operatingEpochMs },
}
```

Sort by `nextStepOperatingMs` and retain `cfg.advanceBatchMax`. For each lot, loop while due and below:

```ts
const maxSteps = Math.ceil(timing.elapsedOperatingMs / stepDwellMs) + 1;
```

On successful movement, add the wafer quantity to `advancedFromStepIndex[fromStep]`, increment `nextStepOperatingMs` by `stepDwellMs`, and continue if still due. On material or FG block, preserve the first block timestamp, set `nextStepOperatingMs = timing.operatingEpochMs + stepDwellMs`, and stop that lot. Set `lastEventAt = timing.recordedAt` only when at least one step moved.

Use one final `updateOne` per lot so catch-up does not write the same document multiple times. Filter by the original `nextStepOperatingMs` to retain optimistic concurrency protection.

After lazy schedule initialization, return the empty result without due processing when
`timing.elapsedOperatingMs <= 0`. This preserves the invariant that zero elapsed operating time cannot move WIP.

- [ ] **Step 6: Schedule newly released M20 lots in operating time**

Change `releaseAggregateWip` to accept `AggregateWipTiming`, calculate `simDays` with `operatingMsToDays(timing.elapsedOperatingMs)`, and write:

```ts
createdAt: timing.recordedAt,
updatedAt: timing.recordedAt,
lastEventAt: timing.recordedAt,
modeledReleaseAt: timing.recordedAt,
nextStepOperatingMs: timing.operatingEpochMs + stepDwellMs,
```

Keep integer release carry and target occupancy logic unchanged.

- [ ] **Step 7: Run M20 focused regression tests**

Run:

```bash
npm run test:wip-operating-flow
npm run test:twin-advance-steps
npx tsx scripts/test-completed-wafer-qty.ts
npm run test:advance-aggregate-batch-cap
```

Expected: all pass; recent/future wall audit timestamps do not control due selection.

- [ ] **Step 8: Commit the per-lot scheduler**

```bash
git add src/lib/lot-route.ts src/lib/twin/state.ts scripts/test-twin-advance-steps.ts scripts/test-completed-wafer-qty.ts scripts/test-advance-aggregate-batch-cap.ts scripts/test-lot-desync.ts package.json
git commit -m "feat(twin): schedule M20 WIP on operating time"
```

---

### Task 4: Twin 엔진 연결과 EMA 시간 분모 정합화

**Files:**
- Modify: `src/lib/twin/engine.ts:1-410,590-605`
- Modify: `scripts/test-twin-calibration.ts`
- Modify: `scripts/test-twin-wip-release.ts`

**Interfaces:**
- Consumes: `planWipFlowWindow`, `WIP_FLOW_QUANTUM_MS`, `stepDwellOperatingMs`, `AggregateWipTiming`, `StepFlowResult`.
- Produces: one shared `wipFlowCarryMs` state update and per-product observed daily burn aggregation.

- [ ] **Step 1: Add a failing pure assertion for product burn-rate aggregation**

Export this helper from `engine.ts`:

```ts
export function mergeObservedDailyBurn(
  target: Map<string, number>,
  burn: ReadonlyMap<string, number>,
  processedOperatingDays: number,
): void;
```

Add to `scripts/test-twin-calibration.ts` before DB setup:

```ts
const observed = new Map<string, number>();
mergeObservedDailyBurn(observed, new Map([["MAT-A", 50]]), 0.5);
mergeObservedDailyBurn(observed, new Map([["MAT-A", 30]]), 0.25);
assert.equal(observed.get("MAT-A"), 220, "제품별 100/day + 120/day를 더한다");
```

- [ ] **Step 2: Run calibration and verify the missing export failure**

Run: `npm run test:twin-calibration`

Expected: FAIL because `mergeObservedDailyBurn` is not exported.

- [ ] **Step 3: Plan the common bucket flow window once per tick**

Immediately after `advanceOperatingClock`, compute:

```ts
const wipFlow = planWipFlowWindow({
  elapsedOperatingMs: clock.elapsedOperatingMs,
  carryMs: state.wipFlowCarryMs ?? 0,
});
const aggregateTiming: AggregateWipTiming = {
  operatingEpochMs: clock.operatingEpochMs,
  elapsedOperatingMs: clock.elapsedOperatingMs,
  recordedAt: now,
};
```

Remove `operatingDaysPerStep` from `engine.ts`; the shared helper now owns dwell calculation.

- [ ] **Step 4: Wire PER_LOT and STEP_BUCKET without independent release clocks**

For M20 call:

```ts
const adv = await advanceAggregateWip(fabId, product, aggregateTiming, gating);
const release = await releaseAggregateWip(fabId, product, aggregateTiming, carryByProduct[product] ?? 0);
```

For M21/M22 call:

```ts
const stepDwellDays = cfg.cycleTimeDays / totalSteps;
const adv = await advanceStepBucketWip(fabId, product, gating, {
  quantumCount: wipFlow.quantumCount,
  quantumOperatingDays: operatingMsToDays(WIP_FLOW_QUANTUM_MS),
  stepDwellDays,
  dailyRate: cfg.dailyLotRelease,
  target: cfg.targetOccupiedFoup,
});
totalReleased += adv.releasedFoup;
```

Do not call `releaseStepBucketWip`. Use `wipFlow.processedOperatingDays` as the STEP_BUCKET burn observation duration.

- [ ] **Step 5: Normalize each product's demand before merging materials**

Implement `mergeObservedDailyBurn` with `observedDailyDemand(qty, processedOperatingDays)` and sum the resulting daily rates by material. Maintain two maps in the product loop:

```ts
const burnedByMaterialAgg = new Map<string, number>();
const observedDailyBurnAgg = new Map<string, number>();
```

For M20, convert `computeBurn(...)` once, merge quantities, then call `mergeObservedDailyBurn` with `elapsedOperatingDays`. For M21/M22, use `adv.burnByMaterial` and `wipFlow.processedOperatingDays`. In the inventory loop replace:

```ts
const observedDaily = observedDailyDemand(qty, emaSimDays);
```

with:

```ts
const observedDaily = observedDailyBurnAgg.get(materialId) ?? 0;
```

This avoids dividing a five-minute quantum's burn by only the final tick's two minutes of elapsed time.

- [ ] **Step 6: Persist the shared integration residue**

Add to the existing singleton update:

```ts
wipFlowCarryMs: wipFlow.nextCarryMs,
```

Do not create product-specific carry fields. Leave legacy DRAM/NAND values in `releaseCarryByProduct` unread for backward compatibility; only HBM continues to update its integer release carry.

- [ ] **Step 7: Update calibration and release tests to the new clock**

In `scripts/test-twin-calibration.ts`, set both `operatingEpochMs` and `operatingClockWallAt` so the chosen `now` yields a known positive `elapsedOperatingDays`. Insert the test lot with a due `nextStepOperatingMs`. Assert the EMA against `mergeObservedDailyBurn`/actual common-clock duration, not `cycleDays / totalSteps` per tick.

Keep `scripts/test-twin-wip-release.ts` focused on integer M20 release carry, but rename test descriptions from `simDays` to `elapsedOperatingDays`.

- [ ] **Step 8: Run engine-focused tests**

Run:

```bash
npm run test:wip-operating-flow
npx tsx scripts/test-step-bucket.ts
npm run test:twin-calibration
npm run test:twin-wip-release
npm run test:twin-engine
```

Expected: all pass in an environment with the configured MongoDB test database; pure tests pass without MongoDB.

- [ ] **Step 9: Commit the engine integration**

```bash
git add src/lib/twin/engine.ts scripts/test-twin-calibration.ts scripts/test-twin-wip-release.ts
git commit -m "fix(twin): align WIP burn and EMA to operating time"
```

---

### Task 5: 모든 직접 호출 회귀 테스트와 레거시 검증기 갱신

**Files:**
- Modify: `scripts/test-aggregate-wip-generalization.ts`
- Modify: `scripts/test-finished-goods-capacity-gate.ts`
- Modify: `scripts/test-material-circuit-breaker-integration.ts`
- Modify: `scripts/verify-advance-aggregate-wip.ts`
- Modify: `scripts/test-wafer-lot-12foup.ts`
- Modify: `scripts/test-twin-equilibrium.ts`

**Interfaces:**
- Consumes: `AggregateWipTiming` and revised `advanceAggregateWip` from Task 3.
- Produces: no runtime API; this task closes all old call-site and old wall-clock assumptions.

- [ ] **Step 1: Find every old call and removed symbol**

Run:

```bash
rg -n "advanceAggregateWip\(|AUTO_ADVANCE_INTERVAL_MS|jitteredLastEventAt|DESYNC_EXTRA_DELAY_CHANCE|computeStepAdvance|computeStepRelease|releaseStepBucketWip" src scripts --glob '*.ts'
```

Expected: only the new signatures plus the listed legacy test files remain. Use this exact list as the edit boundary.

- [ ] **Step 2: Update each direct database test**

For every inserted aggregate test lot, set a deterministic due `nextStepOperatingMs`. Pass a fixed `AggregateWipTiming` before the optional gate argument. Replace assertions about “5초 전/후” with these two invariants:

```ts
assert.equal(notDue.advanced, 0, "미래 운영 예정시각은 진행하지 않는다");
assert.ok(due.advanced > 0, "지난 운영 예정시각은 진행한다");
```

In tests that run twice, read the updated lot and explicitly set its next operating due time before the second call; do not use wall-clock sleeps.

- [ ] **Step 3: Preserve WATCHED manual behavior**

Update `scripts/test-wafer-lot-12foup.ts` so `listActiveLotStates` is asserted not to add step history. Keep its explicit `advanceLotStep` test, which verifies that a user/MES event still advances the watched lot.

- [ ] **Step 4: Run the obsolete-symbol scan again**

Run the same `rg` command from Step 1.

Expected: no occurrence of `AUTO_ADVANCE_INTERVAL_MS`, `jitteredLastEventAt`, `DESYNC_EXTRA_DELAY_CHANCE`, `computeStepAdvance`, `computeStepRelease`, or `releaseStepBucketWip` under active `src` or `scripts` TypeScript files.

- [ ] **Step 5: Run the affected regression set**

Run:

```bash
npx tsx scripts/test-aggregate-wip-generalization.ts
npx tsx scripts/test-finished-goods-capacity-gate.ts
npx tsx scripts/test-material-circuit-breaker-integration.ts
npm run test:wafer-lot-12foup
npm run test:twin-equilibrium
```

Expected: all pass with configured test data and leave their temporary documents cleaned up in `finally` blocks.

- [ ] **Step 6: Commit call-site cleanup**

```bash
git add scripts/test-aggregate-wip-generalization.ts scripts/test-finished-goods-capacity-gate.ts scripts/test-material-circuit-breaker-integration.ts scripts/verify-advance-aggregate-wip.ts scripts/test-wafer-lot-12foup.ts scripts/test-twin-equilibrium.ts
git commit -m "test(twin): cover operating-time WIP progression"
```

---

### Task 6: 운영 문서의 현재형 계약 갱신

**Files:**
- Modify: `docs/foup-wip-master.md:230-248`
- Modify: `docs/route-master.md:270-290`
- Modify: `docs/roles/production.md:58-78`
- Modify: `docs/fab-operating-baseline.md:80-100`

**Interfaces:**
- Consumes: final names and behavior from Tasks 1-5.
- Produces: current engine behavior matching the code; historical plan documents remain unchanged.

- [ ] **Step 1: Replace the known-gap statements**

Document these exact current contracts:

```text
M20 PER_LOT: nextStepOperatingMs <= operatingEpochMs인 엔진 관리 로트만 진행한다.
M21/M22 STEP_BUCKET: 공통 운영 5분 퀀텀마다 평균 step dwell 비율만큼 FOUP-equivalent를 이동한다.
공통 배속: 실제 1시간 = 운영 1일 = 24×.
벽시계 필드: 실행·감사 사실만 기록하며 due 판정에 쓰지 않는다.
```

Remove phrases stating that WIP time alignment is still pending. Keep the limitation that per-step measured dwell, equipment/OEE gating, and carrier genealogy are not implemented.

- [ ] **Step 2: Add source links to the approved design**

At the end of each changed time-axis section, link:

```markdown
상세 전환·호환성 설계: `docs/superpowers/specs/2026-08-22-wip-operating-clock-alignment-design.md`
```

- [ ] **Step 3: Scan docs for obsolete current-state claims**

Run:

```bash
rg -n "AUTO_ADVANCE_INTERVAL_MS|tick마다.*1스텝|틱마다.*한 공정|시간축 공백|정합화 필요" docs --glob '*.md'
```

Expected: matches remain only in explicitly historical plan/spec context. Current master and role documents must have zero obsolete claims.

- [ ] **Step 4: Review the overlapping dirty-doc diff without staging unrelated hunks**

Run:

```bash
git diff -- docs/foup-wip-master.md docs/route-master.md docs/roles/production.md docs/fab-operating-baseline.md
```

These files were already modified before this plan. Do not stage them as a whole in this task. Leave their combined changes in the working tree and list them in the final handoff so the existing documentation audit is not silently mixed into a code commit.

---

### Task 7: 전체 정적·빌드·회귀 검증

**Files:**
- Verify only; fix failures in the file that introduced them.

**Interfaces:**
- Consumes: all runtime and test interfaces from Tasks 1-6.
- Produces: a deployable build and an evidence-backed handoff.

- [ ] **Step 1: Run formatting and obsolete-symbol checks**

Run:

```bash
git diff --check
rg -n "AUTO_ADVANCE_INTERVAL_MS|jitteredLastEventAt|DESYNC_EXTRA_DELAY_CHANCE|releaseStepBucketWip" src scripts --glob '*.ts'
```

Expected: `git diff --check` exits 0 and the symbol scan returns no matches.

- [ ] **Step 2: Run deterministic pure tests**

Run:

```bash
npm run test:operating-clock
npm run test:wip-operating-flow
npx tsx scripts/test-step-bucket.ts
npm run test:twin-wip-release
npm run test:twin-inbound
```

Expected: all print success and exit 0 without relying on live operational mutations.

- [ ] **Step 3: Run database-backed focused tests**

Run:

```bash
npm run test:twin-advance-steps
npm run test:twin-calibration
npm run test:advance-aggregate-batch-cap
npx tsx scripts/test-completed-wafer-qty.ts
npx tsx scripts/test-finished-goods-capacity-gate.ts
npx tsx scripts/test-material-circuit-breaker-integration.ts
```

Expected: all pass and clean their temporary records. If MongoDB is unavailable, record the exact connection error and still complete Steps 1, 2, 4, and 5.

- [ ] **Step 4: Run static checks**

Run: `npm run typecheck && npm run lint`

Expected: both exit 0 with no errors introduced by the WIP change.

- [ ] **Step 5: Run the production build**

Run: `npm run build`

Expected: Next.js 16.2.10 production build exits 0 without missing-module or export errors.

- [ ] **Step 6: Inspect final scope and commits**

Run:

```bash
git status --short
git log -6 --oneline
git diff --stat
```

Expected: code and tests from Tasks 1-5 are committed in focused commits; documentation changes from Task 6 remain visible alongside the pre-existing documentation audit; `.superpowers/` and `tmp-verify.ts` remain untouched.
