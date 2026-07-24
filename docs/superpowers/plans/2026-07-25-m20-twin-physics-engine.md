# M20 Twin Physics Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M20 디지털 트윈이 매 tick마다 AGGREGATE WIP 진행에 비례해 창고 재고를 실제로 소모하고, ROP 미달 자재는 PO를 발주해 리드타임 후 입고로 다시 채우는 서버 주도 양방향 물리 엔진을 만든다.

**Architecture:** 순수 함수(소모 계산·입고 계획·EMA)와 DB 오케스트레이션(`executeTwinTick`)을 분리한다. `instrumentation.ts`가 서버 부팅 시 싱글턴 `setInterval`을 띄우고, 각 tick은 DB 락으로 중복을 막은 뒤 ① `advanceAggregateWip` ② 소모(창고 `inventory` 차감) ③ 입고(`twinPurchaseOrders`)를 실행한다. 기존 `sim-engine`(what-if 샌드박스)과 VISUAL 파일럿 배관은 건드리지 않는다.

**Tech Stack:** Next.js 16 (App Router, Turbopack), TypeScript strict, MongoDB (replica set — 트랜잭션 가능), tsx 테스트 스크립트 + `node:assert/strict`.

## Global Constraints

- **범위: M20/HBM 전용.** 모든 엔진 함수는 `fabId`/`product`를 받되 `M20`/`HBM` 외에는 즉시 no-op. M21/M22는 이번 플랜 밖.
- **무회귀: `sim-engine.ts`/`sim-runner.ts`/`simPurchaseOrders`(샌드박스)와 VISUAL 12 FOUP 파일럿 배관을 변경하지 않는다.** 트윈은 별도 컬렉션(`twinEngineState`/`twinPurchaseOrders`/`twinBurnEvents`)만 쓴다.
- **소모 대상 = 창고 `inventory` 컬렉션의 `quantity`.** 소모는 AGGREGATE 코호트 진행만 반영(VISUAL은 기존 IN_TRANSIT 차감 유지 → 이중 차감 없음).
- **시간축 = 실제시간 1:1.** `speedMultiplier` 필드는 기본 1로 저장만(배속 기능은 이번 범위 밖).
- **타입 체크: `npx tsc --noEmit` 통과가 모든 태스크의 완료 조건.**
- **DB 스크립트는 파일 상단에 `import "dotenv/config";`** 를 넣어 `.env`를 로드한다(별도 dotenv-cli 래퍼 불필요, 기존 관례).
- 계수 출처: `M20_MATERIAL_CONSUMPTION`(`src/lib/material-consumption.ts`)의 `equivalentPerWafer`. 리드타임 출처: `sim-engine.ts`의 `LEAD_TIME_RANGE`(Task 1에서 공유 모듈로 추출).

---

## File Structure

- Create `src/lib/twin/lead-time.ts` — 카테고리별 리드타임 공유 로직(sim-engine에서 추출).
- Create `src/lib/twin/burn.ts` — 순수 소모 계산(`buildStepConsumption`, `computeBurn`).
- Create `src/lib/twin/inbound.ts` — 순수 입고 계획(`planInbound`, `settleArrivals`, `updateBurnEma`).
- Create `src/lib/twin/state.ts` — 트윈 엔진 상태·락·인덱스(`getOrInitTwinState`, `acquireTwinLock`, `releaseTwinLock`, `ensureTwinIndexes`).
- Create `src/lib/twin/engine.ts` — `executeTwinTick` 오케스트레이션.
- Create `src/lib/twin/scheduler.ts` — 싱글턴 `setInterval` 시작.
- Create `src/instrumentation.ts` — Next.js 부팅 훅에서 스케줄러 기동.
- Create `src/app/api/twin/engine/route.ts` — GET(상태/자재현황), POST(start/pause).
- Create `src/app/(dashboard)/usage/TwinEnginePanel.tsx` — 자재별 실시간 소모/입고 카드.
- Modify `src/lib/sim-engine.ts` — 리드타임을 공유 모듈에서 import.
- Modify `src/lib/db.ts` — 신규 doc 타입/컬렉션, `InventoryDoc.avgDailyBurn?` 추가.
- Modify `src/lib/inventory-projection.ts` — 클램프 소모 헬퍼 `burnInventoryProjection` 추가.
- Modify `src/lib/lot-route.ts` — `advanceAggregateWip` 반환에 `advancedFromStepIndex` 추가.
- Create test scripts: `scripts/test-twin-lead-time.ts`, `scripts/test-twin-burn.ts`, `scripts/test-twin-inbound.ts`, `scripts/test-twin-engine.ts`.
- Modify `package.json` — 위 `test:twin-*` 스크립트 등록.

---

## Task 1: 리드타임 공유 모듈 추출

**Files:**
- Create: `src/lib/twin/lead-time.ts`
- Modify: `src/lib/sim-engine.ts:33-42` (LEAD_TIME_RANGE/getBaseLeadTime 제거 후 re-export)
- Test: `scripts/test-twin-lead-time.ts`
- Modify: `package.json` (scripts 블록)

**Interfaces:**
- Produces:
  - `export const LEAD_TIME_RANGE: Record<string, [number, number]>`
  - `export function getBaseLeadTime(category: string): number`

- [ ] **Step 1: 실패 테스트 작성** — `scripts/test-twin-lead-time.ts`

```ts
import assert from "node:assert/strict";
import { getBaseLeadTime, LEAD_TIME_RANGE } from "../src/lib/twin/lead-time";

assert.equal(getBaseLeadTime("CHM"), 11, "CHM 평균 리드타임 (7+14)/2 반올림");
assert.equal(getBaseLeadTime("GAS"), 5, "GAS 평균 리드타임 (3+7)/2");
assert.equal(getBaseLeadTime("PKG"), 8, "PKG 평균 리드타임 (5+10)/2 반올림");
assert.equal(getBaseLeadTime("UNKNOWN"), 7, "미정의 카테고리 기본 7일");
assert.deepEqual(LEAD_TIME_RANGE.CHM, [7, 14], "CHM 범위");

console.log("✅ twin lead-time passed");
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx scripts/test-twin-lead-time.ts`
Expected: FAIL — `Cannot find module '../src/lib/twin/lead-time'`

- [ ] **Step 3: 구현** — `src/lib/twin/lead-time.ts`

```ts
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
```

- [ ] **Step 4: sim-engine 리팩터** — `src/lib/sim-engine.ts`의 로컬 `LEAD_TIME_RANGE`(33-37행)와 `getBaseLeadTime`(39-42행) 정의를 삭제하고 상단 import로 교체.

```ts
import { getBaseLeadTime, LEAD_TIME_RANGE } from "@/lib/twin/lead-time";
```

sim-engine 내부에서 `LEAD_TIME_RANGE`를 직접 참조하는 곳이 없으면 import는 `getBaseLeadTime`만 남긴다(사용처 grep으로 확인 후 미사용 심볼 제거).

- [ ] **Step 5: package.json 등록** — `scripts` 블록에 추가:

```json
"test:twin-lead-time": "tsx scripts/test-twin-lead-time.ts",
```

- [ ] **Step 6: 테스트 통과 + 회귀 확인**

Run: `npx tsx scripts/test-twin-lead-time.ts` → Expected: `✅ twin lead-time passed`
Run: `npx tsc --noEmit` → Expected: 에러 없음
Run: `npm run test:fab-scenario` (sim-engine 사용처 회귀) → Expected: 통과

- [ ] **Step 7: 커밋**

```bash
git add src/lib/twin/lead-time.ts src/lib/sim-engine.ts scripts/test-twin-lead-time.ts package.json
git commit -m "refactor: 리드타임을 twin/sim 공유 모듈로 추출"
```

---

## Task 2: DB 스키마 — 트윈 컬렉션 & 필드

**Files:**
- Modify: `src/lib/db.ts` (doc 인터페이스, collections 맵, `InventoryDoc`)

**Interfaces:**
- Produces:
  - `export interface TwinEngineStateDoc { _id: "singleton"; status: "RUNNING" | "PAUSED"; lastTickAt: Date; tickIntervalMs: number; speedMultiplier: number; lockedBy?: string | null; lockExpiresAt?: Date | null; }`
  - `export interface TwinPurchaseOrderDoc { _id: string; materialId: string; qty: number; orderedAt: Date; etaAt: Date; leadTimeDays: number; status: "ORDERED" | "IN_TRANSIT" | "RECEIVED"; }`
  - `export interface TwinBurnEventDoc { _id: string; tickAt: Date; materialId: string; burnedQty: number; shortfallQty: number; }`
  - `InventoryDoc.avgDailyBurn?: number`
  - `collections()` 결과에 `twinEngineState`, `twinPurchaseOrders`, `twinBurnEvents` 추가

- [ ] **Step 1: 실패 테스트 작성** — 이 태스크는 스키마 전용이므로 타입 검증으로 대신한다. `scripts/test-twin-schema.ts` 임시 작성:

```ts
import assert from "node:assert/strict";
import "dotenv/config";
import { collections } from "../src/lib/db";

async function main() {
  const c = await collections();
  assert.ok(c.twinEngineState, "twinEngineState 컬렉션 존재");
  assert.ok(c.twinPurchaseOrders, "twinPurchaseOrders 컬렉션 존재");
  assert.ok(c.twinBurnEvents, "twinBurnEvents 컬렉션 존재");
  console.log("✅ twin schema collections wired");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx scripts/test-twin-schema.ts`
Expected: FAIL — `twinEngineState` 프로퍼티 없음(타입/런타임 에러)

- [ ] **Step 3: 구현** — `src/lib/db.ts`

`InventoryDoc`(59행 부근)에 `avgDailyBurn?: number;` 추가:

```ts
export interface InventoryDoc {
  _id: string; materialId: string; warehouseId: string; quantity: number; avgDailyUsage: number;
  avgDailyBurn?: number; // twin 엔진이 실측한 일일 소모 EMA
  capacityLimit?: number;
  status?: InventoryStatus;
  // ...기존 필드 유지
}
```

파일의 doc 인터페이스 선언 구역에 신규 타입 3개 추가:

```ts
export interface TwinEngineStateDoc {
  _id: "singleton";
  status: "RUNNING" | "PAUSED";
  lastTickAt: Date;
  tickIntervalMs: number;
  speedMultiplier: number;
  lockedBy?: string | null;
  lockExpiresAt?: Date | null;
}
export interface TwinPurchaseOrderDoc {
  _id: string;
  materialId: string;
  qty: number;
  orderedAt: Date;
  etaAt: Date;
  leadTimeDays: number;
  status: "ORDERED" | "IN_TRANSIT" | "RECEIVED";
}
export interface TwinBurnEventDoc {
  _id: string;
  tickAt: Date;
  materialId: string;
  burnedQty: number;
  shortfallQty: number;
}
```

`Collections` 타입(701행 부근 `inventory: Collection<InventoryDoc>;` 인근)에 추가:

```ts
  twinEngineState: Collection<TwinEngineStateDoc>;
  twinPurchaseOrders: Collection<TwinPurchaseOrderDoc>;
  twinBurnEvents: Collection<TwinBurnEventDoc>;
```

`collections()`의 반환 객체(795행 부근 `waferLots: db.collection<WaferLotDoc>("waferLots"),` 인근)에 추가:

```ts
    twinEngineState: db.collection<TwinEngineStateDoc>("twinEngineState"),
    twinPurchaseOrders: db.collection<TwinPurchaseOrderDoc>("twinPurchaseOrders"),
    twinBurnEvents: db.collection<TwinBurnEventDoc>("twinBurnEvents"),
```

- [ ] **Step 4: 테스트 통과**

Run: `npx tsx scripts/test-twin-schema.ts` → Expected: `✅ twin schema collections wired`
Run: `npx tsc --noEmit` → Expected: 에러 없음

- [ ] **Step 5: 임시 스크립트 정리 + 커밋** — `scripts/test-twin-schema.ts`는 일회성이므로 삭제.

```bash
rm scripts/test-twin-schema.ts
git add src/lib/db.ts
git commit -m "feat: twin 엔진 컬렉션/필드 스키마 추가"
```

---

## Task 3: 소모 순수 함수 (burn.ts)

**Files:**
- Create: `src/lib/twin/burn.ts`
- Test: `scripts/test-twin-burn.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `RouteVisit`(`src/lib/route-master.ts` — `{ stepIndex: number; processCode: string }`), `M20MaterialConsumptionRow`(`{ materialId; processCode; equivalentPerWafer }`).
- Produces:
  - `export type StepConsumption = Map<number, { materialId: string; equivalentPerWafer: number }[]>`
  - `export function buildStepConsumption(visits: { stepIndex: number; processCode: string }[], rows: { materialId: string; processCode: string; equivalentPerWafer: number }[]): StepConsumption`
  - `export function computeBurn(advancedFromStepIndex: Record<number, number>, stepConsumption: StepConsumption): Map<string, number>`

- [ ] **Step 1: 실패 테스트 작성** — `scripts/test-twin-burn.ts`

```ts
import assert from "node:assert/strict";
import { buildStepConsumption, computeBurn } from "../src/lib/twin/burn";

// 스텝0=P01, 스텝1=P02, 스텝2=P01(재방문)
const visits = [
  { stepIndex: 0, processCode: "P01" },
  { stepIndex: 1, processCode: "P02" },
  { stepIndex: 2, processCode: "P01" },
];
const rows = [
  { materialId: "GAS-001", processCode: "P01", equivalentPerWafer: 0.2 },
  { materialId: "GAS-001", processCode: "P02", equivalentPerWafer: 0.3 },
  { materialId: "CHM-002", processCode: "P01", equivalentPerWafer: 0.02 },
];

const sc = buildStepConsumption(visits, rows);
assert.equal(sc.get(0)?.length, 2, "P01 스텝은 GAS-001+CHM-002 두 자재 소모");
assert.equal(sc.get(1)?.length, 1, "P02 스텝은 GAS-001만");

// 스텝0을 100웨이퍼, 스텝1을 50웨이퍼가 통과
const burn = computeBurn({ 0: 100, 1: 50 }, sc);
// GAS-001 = 100*0.2 + 50*0.3 = 35, CHM-002 = 100*0.02 = 2
assert.ok(Math.abs((burn.get("GAS-001") ?? 0) - 35) < 1e-9, "GAS-001 소모 합산");
assert.ok(Math.abs((burn.get("CHM-002") ?? 0) - 2) < 1e-9, "CHM-002 소모");

// 소모 자재가 없는 스텝은 무시, 빈 입력은 빈 결과
assert.equal(computeBurn({}, sc).size, 0, "빈 진행은 소모 없음");

console.log("✅ twin burn passed");
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx scripts/test-twin-burn.ts`
Expected: FAIL — `Cannot find module '../src/lib/twin/burn'`

- [ ] **Step 3: 구현** — `src/lib/twin/burn.ts`

```ts
// stepIndex → 그 스텝(공정)에서 소모되는 자재 목록.
export type StepConsumption = Map<number, { materialId: string; equivalentPerWafer: number }[]>;

export function buildStepConsumption(
  visits: { stepIndex: number; processCode: string }[],
  rows: { materialId: string; processCode: string; equivalentPerWafer: number }[],
): StepConsumption {
  const byProcess = new Map<string, { materialId: string; equivalentPerWafer: number }[]>();
  for (const row of rows) {
    const list = byProcess.get(row.processCode) ?? [];
    list.push({ materialId: row.materialId, equivalentPerWafer: row.equivalentPerWafer });
    byProcess.set(row.processCode, list);
  }
  const result: StepConsumption = new Map();
  for (const visit of visits) {
    const consumers = byProcess.get(visit.processCode);
    if (consumers && consumers.length > 0) result.set(visit.stepIndex, consumers);
  }
  return result;
}

// advancedFromStepIndex: 이번 tick에 각 stepIndex를 "완료하고" 다음 스텝으로 넘어간 웨이퍼 수.
export function computeBurn(
  advancedFromStepIndex: Record<number, number>,
  stepConsumption: StepConsumption,
): Map<string, number> {
  const burn = new Map<string, number>();
  for (const [stepIndexStr, wafers] of Object.entries(advancedFromStepIndex)) {
    if (!wafers) continue;
    const consumers = stepConsumption.get(Number(stepIndexStr));
    if (!consumers) continue;
    for (const { materialId, equivalentPerWafer } of consumers) {
      burn.set(materialId, (burn.get(materialId) ?? 0) + wafers * equivalentPerWafer);
    }
  }
  return burn;
}
```

- [ ] **Step 4: 테스트 통과 + 등록**

`package.json`에 `"test:twin-burn": "tsx scripts/test-twin-burn.ts",` 추가.
Run: `npx tsx scripts/test-twin-burn.ts` → Expected: `✅ twin burn passed`
Run: `npx tsc --noEmit` → Expected: 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add src/lib/twin/burn.ts scripts/test-twin-burn.ts package.json
git commit -m "feat: 트윈 소모 순수 함수(buildStepConsumption/computeBurn)"
```

---

## Task 4: 입고 순수 함수 (inbound.ts)

**Files:**
- Create: `src/lib/twin/inbound.ts`
- Test: `scripts/test-twin-inbound.ts`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `export function updateBurnEma(prevEma: number, observedDailyBurn: number, alpha: number): number`
  - `export function planInbound(input: { onHand: number; inTransit: number; avgDailyBurn: number; ropDays: number }): { qty: number } | null`
  - `export function settleArrivals(pos: { _id: string; etaAt: Date; qty: number; materialId: string; status: string }[], now: Date): { receipts: { poId: string; materialId: string; qty: number }[]; arrivedPoIds: string[] }`

- [ ] **Step 1: 실패 테스트 작성** — `scripts/test-twin-inbound.ts`

```ts
import assert from "node:assert/strict";
import { planInbound, settleArrivals, updateBurnEma } from "../src/lib/twin/inbound";

// EMA: 초기값이 0이면 관측값을 그대로 채택(부트스트랩)
assert.equal(updateBurnEma(0, 100, 0.2), 100, "EMA 부트스트랩");
assert.ok(Math.abs(updateBurnEma(100, 200, 0.2) - 120) < 1e-9, "EMA 0.2*200+0.8*100=120");

// ROP = avgDailyBurn(10) * ropDays(7) = 70. onHand+inTransit = 30 < 70 → 재주문
// 재주문량 = rop*2 - (onHand+inTransit) = 140 - 30 = 110
const plan = planInbound({ onHand: 20, inTransit: 10, avgDailyBurn: 10, ropDays: 7 });
assert.equal(plan?.qty, 110, "ROP 미달 시 재주문량");

// onHand+inTransit >= ROP → 발주 없음
assert.equal(planInbound({ onHand: 100, inTransit: 0, avgDailyBurn: 10, ropDays: 7 }), null, "충분하면 발주 없음");
// avgDailyBurn=0(소모 없음)이면 발주 없음
assert.equal(planInbound({ onHand: 0, inTransit: 0, avgDailyBurn: 0, ropDays: 7 }), null, "소모 없으면 발주 없음");

// 도착 정산: etaAt <= now 이고 아직 RECEIVED 아닌 PO만 입고
const now = new Date("2026-07-25T00:00:00Z");
const pos = [
  { _id: "po1", etaAt: new Date("2026-07-24T00:00:00Z"), qty: 50, materialId: "GAS-001", status: "ORDERED" },
  { _id: "po2", etaAt: new Date("2026-07-26T00:00:00Z"), qty: 30, materialId: "GAS-001", status: "ORDERED" },
  { _id: "po3", etaAt: new Date("2026-07-20T00:00:00Z"), qty: 10, materialId: "CHM-002", status: "RECEIVED" },
];
const res = settleArrivals(pos, now);
assert.deepEqual(res.arrivedPoIds, ["po1"], "도착 대상은 po1만");
assert.equal(res.receipts[0].qty, 50, "입고 수량");

console.log("✅ twin inbound passed");
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx scripts/test-twin-inbound.ts`
Expected: FAIL — `Cannot find module '../src/lib/twin/inbound'`

- [ ] **Step 3: 구현** — `src/lib/twin/inbound.ts`

```ts
// 지수이동평균. prevEma가 0이면 첫 관측값을 그대로 채택한다.
export function updateBurnEma(prevEma: number, observedDailyBurn: number, alpha: number): number {
  if (prevEma <= 0) return observedDailyBurn;
  return alpha * observedDailyBurn + (1 - alpha) * prevEma;
}

// 현재고+입고중이 ROP 미만이면 rop*2까지 채우는 재주문량을 반환. 소모가 없으면 발주하지 않는다.
export function planInbound(input: {
  onHand: number; inTransit: number; avgDailyBurn: number; ropDays: number;
}): { qty: number } | null {
  if (input.avgDailyBurn <= 0) return null;
  const rop = input.avgDailyBurn * input.ropDays;
  const position = input.onHand + input.inTransit;
  if (position >= rop) return null;
  const qty = Math.ceil(rop * 2 - position);
  return qty > 0 ? { qty } : null;
}

export function settleArrivals(
  pos: { _id: string; etaAt: Date; qty: number; materialId: string; status: string }[],
  now: Date,
): { receipts: { poId: string; materialId: string; qty: number }[]; arrivedPoIds: string[] } {
  const receipts: { poId: string; materialId: string; qty: number }[] = [];
  const arrivedPoIds: string[] = [];
  for (const po of pos) {
    if (po.status === "RECEIVED") continue;
    if (po.etaAt.getTime() <= now.getTime()) {
      receipts.push({ poId: po._id, materialId: po.materialId, qty: po.qty });
      arrivedPoIds.push(po._id);
    }
  }
  return { receipts, arrivedPoIds };
}
```

- [ ] **Step 4: 테스트 통과 + 등록**

`package.json`에 `"test:twin-inbound": "tsx scripts/test-twin-inbound.ts",` 추가.
Run: `npx tsx scripts/test-twin-inbound.ts` → Expected: `✅ twin inbound passed`
Run: `npx tsc --noEmit` → Expected: 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add src/lib/twin/inbound.ts scripts/test-twin-inbound.ts package.json
git commit -m "feat: 트윈 입고 순수 함수(planInbound/settleArrivals/updateBurnEma)"
```

---

## Task 5: advanceAggregateWip 확장 — 스텝별 진행 웨이퍼 수 반환

**Files:**
- Modify: `src/lib/lot-route.ts:206-241`
- Test: `scripts/test-twin-advance-steps.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `WaferLotDoc`(`currentStepIndex?`, `waferQty?`), `collections().waferLots`.
- Produces (변경된 반환 타입):
  - `advanceAggregateWip(fabId, product): Promise<{ advanced: number; completed: number; advancedFromStepIndex: Record<number, number> }>`
  - `advancedFromStepIndex[stepIndex]` = 이번 tick에 그 stepIndex를 완료하고 넘어간 웨이퍼 수 합계(로트별 `waferQty ?? 25` 사용).

- [ ] **Step 1: 실패 테스트 작성** — `scripts/test-twin-advance-steps.ts`

```ts
import assert from "node:assert/strict";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { collections } from "../src/lib/db";
import { advanceAggregateWip } from "../src/lib/lot-route";

async function main() {
  const { waferLots } = await collections();
  // 과거 lastEventAt으로 즉시 진행 대상이 되는 AGGREGATE 테스트 로트 2개 삽입
  const old = new Date(Date.now() - 60_000);
  const ids = [randomUUID(), randomUUID()];
  await waferLots.insertMany([
    { _id: ids[0], fabId: "M20", product: "HBM", routeMasterId: "M20:HBM", foupCode: "FOUP-TEST-A",
      status: "IN_PROGRESS", cohort: "AGGREGATE", currentStepIndex: 0, waferQty: 25,
      createdBy: "test", createdAt: old, updatedAt: old, lastEventAt: old } as never,
    { _id: ids[1], fabId: "M20", product: "HBM", routeMasterId: "M20:HBM", foupCode: "FOUP-TEST-B",
      status: "IN_PROGRESS", cohort: "AGGREGATE", currentStepIndex: 0, waferQty: 25,
      createdBy: "test", createdAt: old, updatedAt: old, lastEventAt: old } as never,
  ]);
  try {
    const res = await advanceAggregateWip("M20", "HBM");
    assert.ok("advancedFromStepIndex" in res, "advancedFromStepIndex 반환");
    // 스텝0에서 최소 50웨이퍼(2로트×25) 진행이 집계에 포함
    assert.ok((res.advancedFromStepIndex[0] ?? 0) >= 50, "스텝0 진행 웨이퍼 집계");
  } finally {
    await waferLots.deleteMany({ _id: { $in: ids } });
  }
  console.log("✅ twin advance steps passed");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx scripts/test-twin-advance-steps.ts`
Expected: FAIL — `advancedFromStepIndex` 프로퍼티 없음

- [ ] **Step 3: 구현** — `src/lib/lot-route.ts`의 `advanceAggregateWip` 수정

반환 타입을 `{ advanced: number; completed: number; advancedFromStepIndex: Record<number, number> }`로 바꾸고, no-op/조기반환 3곳(207·211·214·220행의 `return { advanced: 0, completed: 0 }`)을 `return { advanced: 0, completed: 0, advancedFromStepIndex: {} }`로 교체. `due` 순회에서 stepIndex별 웨이퍼 수를 집계:

```ts
  const now = new Date();
  let completed = 0;
  const advancedFromStepIndex: Record<number, number> = {};
  const ops = due.map((lot) => {
    const fromStep = lot.currentStepIndex ?? 0;
    advancedFromStepIndex[fromStep] = (advancedFromStepIndex[fromStep] ?? 0) + (lot.waferQty ?? 25);
    const nextStep = fromStep + 1;
    const isDone = nextStep >= totalSteps;
    if (isDone) completed++;
    const nextNodeId = isDone ? visits[totalSteps - 1].nodeId : visits[nextStep].nodeId;
    return {
      updateOne: {
        filter: { _id: lot._id, lastEventAt: lot.lastEventAt },
        update: { $set: {
          currentStepIndex: isDone ? totalSteps : nextStep, currentNodeId: nextNodeId,
          lastEventAt: now, updatedAt: now, status: isDone ? "DONE" as const : "IN_PROGRESS" as const,
        } },
      },
    };
  });
  const result = await waferLots.bulkWrite(ops, { ordered: false });
  return { advanced: result.modifiedCount, completed, advancedFromStepIndex };
```

주: `advancedFromStepIndex`는 `due` 기준 집계로, 기존 `completed` 카운터와 동일하게 낙관적 write 실패를 무시하는 근사다(경합은 드묾, 동일 관례 유지).

- [ ] **Step 4: 호출부 회귀 확인** — `advanceAggregateWip`의 기존 호출부가 `advanced`/`completed`만 구조분해하는지 확인(추가 필드는 무해). grep:

Run: `grep -rn "advanceAggregateWip" src/ scripts/`
호출부가 반환 객체를 통째로 넘기거나 새 필드에 의존하지 않으면 수정 불필요.

- [ ] **Step 5: 테스트 통과 + 등록**

`package.json`에 `"test:twin-advance-steps": "tsx scripts/test-twin-advance-steps.ts",` 추가.
Run: `npx tsx scripts/test-twin-advance-steps.ts` → Expected: `✅ twin advance steps passed`
Run: `npx tsc --noEmit` → Expected: 에러 없음
Run: `npm run test:aggregate-wip-read-only` → Expected: 통과(회귀)

- [ ] **Step 6: 커밋**

```bash
git add src/lib/lot-route.ts scripts/test-twin-advance-steps.ts package.json
git commit -m "feat: advanceAggregateWip이 스텝별 진행 웨이퍼 수 반환"
```

---

## Task 6: 트윈 상태 & 락 (state.ts) + 클램프 소모 헬퍼

**Files:**
- Create: `src/lib/twin/state.ts`
- Modify: `src/lib/inventory-projection.ts` (burnInventoryProjection 추가)
- Test: `scripts/test-twin-state.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `TwinEngineStateDoc`, `collections().twinEngineState`, `collections().inventory`.
- Produces:
  - `export async function getOrInitTwinState(): Promise<TwinEngineStateDoc>`
  - `export async function acquireTwinLock(owner: string, ttlMs: number): Promise<boolean>`
  - `export async function releaseTwinLock(owner: string): Promise<void>`
  - `export async function ensureTwinIndexes(): Promise<void>`
  - `inventory-projection.ts`: `export async function burnInventoryProjection({ materialId, warehouseId, quantity, session }): Promise<{ burned: number; shortfall: number }>` — 가능한 만큼만 차감하고 부족분 반환(throw 안 함).

- [ ] **Step 1: 실패 테스트 작성** — `scripts/test-twin-state.ts`

```ts
import assert from "node:assert/strict";
import "dotenv/config";
import { getOrInitTwinState, acquireTwinLock, releaseTwinLock } from "../src/lib/twin/state";

async function main() {
  const state = await getOrInitTwinState();
  assert.equal(state._id, "singleton", "싱글턴 상태");
  assert.ok(state.tickIntervalMs > 0, "tick 간격 기본값");
  assert.equal(state.speedMultiplier, 1, "배속 기본 1");

  const a = await acquireTwinLock("owner-A", 10_000);
  assert.equal(a, true, "첫 락 획득 성공");
  const b = await acquireTwinLock("owner-B", 10_000);
  assert.equal(b, false, "락 점유 중 재획득 실패");
  await releaseTwinLock("owner-A");
  const c = await acquireTwinLock("owner-B", 10_000);
  assert.equal(c, true, "해제 후 획득 성공");
  await releaseTwinLock("owner-B");
  console.log("✅ twin state passed");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx scripts/test-twin-state.ts`
Expected: FAIL — `Cannot find module '../src/lib/twin/state'`

- [ ] **Step 3: 구현** — `src/lib/twin/state.ts`

```ts
import "server-only";
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
    speedMultiplier: 1,
    lockedBy: null,
    lockExpiresAt: null,
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
  const { twinPurchaseOrders, twinBurnEvents } = await collections();
  await twinPurchaseOrders.createIndex({ status: 1, etaAt: 1 });
  await twinBurnEvents.createIndex({ materialId: 1, tickAt: -1 });
}
```

- [ ] **Step 4: 클램프 소모 헬퍼 추가** — `src/lib/inventory-projection.ts` 하단에:

```ts
// 창고 재고를 가능한 만큼만 차감하고 부족분을 반환한다(throw 안 함) — 트윈 소모 전용.
export async function burnInventoryProjection({ materialId, warehouseId, quantity, session }: Adjustment): Promise<{ burned: number; shortfall: number }> {
  const { inventory } = await collections();
  const doc = await inventory.findOne({ materialId, warehouseId }, { session });
  const onHand = doc?.quantity ?? 0;
  const burned = Math.min(onHand, quantity);
  const shortfall = quantity - burned;
  if (burned > 0) {
    await inventory.updateOne({ materialId, warehouseId }, { $inc: { quantity: -burned } }, { session });
  }
  return { burned, shortfall };
}
```

`Adjustment` 타입(6행)에 `session`이 이미 있으나 twin 호출은 세션 없이 쓸 수 있어야 하므로 `session`을 optional로 완화: `type Adjustment = { materialId: string; warehouseId: string; quantity: number; session?: ClientSession };`. 기존 두 함수의 `{ session }` 전달은 optional이어도 동작(undefined 허용).

- [ ] **Step 5: 테스트 통과 + 등록**

`package.json`에 `"test:twin-state": "tsx scripts/test-twin-state.ts",` 추가.
Run: `npx tsx scripts/test-twin-state.ts` → Expected: `✅ twin state passed`
Run: `npx tsc --noEmit` → Expected: 에러 없음
Run: `npm run test:inventory-policy` → Expected: 통과(inventory-projection 회귀)

- [ ] **Step 6: 커밋**

```bash
git add src/lib/twin/state.ts src/lib/inventory-projection.ts scripts/test-twin-state.ts package.json
git commit -m "feat: 트윈 엔진 상태/락/인덱스 + 클램프 소모 헬퍼"
```

---

## Task 7: executeTwinTick 오케스트레이션 (engine.ts)

**Files:**
- Create: `src/lib/twin/engine.ts`
- Test: `scripts/test-twin-engine.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `advanceAggregateWip`(Task 5), `buildStepConsumption`/`computeBurn`(Task 3), `planInbound`/`settleArrivals`/`updateBurnEma`(Task 4), `getBaseLeadTime`(Task 1), `getOrInitTwinState`/`acquireTwinLock`/`releaseTwinLock`(Task 6), `burnInventoryProjection`/`increaseInventoryProjection`(inventory-projection), `M20_MATERIAL_CONSUMPTION`(material-consumption), `getRouteMaster`/`expandRouteMaster`(route-master).
- Produces:
  - `export type TwinTickResult = { advanced: number; burnedByMaterial: Record<string, number>; shortfalls: Record<string, number>; newPOs: number; receipts: number; skipped?: "PAUSED" | "LOCKED" }`
  - `export async function executeTwinTick(now?: Date): Promise<TwinTickResult>`

- [ ] **Step 1: 실패 테스트 작성** — `scripts/test-twin-engine.ts`

```ts
import assert from "node:assert/strict";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { collections } from "../src/lib/db";
import { executeTwinTick } from "../src/lib/twin/engine";
import { getOrInitTwinState } from "../src/lib/twin/state";
import { getRouteMaster, expandRouteMaster } from "../src/lib/route-master";
import { buildStepConsumption } from "../src/lib/twin/burn";
import { M20_MATERIAL_CONSUMPTION } from "../src/lib/material-consumption";

async function main() {
  const { waferLots, twinEngineState, inventory, twinPurchaseOrders, twinBurnEvents } = await collections();

  // 라우트에서 "실제로 자재를 소모하는 첫 스텝"과 그 자재를 결정적으로 찾는다
  const rm = await getRouteMaster("M20", "HBM");
  assert.ok(rm, "M20 라우트 마스터 존재");
  const visits = expandRouteMaster(rm!);
  const sc = buildStepConsumption(visits, [...M20_MATERIAL_CONSUMPTION]);
  const firstEntry = [...sc.entries()].sort((a, b) => a[0] - b[0])[0];
  assert.ok(firstEntry, "소모 스텝이 최소 1개 존재");
  const targetStep = firstEntry[0];
  const targetMaterial = firstEntry[1][0].materialId;

  // 엔진 RUNNING + lastTickAt을 하루 전으로(Δt=1일) 세팅
  await getOrInitTwinState();
  const dayAgo = new Date(Date.now() - 86_400_000);
  await twinEngineState.updateOne({ _id: "singleton" },
    { $set: { status: "RUNNING", lastTickAt: dayAgo, lockedBy: null, lockExpiresAt: null } });

  // targetStep에 놓인 AGGREGATE 테스트 로트 삽입(진행 시 targetMaterial 소모)
  const old = new Date(Date.now() - 60_000);
  const lotId = randomUUID();
  await waferLots.insertOne({ _id: lotId, fabId: "M20", product: "HBM", routeMasterId: "M20:HBM",
    foupCode: "FOUP-TWIN-TEST", status: "IN_PROGRESS", cohort: "AGGREGATE",
    currentStepIndex: targetStep, waferQty: 25, createdBy: "test", createdAt: old, updatedAt: old, lastEventAt: old } as never);

  // targetMaterial 재고를 천문학적으로 세팅 → resolveWarehouse가 이 창고를 반드시 선택
  const invId = `${targetMaterial}__WH-TWINTEST`;
  await inventory.updateOne({ _id: invId },
    { $set: { materialId: targetMaterial, warehouseId: "WH-TWINTEST", quantity: 1e12, avgDailyUsage: 0, avgDailyBurn: 0, status: "AVAILABLE" } },
    { upsert: true });
  const before = (await inventory.findOne({ _id: invId }))!.quantity;

  const res = await executeTwinTick(new Date());
  assert.ok(res.advanced >= 1, "AGGREGATE 로트가 진행됨");
  assert.ok((res.burnedByMaterial[targetMaterial] ?? 0) > 0, "targetMaterial이 소모됨");
  const after = (await inventory.findOne({ _id: invId }))!.quantity;
  assert.ok(after < before, "소모로 창고 재고가 감소");

  // 정리
  await waferLots.deleteMany({ _id: lotId });
  await inventory.deleteMany({ _id: invId });
  await twinPurchaseOrders.deleteMany({ materialId: targetMaterial, orderedAt: { $gte: old } });
  await twinBurnEvents.deleteMany({ materialId: targetMaterial, tickAt: { $gte: old } });
  console.log("✅ twin engine tick passed");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx scripts/test-twin-engine.ts`
Expected: FAIL — `Cannot find module '../src/lib/twin/engine'`

- [ ] **Step 3: 구현** — `src/lib/twin/engine.ts`

```ts
import "server-only";
import { randomUUID } from "crypto";
import { collections } from "@/lib/db";
import { advanceAggregateWip } from "@/lib/lot-route";
import { getRouteMaster, expandRouteMaster } from "@/lib/route-master";
import { M20_MATERIAL_CONSUMPTION } from "@/lib/material-consumption";
import { buildStepConsumption, computeBurn, type StepConsumption } from "@/lib/twin/burn";
import { planInbound, settleArrivals, updateBurnEma } from "@/lib/twin/inbound";
import { getBaseLeadTime } from "@/lib/twin/lead-time";
import { getOrInitTwinState, acquireTwinLock, releaseTwinLock } from "@/lib/twin/state";
import { burnInventoryProjection, increaseInventoryProjection } from "@/lib/inventory-projection";

const LOCK_TTL_MS = 30_000;
const EMA_ALPHA = 0.2;
const MAX_DT_DAYS = 3; // 오래 멈췄다 재개 시 catch-up 폭주 방지

export type TwinTickResult = {
  advanced: number;
  burnedByMaterial: Record<string, number>;
  shortfalls: Record<string, number>;
  newPOs: number;
  receipts: number;
  skipped?: "PAUSED" | "LOCKED";
};

let cachedStepConsumption: StepConsumption | null = null;
async function getStepConsumption(): Promise<StepConsumption> {
  if (cachedStepConsumption) return cachedStepConsumption;
  const routeMaster = await getRouteMaster("M20", "HBM");
  if (!routeMaster) return new Map();
  const visits = expandRouteMaster(routeMaster);
  cachedStepConsumption = buildStepConsumption(visits, [...M20_MATERIAL_CONSUMPTION]);
  return cachedStepConsumption;
}

// 자재의 대표 창고: 재고가 가장 많은 inventory 문서의 warehouseId.
async function resolveWarehouse(materialId: string): Promise<string | null> {
  const { inventory } = await collections();
  const doc = await inventory.find({ materialId }).sort({ quantity: -1 }).limit(1).next();
  return doc?.warehouseId ?? null;
}

export async function executeTwinTick(now: Date = new Date()): Promise<TwinTickResult> {
  const empty: TwinTickResult = { advanced: 0, burnedByMaterial: {}, shortfalls: {}, newPOs: 0, receipts: 0 };
  const state = await getOrInitTwinState();
  if (state.status !== "RUNNING") return { ...empty, skipped: "PAUSED" };

  const owner = randomUUID();
  if (!(await acquireTwinLock(owner, LOCK_TTL_MS))) return { ...empty, skipped: "LOCKED" };

  try {
    const { inventory, materials, twinPurchaseOrders, twinBurnEvents } = await collections();
    const dtDays = Math.min(MAX_DT_DAYS, Math.max(1e-6, (now.getTime() - state.lastTickAt.getTime()) / 86_400_000));

    // ① WIP 진행 → ② 소모 계산
    const adv = await advanceAggregateWip("M20", "HBM");
    const stepConsumption = await getStepConsumption();
    const burn = computeBurn(adv.advancedFromStepIndex, stepConsumption);

    const burnedByMaterial: Record<string, number> = {};
    const shortfalls: Record<string, number> = {};
    for (const [materialId, qty] of burn) {
      if (qty <= 0) continue;
      const warehouseId = await resolveWarehouse(materialId);
      if (!warehouseId) continue;
      const { burned, shortfall } = await burnInventoryProjection({ materialId, warehouseId, quantity: qty });
      burnedByMaterial[materialId] = burned;
      if (shortfall > 0) shortfalls[materialId] = shortfall;

      // 실측 일일 소모율 EMA 갱신
      const inv = await inventory.findOne({ materialId, warehouseId });
      const observedDaily = burned / dtDays;
      const nextEma = updateBurnEma(inv?.avgDailyBurn ?? 0, observedDaily, EMA_ALPHA);
      await inventory.updateOne({ materialId, warehouseId }, { $set: { avgDailyBurn: nextEma } });

      await twinBurnEvents.insertOne({ _id: randomUUID(), tickAt: now, materialId, burnedQty: burned, shortfallQty: shortfall });
    }

    // ③ 입고: 소모가 잡힌 자재에 대해 ROP 점검·발주, 도착 정산
    let newPOs = 0;
    let receipts = 0;
    const materialIds = Object.keys(burnedByMaterial);
    for (const materialId of materialIds) {
      const warehouseId = await resolveWarehouse(materialId);
      if (!warehouseId) continue;
      const inv = await inventory.findOne({ materialId, warehouseId });
      const mat = await materials.findOne({ _id: materialId });
      if (!inv || !mat) continue;

      const openPOs = await twinPurchaseOrders.find({ materialId, status: { $ne: "RECEIVED" } }).toArray();
      const inTransit = openPOs.reduce((s, po) => s + po.qty, 0);
      const plan = planInbound({ onHand: inv.quantity, inTransit, avgDailyBurn: inv.avgDailyBurn ?? 0, ropDays: mat.ropDays });
      if (plan) {
        const leadTimeDays = getBaseLeadTime(mat.category);
        await twinPurchaseOrders.insertOne({
          _id: randomUUID(), materialId, qty: plan.qty, orderedAt: now,
          etaAt: new Date(now.getTime() + leadTimeDays * 86_400_000), leadTimeDays, status: "ORDERED",
        });
        newPOs++;
      }

      const arrivals = settleArrivals(openPOs, now);
      for (const r of arrivals.receipts) {
        await increaseInventoryProjection({ materialId: r.materialId, warehouseId, quantity: r.qty });
        receipts++;
      }
      if (arrivals.arrivedPoIds.length > 0) {
        await twinPurchaseOrders.updateMany({ _id: { $in: arrivals.arrivedPoIds } }, { $set: { status: "RECEIVED" } });
      }
    }

    const { twinEngineState } = await collections();
    await twinEngineState.updateOne({ _id: "singleton" }, { $set: { lastTickAt: now } });
    return { advanced: adv.advanced, burnedByMaterial, shortfalls, newPOs, receipts };
  } finally {
    await releaseTwinLock(owner);
  }
}
```

주: 락이 tick 간 상호배제를 보장하므로 자재별 `$inc`는 개별 원자성으로 충분하다(전역 트랜잭션 불필요). `increaseInventoryProjection`/`burnInventoryProjection`는 session 없이 호출(Task 6에서 optional로 완화됨).

- [ ] **Step 4: 테스트 통과 + 등록**

`package.json`에 `"test:twin-engine": "tsx scripts/test-twin-engine.ts",` 추가.
Run: `npx tsx scripts/test-twin-engine.ts` → Expected: `✅ twin engine tick passed`
Run: `npx tsc --noEmit` → Expected: 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add src/lib/twin/engine.ts scripts/test-twin-engine.ts package.json
git commit -m "feat: executeTwinTick — WIP진행→소모→입고 오케스트레이션"
```

---

## Task 8: 서버 스케줄러 (instrumentation.ts + scheduler.ts)

**Files:**
- Create: `src/lib/twin/scheduler.ts`
- Create: `src/instrumentation.ts`
- Test: 수동 검증(개발 서버 로그)

**Interfaces:**
- Consumes: `executeTwinTick`(Task 7), `getOrInitTwinState`/`ensureTwinIndexes`(Task 6).
- Produces: `export function startTwinScheduler(): void` — 프로세스당 1회만 `setInterval` 기동(중복 가드).

- [ ] **Step 1: 구현** — `src/lib/twin/scheduler.ts` (이 태스크는 부팅 부작용/타이머라 순수 단위테스트 대신 수동 검증한다)

```ts
import "server-only";
import { executeTwinTick } from "@/lib/twin/engine";
import { getOrInitTwinState, ensureTwinIndexes } from "@/lib/twin/state";

let started = false;

export function startTwinScheduler(): void {
  if (started) return;
  started = true;

  void (async () => {
    await ensureTwinIndexes();
    const state = await getOrInitTwinState();
    const interval = state.tickIntervalMs;
    setInterval(() => {
      executeTwinTick().catch((err) => console.error("[twin] tick 실패:", err));
    }, interval);
    console.log(`[twin] 스케줄러 기동: ${interval}ms 간격`);
  })().catch((err) => console.error("[twin] 스케줄러 초기화 실패:", err));
}
```

- [ ] **Step 2: 구현** — `src/instrumentation.ts`

```ts
// Next.js 부팅 시 1회 실행되는 서버 인스트루멘테이션 훅.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startTwinScheduler } = await import("@/lib/twin/scheduler");
  startTwinScheduler();
}
```

- [ ] **Step 3: 수동 검증**

Run: `npm run dev`
개발 서버 로그에 `[twin] 스케줄러 기동: 5000ms 간격`이 뜨는지 확인.
엔진 상태는 기본 PAUSED이므로 tick은 no-op(로그 조용) — 정상. Task 9의 POST start 후 동작 확인.
Run: `npx tsc --noEmit` → Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/lib/twin/scheduler.ts src/instrumentation.ts
git commit -m "feat: instrumentation 훅에서 트윈 스케줄러 기동"
```

---

## Task 9: API 라우트 (GET 상태/현황, POST start/pause)

**Files:**
- Create: `src/app/api/twin/engine/route.ts`
- Test: `scripts/test-twin-api.ts` (또는 수동 curl)
- Modify: `package.json`

**Interfaces:**
- Consumes: `getOrInitTwinState`(Task 6), `collections()`.
- Produces:
  - `GET /api/twin/engine` → `{ status, lastTickAt, materials: { materialId, onHand, avgDailyBurn, ropDays, rop, inTransit: { poId, qty, etaAt }[], recentBurn }[] }`
  - `POST /api/twin/engine` body `{ action: "start" | "pause" }` → `{ ok: true, status }`

- [ ] **Step 1: 실패 테스트 작성** — `scripts/test-twin-api.ts` (개발 서버 기동 상태에서 실행)

```ts
import assert from "node:assert/strict";

async function main() {
  const base = "http://localhost:3000/api/twin/engine";
  // start
  const post = await fetch(base, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "start" }) });
  assert.equal(post.status, 200, "POST start 200");
  const posted = await post.json();
  assert.equal(posted.status, "RUNNING", "start 후 RUNNING");
  // get
  const get = await fetch(base);
  assert.equal(get.status, 200, "GET 200");
  const data = await get.json();
  assert.ok(Array.isArray(data.materials), "materials 배열 반환");
  console.log("✅ twin api passed");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 실패 확인**

개발 서버(`npm run dev`) 켠 상태에서 Run: `npx tsx scripts/test-twin-api.ts`
Expected: FAIL — 404(라우트 없음)

- [ ] **Step 3: 구현** — `src/app/api/twin/engine/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { getOrInitTwinState } from "@/lib/twin/state";
import { M20_MATERIAL_CONSUMPTION } from "@/lib/material-consumption";

export async function GET() {
  const state = await getOrInitTwinState();
  const { inventory, materials, twinPurchaseOrders, twinBurnEvents } = await collections();

  const materialIds = [...new Set(M20_MATERIAL_CONSUMPTION.map((r) => r.materialId))];
  const rows = await Promise.all(materialIds.map(async (materialId) => {
    const inv = await inventory.find({ materialId }).sort({ quantity: -1 }).limit(1).next();
    const mat = await materials.findOne({ _id: materialId });
    const openPOs = await twinPurchaseOrders.find({ materialId, status: { $ne: "RECEIVED" } }).toArray();
    const recent = await twinBurnEvents.find({ materialId }).sort({ tickAt: -1 }).limit(1).next();
    const avgDailyBurn = inv?.avgDailyBurn ?? 0;
    const ropDays = mat?.ropDays ?? 0;
    return {
      materialId,
      onHand: inv?.quantity ?? 0,
      avgDailyBurn,
      ropDays,
      rop: avgDailyBurn * ropDays,
      inTransit: openPOs.map((po) => ({ poId: po._id, qty: po.qty, etaAt: po.etaAt })),
      recentBurn: recent?.burnedQty ?? 0,
    };
  }));

  return NextResponse.json({ status: state.status, lastTickAt: state.lastTickAt, materials: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { action?: "start" | "pause" };
  if (body.action !== "start" && body.action !== "pause") {
    return NextResponse.json({ error: "action은 start|pause" }, { status: 400 });
  }
  await getOrInitTwinState();
  const { twinEngineState } = await collections();
  const status = body.action === "start" ? "RUNNING" : "PAUSED";
  await twinEngineState.updateOne({ _id: "singleton" }, { $set: { status } });
  return NextResponse.json({ ok: true, status });
}
```

- [ ] **Step 4: 테스트 통과 + 등록**

`package.json`에 `"test:twin-api": "tsx scripts/test-twin-api.ts",` 추가.
개발 서버 켠 상태에서 Run: `npx tsx scripts/test-twin-api.ts` → Expected: `✅ twin api passed`
Run: `npx tsc --noEmit` → Expected: 에러 없음

- [ ] **Step 5: 엔진 실동작 확인** — API로 start 후, 개발 서버 로그에서 tick이 실제 소모를 만드는지 관찰. AGGREGATE 로트가 있어야 소모 발생(없으면 `npm run test:m20-foup-wip` 등으로 시딩된 상태에서 확인).

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/twin/engine/route.ts scripts/test-twin-api.ts package.json
git commit -m "feat: 트윈 엔진 API(GET 자재현황 / POST start·pause)"
```

---

## Task 10: 자재별 실시간 현황 UI 패널

**Files:**
- Create: `src/app/(dashboard)/usage/TwinEnginePanel.tsx`
- Modify: `src/app/(dashboard)/usage/page.tsx` (패널 삽입)
- Test: 수동(브라우저 + Playwright 스냅샷)

**Interfaces:**
- Consumes: `GET /api/twin/engine` 응답 형태(Task 9).

- [ ] **Step 1: 구현** — `src/app/(dashboard)/usage/TwinEnginePanel.tsx`

```tsx
"use client";
import { useEffect, useState } from "react";

type MaterialRow = {
  materialId: string; onHand: number; avgDailyBurn: number; ropDays: number; rop: number;
  inTransit: { poId: string; qty: number; etaAt: string }[]; recentBurn: number;
};
type EngineData = { status: "RUNNING" | "PAUSED"; lastTickAt: string; materials: MaterialRow[] };

export function TwinEnginePanel() {
  const [data, setData] = useState<EngineData | null>(null);

  async function refresh() {
    const res = await fetch("/api/twin/engine");
    if (res.ok) setData(await res.json());
  }
  async function toggle(action: "start" | "pause") {
    await fetch("/api/twin/engine", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }) });
    refresh();
  }
  useEffect(() => { refresh(); const t = setInterval(refresh, 5_000); return () => clearInterval(t); }, []);

  if (!data) return <div className="rounded-lg border p-4 text-sm text-gray-500">트윈 엔진 로딩…</div>;

  return (
    <section className="rounded-lg border p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">트윈 물리 엔진 · 자재 실시간 현황</h2>
        <button
          onClick={() => toggle(data.status === "RUNNING" ? "pause" : "start")}
          className={`rounded px-3 py-1 text-sm ${data.status === "RUNNING" ? "bg-emerald-600 text-white" : "bg-gray-300"}`}
        >
          {data.status === "RUNNING" ? "● 가동 중 (일시정지)" : "▷ 시작"}
        </button>
      </header>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.materials.map((m) => {
          const low = m.rop > 0 && m.onHand < m.rop;
          return (
            <div key={m.materialId} className={`rounded border p-3 text-sm ${low ? "border-amber-400 bg-amber-50" : ""}`}>
              <div className="flex justify-between font-medium">
                <span>{m.materialId}</span>
                <span className={low ? "text-amber-700" : ""}>{Math.round(m.onHand).toLocaleString()}</span>
              </div>
              <div className="mt-1 text-xs text-gray-600">
                소모 {m.avgDailyBurn.toFixed(1)}/일 · ROP {Math.round(m.rop).toLocaleString()}
              </div>
              {m.inTransit.length > 0 && (
                <div className="mt-1 text-xs text-blue-700">
                  입고 중: {m.inTransit.map((po) => `${Math.round(po.qty).toLocaleString()} (ETA ${new Date(po.etaAt).toLocaleDateString()})`).join(", ")}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: 페이지 삽입** — `src/app/(dashboard)/usage/page.tsx` 상단에 import 추가하고 렌더 트리 적절한 위치(기존 최상위 섹션 인근)에 `<TwinEnginePanel />` 삽입. 서버 컴포넌트면 client 컴포넌트 삽입은 그대로 가능.

```tsx
import { TwinEnginePanel } from "./TwinEnginePanel";
// ...JSX 상단:
<TwinEnginePanel />
```

- [ ] **Step 3: 수동/스냅샷 검증**

Run: `npm run dev` 후 브라우저 `http://localhost:3000/usage` 접속 → 패널이 보이고 "시작" 클릭 시 status RUNNING 전환, 자재 카드에 소모율/입고 배지가 갱신되는지 확인.
(선택) Playwright MCP로 `/usage` 스냅샷 + 스크린샷 확인.
Run: `npx tsc --noEmit` → Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add "src/app/(dashboard)/usage/TwinEnginePanel.tsx" "src/app/(dashboard)/usage/page.tsx"
git commit -m "feat: 트윈 자재 실시간 소모/입고 현황 패널"
```

---

## 최종 검증

- [ ] 전체 트윈 테스트 스위트:

```bash
npm run test:twin-lead-time && npm run test:twin-burn && npm run test:twin-inbound \
  && npm run test:twin-advance-steps && npm run test:twin-state && npm run test:twin-engine
```

- [ ] 회귀:

```bash
npm run test:fab-scenario && npm run test:aggregate-wip-read-only && npm run test:inventory-policy && npm run test:material-consumption
```

- [ ] `npx tsc --noEmit` 통과
- [ ] 개발 서버에서 엔진 start → 창고 재고가 실제로 감소하고, ROP 미달 자재에 PO가 생기며, ETA 지난 PO가 입고로 재고를 늘리는 end-to-end 흐름 육안 확인(superpowers:verification-before-completion).

## 범위 밖 (YAGNI)

- 배속(speedMultiplier > 1) 실동작 — 필드만 존재.
- M21/M22 — 엔진은 M20/HBM 외 no-op.
- 3D 트윈 소진 히트맵, 보충 제안 승인 큐(엑스 C/D 안) — 별도 라운드.
- 개별 웨이퍼 계보 — FOUP/집계 단위로 충분.
- `twinBurnEvents` TTL/정리 — 데이터가 쌓이면 후속 태스크.
