# 운영 트렌드 대시보드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설계 기준선 대비 운영 편차를 운영일 축으로 매일 추적하는 시계열 화면을 만들고, 그 그래프가 맞는 숫자를 그리도록 24배속 정합성 위반 5건을 먼저 고친다.

**Architecture:** 엔진 tick이 운영일 경계를 넘을 때 4축(생산·자재·창고·출하) 집계를 `twinDailySnapshots`에 한 문서로 적재한다. 별도 스케줄러를 만들지 않는다 — 운영시계를 들고 있는 tick이 유일하게 옳은 위치다(RULES.md "기능별 독자 시계 금지"). 화면은 그 컬렉션만 읽고, 차트는 의존성 없이 인라인 SVG로 그린다.

**Tech Stack:** Next.js 16 (App Router) · React 19 · MongoDB 네이티브 드라이버 · TypeScript · tsx + `node:assert/strict` 테스트

## Global Constraints

- **운영시계 단일화**: 모든 모델 시간은 `src/lib/twin/operating-clock.ts`의 공통 시계를 쓴다. 기능별 독자 시계·제품별 임의 배속·tick 횟수 기반 시간 진행 금지 (RULES.md § Twin 운영시간).
- **배속은 24×**: `OPERATING_SPEED_MULTIPLIER = 24`. 실제 1시간 = 운영 1일.
- **벽시계와 운영시간 구분**: 운영시간 필드는 `operating*` 접두, 벽시계 사실 기록은 `recordedAt`/`createdAt`/`tickAt` 계열. 필드명·API·화면 표기에서 섞지 않는다.
- **DB 스크립트 실행**: `npx dotenv-cli -e .env -- npx tsx scripts/<file>.ts`. `DATABASE_URL`을 명령줄에 직접 쓰지 않는다.
- **서브에이전트 금지**: 사용자가 명시적으로 지정하지 않는 한 크리·패브·엑스 등 서브에이전트를 호출하지 않는다 (RULES.md § 서브에이전트).
- **차트 라이브러리 추가 금지**: 인라인 SVG로만 그린다. `package.json` dependencies를 늘리지 않는다.
- **다크모드 없음**: 앱은 라이트 테마 고정.
- **계열 색은 엔티티 고정**: HBM `#0078D4` · DRAM `#B5179E` · NAND `#0E9B8A`. 상태색 `#EA002C`/`#F7A600`/`#00B96B`는 예약이며 계열 색으로 재사용 금지.
- **Next.js 작성 전 확인**: `node_modules/next/dist/docs/`의 관련 가이드를 읽고 폐기 예정 안내를 준수한다 (RULES.md § Next.js).

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/twin/operating-clock.ts` (수정) | 운영일·운영월 변환 추가 |
| `src/lib/twin/daily-snapshot.ts` (신규) | 스냅샷 순수 빌더 — DB 접근 없음 |
| `src/lib/db.ts` (수정) | `TwinDailySnapshotDoc`, 컬렉션 등록, 이벤트 운영시각 필드 |
| `src/lib/twin/engine.ts` (수정) | 이벤트에 운영시각 기록, 운영일 경계에서 스냅샷 적재 |
| `src/instrumentation.ts` (수정) | 스케줄러 독립 기동 (F5) |
| `src/app/api/customers/route.ts` (수정) | 이행률 집계 창 운영월화 (F1) |
| `src/lib/usage-twin-data.ts` (수정) | 사용량 실적 창 운영 30일화 (F2) |
| `src/lib/twin/state.ts`, `src/app/api/wafer-lots/node-density/route.ts`, `src/app/(dashboard)/usage/M20NodeDensityCard.tsx` (수정) | 배속 표기 (F3) |
| `scripts/approve-all-pending-pos.ts` (수정) | tick 기반 시간 제거 (F4) |
| `src/app/api/twin/trends/route.ts` (신규) | 스냅샷 조회 API |
| `src/app/(dashboard)/trends/chart-scale.ts` (신규) | 스케일·path 순수 함수 |
| `src/app/(dashboard)/trends/charts/*.tsx` (신규) | LineChart / BarChart / Sparkline |
| `src/app/(dashboard)/trends/TrendsClient.tsx` (신규) | 필터·4섹션 조립 |
| `src/app/(dashboard)/trends/page.tsx` (신규) | 서버 진입점 |
| `src/app/(dashboard)/layout.tsx` (수정) | 사이드바 메뉴 |

---

## Phase 1 — 24배속 정합성 선행 수정

### Task 1: 스케줄러 독립 기동 (F5)

엔진이 안 뜨면 스냅샷이 하나도 안 쌓이므로 가장 먼저 고친다.

**Files:**
- Modify: `src/instrumentation.ts`

**Interfaces:**
- Consumes: 없음
- Produces: 없음 (부팅 동작만 변경)

- [ ] **Step 1: 현재 코드 확인**

`src/instrumentation.ts`가 아래 형태인지 본다. 두 동적 import를 **모두 await한 뒤에야** 두 스케줄러를 부르는 게 문제다 — 두 번째 import가 던지면 트윈 스케줄러가 아예 시작되지 않는다.

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startTwinScheduler } = await import("@/lib/twin/scheduler");
  const { startInboundReceiptTaskScheduler } = await import("@/lib/inbound-receipt-task-scheduler");
  startTwinScheduler();
  startInboundReceiptTaskScheduler();
}
```

- [ ] **Step 2: 독립 기동으로 교체**

`register()` 전체를 아래로 바꾼다. 주석의 `startProductionExecutionScheduler` 제거 이력은 그대로 보존한다.

```ts
// Next.js 부팅 시 1회 실행되는 서버 인스트루멘테이션 훅.
//
// 각 스케줄러를 독립적으로 기동한다. 예전에는 두 동적 import를 모두 await한 뒤에 둘을 호출해서,
// 뒤쪽 import가 부팅 시 던지면 트윈 스케줄러가 **아예 시작되지 않았다** — 그리고 그 실패는
// 조용했다. 2026-08-12 22:35부터 08-18까지 132시간 동안 tick이 0회였던 사고의 유력한 경로다.
// 하나가 죽어도 나머지는 뜨고, 죽은 쪽은 이름과 함께 로그에 남는다.
async function startScheduler(name: string, start: () => Promise<() => void>): Promise<void> {
  try {
    const fn = await start();
    fn();
    console.log(`[instrumentation] ${name} 기동`);
  } catch (err) {
    console.error(`[instrumentation] ${name} 기동 실패 — 이 스케줄러 없이 계속 진행한다:`, err);
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // startProductionExecutionScheduler는 2026-08-12에 제거했다 — M21/M22 WIP을 굴리는 엔진이
  // twin(advanceStepBucketWip)과 이 스케줄러 둘로 갈라져 있었고, 화면(node-density)은 자재 소모·
  // 완제품 적립과 연결되지 않은 후자를 읽고 있었다(실측: M21 19,626 vs twin 17,173, M22 21,600 vs
  // 18,720). twin이 3제품 루프로 일반화(2026-08-09)되면서 역할이 중복됐는데 남아 있던 잔재다.
  // 정본은 twin 하나로 통일한다.
  await Promise.all([
    startScheduler("twin", async () => (await import("@/lib/twin/scheduler")).startTwinScheduler),
    startScheduler("inbound-receipt-task", async () => (await import("@/lib/inbound-receipt-task-scheduler")).startInboundReceiptTaskScheduler),
  ]);
}
```

- [ ] **Step 3: 타입 검사**

Run: `npm run typecheck 2>&1 | grep -v '^\.next/' | grep 'error TS'`
Expected: 출력 없음 (`.next/dev/types/`는 dev 서버가 동시 기록하는 생성 파일이라 제외한다)

- [ ] **Step 4: 실제 기동 확인**

Run:
```bash
pkill -f "next dev"; sleep 2
nohup npm run dev > /tmp/fab-dev.log 2>&1 &
sleep 15
grep -E "instrumentation|twin\] 스케줄러" /tmp/fab-dev.log
```
Expected: `[twin] 스케줄러 기동: 5000ms 간격(self-scheduling)` 과 `[instrumentation] twin 기동` 이 모두 보인다

- [ ] **Step 5: 커밋**

```bash
git add src/instrumentation.ts
git commit -m "fix(twin): 스케줄러를 독립 기동해 한쪽 실패가 엔진을 막지 않게"
```

---

### Task 2: 배속 표기 정정 (F3)

**Files:**
- Modify: `src/lib/db.ts` (`TwinEngineStateDoc.speedMultiplier` 제거)
- Modify: `src/lib/twin/state.ts:15`
- Modify: `src/app/api/wafer-lots/node-density/route.ts:131,199`
- Modify: `src/app/(dashboard)/usage/M20NodeDensityCard.tsx:35,119`
- Modify: `scripts/test-twin-state.ts:9`

**Interfaces:**
- Consumes: `OPERATING_SPEED_MULTIPLIER` from `src/lib/twin/operating-clock.ts`
- Produces: 없음

- [ ] **Step 1: 실패하는 테스트로 바꾼다**

`scripts/test-twin-state.ts:9`의 `assert.equal(state.speedMultiplier, 1, "배속 기본 1")` 줄을 지우고, 파일 끝의 `console.log` 직전에 아래를 넣는다.

```ts
// 사문화 필드 회귀 방지 — speedMultiplier는 운영시계가 읽지 않는데 화면이 "1×"로 표시하고
// 있었다(M20NodeDensityCard). 배속의 진실원은 OPERATING_SPEED_MULTIPLIER 하나다.
assert.equal(
  (state as Record<string, unknown>).speedMultiplier, undefined,
  "speedMultiplier는 twin state에 남아 있으면 안 된다",
);
```

- [ ] **Step 2: 실패 확인**

Run: `npx dotenv-cli -e .env -- npm run test:twin-state`
Expected: FAIL — `speedMultiplier는 twin state에 남아 있으면 안 된다` (실제값 `1`)

- [ ] **Step 3: 필드 제거**

`src/lib/db.ts`의 `TwinEngineStateDoc`에서 `speedMultiplier: number;` 줄을 삭제한다.

`src/lib/twin/state.ts`의 `initial` 객체에서 `speedMultiplier: 1,` 줄을 삭제한다.

- [ ] **Step 4: API·화면을 실제 배속으로 교체**

`src/app/api/wafer-lots/node-density/route.ts` 상단에 import를 추가한다.

```ts
import { OPERATING_SPEED_MULTIPLIER } from "@/lib/twin/operating-clock";
```

같은 파일 131행 타입의 `speedMultiplier: number;`는 그대로 두고(응답 계약 유지), 199행을 바꾼다.

```ts
          speedMultiplier: OPERATING_SPEED_MULTIPLIER,
```

`src/app/(dashboard)/usage/M20NodeDensityCard.tsx:119`의 표기를 명확히 한다.

```tsx
          <span>운영시간 {density.execution.speedMultiplier}× (실제 1시간 = 운영 1일)</span>
```

- [ ] **Step 5: 기존 DB 문서에서 필드 제거**

Create: `scripts/migrate-drop-speed-multiplier.ts`

```ts
import "dotenv/config";
import { collections, getMongoClient } from "../src/lib/db";

// speedMultiplier는 운영시계가 읽지 않는 사문화 필드였고, 화면은 그 값(1)을 배속으로 표시했다.
// 진실원은 OPERATING_SPEED_MULTIPLIER 하나다. 문서에서 지워 재유입 경로를 없앤다.
async function main() {
  const { twinEngineState } = await collections();
  const res = await twinEngineState.updateOne({ _id: "singleton" }, { $unset: { speedMultiplier: "" } });
  console.log(`speedMultiplier 제거: matched=${res.matchedCount} modified=${res.modifiedCount}`);
  await (await getMongoClient()).close();
}

main().catch(e => { console.error(e); process.exit(1); });
```

`package.json`의 `scripts`에 추가한다.

```json
    "db:drop-speed-multiplier": "tsx scripts/migrate-drop-speed-multiplier.ts",
```

Run: `npx dotenv-cli -e .env -- npm run db:drop-speed-multiplier`
Expected: `speedMultiplier 제거: matched=1 modified=1`

- [ ] **Step 6: 테스트 통과 확인**

Run: `npx dotenv-cli -e .env -- npm run test:twin-state && npm run typecheck 2>&1 | grep -v '^\.next/' | grep 'error TS'`
Expected: `✅` 출력 후 typecheck 오류 없음

- [ ] **Step 7: 커밋**

```bash
git add src/lib/db.ts src/lib/twin/state.ts src/app/api/wafer-lots/node-density/route.ts "src/app/(dashboard)/usage/M20NodeDensityCard.tsx" scripts/test-twin-state.ts scripts/migrate-drop-speed-multiplier.ts package.json
git commit -m "fix(twin): 화면 배속 표기를 실제 운영시계 24x로 정정"
```

---

### Task 3: tick 횟수 기반 시간 제거 (F4)

**Files:**
- Modify: `scripts/approve-all-pending-pos.ts`

**Interfaces:**
- Consumes: `operatingDaysToMs`, `OPERATING_SPEED_MULTIPLIER` from `src/lib/twin/operating-clock.ts`
- Produces: 없음

- [ ] **Step 1: 위반 확인**

`scripts/approve-all-pending-pos.ts:10-13`의 `simDaysPerTick(cycleDays, totalSteps)`는 RULES가 금지한 tick 횟수 기반 시간 진행이다. 이 값으로 `simMsPerDay`를 만들어 ETA를 계산하고 있다.

- [ ] **Step 2: 운영시계 기반으로 교체**

파일 상단 import에서 `getRouteMaster`, `expandRouteMaster`, `M20_CYCLE_DAYS`를 제거하고 운영시계를 넣는다.

```ts
import "dotenv/config";
import { collections } from "../src/lib/db";
import { getOrInitTwinState } from "../src/lib/twin/state";
import { operatingDaysToMs, OPERATING_SPEED_MULTIPLIER } from "../src/lib/twin/operating-clock";
```

`simDaysPerTick` 함수 전체를 삭제하고, `main()` 안의 route master·simDays·simMsPerDay 계산 블록을 지운다. ETA 계산은 `decideTwinPurchaseOrder`(`src/lib/twin/purchase-order-decision-server.ts:40-41`)와 같은 식을 쓴다.

```ts
async function main() {
  const { twinPurchaseOrders } = await collections();
  const pending = await twinPurchaseOrders.find({ status: "PENDING_APPROVAL" }).toArray();
  if (pending.length === 0) { console.log("승인 대기 발주가 없습니다."); return; }

  const state = await getOrInitTwinState();
  const operatingNowMs = state.operatingEpochMs ?? 0;

  let approved = 0;
  for (const po of pending) {
    const now = new Date();
    // 도착 판정 근거는 운영시각이다(§twin/inbound.ts settleArrivals). etaAt은 화면 표시용
    // 벽시계 환산이라 24로 나눈다 — 리드타임은 운영시간이기 때문이다.
    const etaOperatingMs = operatingNowMs + operatingDaysToMs(po.leadTimeDays);
    const etaAt = new Date(now.getTime() + operatingDaysToMs(po.leadTimeDays) / OPERATING_SPEED_MULTIPLIER);
    const result = await twinPurchaseOrders.updateOne(
```

이어지는 `updateOne`의 `$set`에 `etaOperatingMs`를 추가한다(기존 `etaAt` 옆).

```ts
      { $set: { status: "ORDERED", orderedAt: now, etaAt, etaOperatingMs, decidedAt: now, decidedBy: "SCRIPT:approve-all" } },
```

- [ ] **Step 3: tick 기반 잔재가 없는지 확인**

Run: `grep -rn "simDaysPerTick\|tickIntervalMs / " scripts src`
Expected: 출력 없음

- [ ] **Step 4: 타입 검사와 드라이 실행**

Run: `npm run typecheck 2>&1 | grep -v '^\.next/' | grep 'error TS'; npx dotenv-cli -e .env -- npx tsx scripts/approve-all-pending-pos.ts`
Expected: typecheck 오류 없음. 스크립트는 `승인 대기 발주가 없습니다.` 또는 승인 건수 출력 (둘 다 정상)

- [ ] **Step 5: 커밋**

```bash
git add scripts/approve-all-pending-pos.ts
git commit -m "fix(twin): approve-all-pending-pos의 tick 횟수 기반 시간을 운영시계로 교체"
```

---

### Task 4: 운영일·운영월 변환 함수 (F1·F2와 스냅샷의 공통 기반)

**Files:**
- Modify: `src/lib/twin/operating-clock.ts`
- Modify: `scripts/test-operating-clock.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `OPERATING_DAYS_PER_MONTH: number` (= 30)
  - `operatingDayOf(operatingEpochMs: number): number`
  - `operatingMonthOf(operatingEpochMs: number): number`
  - `operatingDaysCompletedBetween(prevOpMs: number, nextOpMs: number): number[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`scripts/test-operating-clock.ts` 하단의 `console.log(...)` 직전에 추가한다. import 목록에도 네 이름을 넣는다.

```ts
// ── 운영일·운영월 버킷 ────────────────────────────────────────────────────────
// 계약 월량(contractedMonthlyQty)은 운영 1개월치이고 자동출하도 운영일 기준으로 나간다.
// 집계 창이 벽시계 달력 월이면 분자에 운영 24개월치가 쌓인다(실측 2026-08-18: DRAM 6.5배).
assert.equal(OPERATING_DAYS_PER_MONTH, 30, "운영월은 30일 — auto-shipment.DAYS_PER_MONTH와 같다");

assert.equal(operatingDayOf(0), 0, "운영 0일차");
assert.equal(operatingDayOf(operatingDaysToMs(1) - 1), 0, "1일 직전은 아직 0일차");
assert.equal(operatingDayOf(operatingDaysToMs(1)), 1, "정확히 1일이면 1일차");
assert.equal(operatingDayOf(operatingDaysToMs(9.04)), 9, "9.04일차 → 9");
assert.equal(operatingDayOf(-1), 0, "음수는 0으로 막는다");

assert.equal(operatingMonthOf(0), 0, "운영 0개월차");
assert.equal(operatingMonthOf(operatingDaysToMs(29.99)), 0, "30일 직전은 0개월차");
assert.equal(operatingMonthOf(operatingDaysToMs(30)), 1, "30일이면 1개월차");
assert.equal(operatingMonthOf(operatingDaysToMs(719)), 23, "719일 → 23개월차");
assert.equal(operatingMonthOf(-1), 0, "음수는 0으로 막는다");

// 경계 통과 판정 — 이 tick에 "완료된" 운영일 목록. 스냅샷은 완료된 날만 확정한다.
assert.deepEqual(
  operatingDaysCompletedBetween(operatingDaysToMs(9.1), operatingDaysToMs(9.6)), [],
  "같은 운영일 안에서는 완료된 날이 없다",
);
assert.deepEqual(
  operatingDaysCompletedBetween(operatingDaysToMs(9.6), operatingDaysToMs(10.2)), [9],
  "9일차를 넘기면 9일차가 완료된다",
);
assert.deepEqual(
  operatingDaysCompletedBetween(operatingDaysToMs(9.6), operatingDaysToMs(12.1)), [9, 10, 11],
  "catch-up으로 여러 날을 건너뛰면 그 사이 날이 모두 완료된다",
);
assert.deepEqual(
  operatingDaysCompletedBetween(operatingDaysToMs(10.2), operatingDaysToMs(9.6)), [],
  "시각이 뒤로 가면 아무것도 완료되지 않는다",
);
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx scripts/test-operating-clock.ts`
Expected: FAIL — `OPERATING_DAYS_PER_MONTH is not defined` 계열 오류

- [ ] **Step 3: 최소 구현**

`src/lib/twin/operating-clock.ts` 끝에 추가한다.

```ts
/**
 * 운영 1개월의 일수. `auto-shipment.ts`의 `DAYS_PER_MONTH`와 같은 값이어야 한다 —
 * 자동출하가 `contractedMonthlyQty / DAYS_PER_MONTH × 운영일수`로 나가므로, 이행률 집계 창이
 * 다른 기준을 쓰면 분모와 분자의 축이 갈라진다.
 */
export const OPERATING_DAYS_PER_MONTH = 30;

/** 운영 절대일. 스냅샷의 키이자 트렌드 x축의 눈금이다. */
export function operatingDayOf(operatingEpochMs: number): number {
  return Math.max(0, Math.floor(operatingEpochMs / MS_PER_OPERATING_DAY));
}

/** 운영 절대월. 계약 이행률처럼 "월" 단위 약정을 집계할 때의 창이다. */
export function operatingMonthOf(operatingEpochMs: number): number {
  return Math.max(0, Math.floor(operatingDayOf(operatingEpochMs) / OPERATING_DAYS_PER_MONTH));
}

/**
 * prev → next 사이에 **완료된** 운영일 목록(오름차순).
 *
 * 진행 중인 날은 포함하지 않는다 — 하루가 끝나야 그 날의 집계가 확정되기 때문이다.
 * catch-up으로 여러 날을 건너뛴 경우 그 사이 날을 모두 돌려주므로, 호출자가 빠짐없이 적재할 수 있다.
 */
export function operatingDaysCompletedBetween(prevOpMs: number, nextOpMs: number): number[] {
  const from = operatingDayOf(prevOpMs);
  const to = operatingDayOf(nextOpMs);
  if (to <= from) return [];
  const days: number[] = [];
  for (let d = from; d < to; d++) days.push(d);
  return days;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx scripts/test-operating-clock.ts`
Expected: `✅` 로 끝나는 통과 출력

- [ ] **Step 5: 커밋**

```bash
git add src/lib/twin/operating-clock.ts scripts/test-operating-clock.ts
git commit -m "feat(twin): 운영일·운영월 버킷 변환 추가"
```

---

### Task 5: 이벤트에 운영시각 기록

스냅샷과 F1·F2가 모두 이 필드를 읽는다.

**Files:**
- Modify: `src/lib/db.ts` (`TwinBurnEventDoc`, `FinishedGoodsEventDoc`, `ShipmentDoc`)
- Modify: `src/lib/twin/engine.ts:317-320, 343-350, 387`

**Interfaces:**
- Consumes: `clock.operatingEpochMs` (engine tick 내 지역 변수)
- Produces: 세 이벤트 문서의 `operatingEpochMs?: number` 필드

- [ ] **Step 1: 문서 타입에 필드 추가**

`src/lib/db.ts`에서 세 인터페이스에 같은 필드를 넣는다. 옵셔널인 이유는 기존 문서에 없기 때문이다.

```ts
export interface TwinBurnEventDoc {
  _id: string;
  tickAt: Date;
  /** 운영시각(ms) — 트렌드 집계의 시간축. 없는 문서는 운영시계 도입 이전분이다. */
  operatingEpochMs?: number;
  materialId: string;
  burnedQty: number;
  shortfallQty: number;
}
```

```ts
export interface FinishedGoodsEventDoc {
  _id: string;
  fabId: FabId;
  product: Product;
  tickAt: Date;
  /** 운영시각(ms) — 트렌드 집계의 시간축. */
  operatingEpochMs?: number;
  addedQty: number;
  queuedQty: number;
}
```

`ShipmentDoc`에는 `shippedAt: Date;` 바로 아래에 넣는다.

```ts
  shippedAt: Date;
  /** 운영시각(ms) — 계약 이행률의 집계 창 근거. 계약 월량이 운영 1개월치이기 때문이다. */
  shippedOperatingMs?: number;
  shippedBy: string;
```

- [ ] **Step 2: 엔진의 세 삽입 지점에 값 기록**

`src/lib/twin/engine.ts:317` 완제품 적립:

```ts
        await finishedGoodsEvents.insertOne({
          _id: randomUUID(), fabId, product, tickAt: now,
          operatingEpochMs: clock.operatingEpochMs,
          addedQty: queue.releasedQuantity, queuedQty: newlyCompletedQuantity,
        });
```

`src/lib/twin/engine.ts:343` 자동출하:

```ts
          await shipments.insertOne({
            _id: randomUUID(), fabId, product,
            warehouseId: fgWarehouseId, customerId: alloc.customerId,
            quantity: alloc.qty, unit: finishedGoodsUnit(product),
            shippedAt: now,
            shippedOperatingMs: clock.operatingEpochMs,
            // 사람이 화면에서 낸 출하와 구분되도록 실행 주체를 남긴다.
            shippedBy: AUTO_SHIPMENT_ACTOR,
          });
```

`src/lib/twin/engine.ts:387` 소모 이벤트:

```ts
      await twinBurnEvents.insertOne({ _id: randomUUID(), tickAt: now, operatingEpochMs: clock.operatingEpochMs, materialId, burnedQty: burned, shortfallQty: shortfall });
```

- [ ] **Step 3: 사람이 낸 출하에도 기록**

사람 출하 경로는 `src/app/api/twin/shipments/route.ts:59`의 `shipments.insertOne(shipment)` 하나다. 그 위에서 `shipment` 객체를 만들 때 운영시각을 넣는다.

```ts
import { getOrInitTwinState } from "@/lib/twin/state";
```

```ts
  const twinState = await getOrInitTwinState();
  shipment.shippedOperatingMs = twinState.operatingEpochMs ?? 0;
  await shipments.insertOne(shipment);
```

이걸 빠뜨리면 사람 출하가 이행률 집계(Task 6)에서 통째로 빠진다.

- [ ] **Step 4: 타입 검사**

Run: `npm run typecheck 2>&1 | grep -v '^\.next/' | grep 'error TS'`
Expected: 출력 없음

- [ ] **Step 5: 실제 기록 확인**

dev 서버를 띄운 뒤 tick 두 번(약 100초)을 기다리고 확인한다.

Run:
```bash
cat > /tmp/verify-op.ts <<'EOF'
import "dotenv/config";
import { collections, getMongoClient } from "./src/lib/db";
async function main() {
  const { twinBurnEvents, shipments, finishedGoodsEvents } = await collections();
  for (const [name, col] of [["burn", twinBurnEvents], ["shipments", shipments], ["fgEvents", finishedGoodsEvents]] as const) {
    const withOp = await (col as any).countDocuments({ $or: [{ operatingEpochMs: { $exists: true } }, { shippedOperatingMs: { $exists: true } }] });
    console.log(`${name}: 운영시각 기록 ${withOp}건`);
  }
  await (await getMongoClient()).close();
}
main().catch(e => { console.error(e); process.exit(1); });
EOF
cp /tmp/verify-op.ts ./tmp-verify-op.ts && npx dotenv-cli -e .env -- npx tsx tmp-verify-op.ts; rm -f tmp-verify-op.ts
```
Expected: `burn` 이 1건 이상 (출하·완제품은 그 tick에 발생하지 않았으면 0일 수 있다)

- [ ] **Step 6: 커밋**

```bash
git add src/lib/db.ts src/lib/twin/engine.ts
git commit -m "feat(twin): 소모·출하·완제품 이벤트에 운영시각 기록"
```

---

### Task 6: 계약 이행률 집계 창 운영월화 (F1)

**Files:**
- Modify: `src/lib/customer-contracts.ts`
- Modify: `src/app/api/customers/route.ts:39-60`
- Create: `scripts/test-contract-fulfillment-window.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `operatingMonthOf`, `OPERATING_DAYS_PER_MONTH` (Task 4)
- Produces: `operatingMonthRange(operatingEpochMs: number): { startMs: number; endMs: number }` in `src/lib/customer-contracts.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Create: `scripts/test-contract-fulfillment-window.ts`

```ts
import assert from "node:assert/strict";
import { operatingMonthRange } from "../src/lib/customer-contracts";
import { operatingDaysToMs } from "../src/lib/twin/operating-clock";

// 자동출하는 운영시간 기준으로 나간다(auto-shipment: due = 월계약/30 × 운영일수).
// 집계 창이 벽시계 달력 월이면 분자에 운영 24개월치가 쌓이고 분모는 운영 1개월치다.
// 실측 2026-08-18: DRAM 6.5배 · NAND 6.4배 · HBM 3.8배 과대.
const r0 = operatingMonthRange(operatingDaysToMs(9.04));
assert.equal(r0.startMs, operatingDaysToMs(0), "9일차는 0개월차 창 — 시작은 운영 0일");
assert.equal(r0.endMs, operatingDaysToMs(30), "0개월차 창의 끝은 운영 30일");

const r1 = operatingMonthRange(operatingDaysToMs(30));
assert.equal(r1.startMs, operatingDaysToMs(30), "30일차부터 1개월차 창이 시작된다");
assert.equal(r1.endMs, operatingDaysToMs(60), "1개월차 창의 끝은 운영 60일");

const r2 = operatingMonthRange(operatingDaysToMs(719));
assert.equal(r2.startMs, operatingDaysToMs(690), "719일차는 23개월차 창");
assert.equal(r2.endMs, operatingDaysToMs(720), "23개월차 창의 끝은 720일");

// 창 폭은 항상 운영 30일이다 — 계약 월량과 같은 축.
for (const d of [0, 5.5, 29.9, 30, 100, 505]) {
  const r = operatingMonthRange(operatingDaysToMs(d));
  assert.equal(r.endMs - r.startMs, operatingDaysToMs(30), `운영 ${d}일차 창 폭은 30일`);
}

console.log("✅ contract fulfillment window passed");
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx scripts/test-contract-fulfillment-window.ts`
Expected: FAIL — `operatingMonthRange is not a function`

- [ ] **Step 3: 최소 구현**

`src/lib/customer-contracts.ts` 끝에 추가한다.

```ts
import { operatingMonthOf, OPERATING_DAYS_PER_MONTH, operatingDaysToMs } from "@/lib/twin/operating-clock";

/**
 * 지금 운영시각이 속한 **운영월**의 [시작, 끝) 범위(운영 ms).
 *
 * 계약 `contractedMonthlyQty`는 운영 1개월치이고 자동출하도 운영일 기준으로 나간다. 집계 창을
 * 벽시계 달력 월로 잡으면 24배속에서 분자에 운영 24개월치가 쌓여 이행률이 그만큼 부풀려진다.
 */
export function operatingMonthRange(operatingEpochMs: number): { startMs: number; endMs: number } {
  const month = operatingMonthOf(operatingEpochMs);
  const startMs = operatingDaysToMs(month * OPERATING_DAYS_PER_MONTH);
  return { startMs, endMs: startMs + operatingDaysToMs(OPERATING_DAYS_PER_MONTH) };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx scripts/test-contract-fulfillment-window.ts`
Expected: `✅ contract fulfillment window passed`

- [ ] **Step 5: API를 운영월 창으로 교체**

`src/app/api/customers/route.ts`에서 import를 추가한다.

```ts
import { getOrInitTwinState } from "@/lib/twin/state";
import { operatingMonthRange } from "@/lib/customer-contracts";
```

`monthStart` 계산 블록(39-42행)을 지우고 아래로 바꾼다.

```ts
  // 집계 창은 **운영월**이다 — 계약 월량이 운영 1개월치이고 자동출하도 운영일 기준으로 나가기
  // 때문이다. 벽시계 달력 월로 잡으면 24배속에서 운영 24개월치가 한 창에 쌓인다.
  const twinState = await getOrInitTwinState();
  const { startMs, endMs } = operatingMonthRange(twinState.operatingEpochMs ?? 0);
```

`$match` 절을 바꾼다. 운영시각이 없는 과거 출하는 제외한다 — 벽시계로 폴백하면 같은 오류가 섞인다.

```ts
    { $match: { shippedOperatingMs: { $gte: startMs, $lt: endMs } } },
```

- [ ] **Step 6: 타입 검사와 화면 확인**

Run: `npm run typecheck 2>&1 | grep -v '^\.next/' | grep 'error TS'; curl -s -m 20 http://localhost:3000/api/customers | head -c 400`
Expected: typecheck 오류 없음. 응답의 `fulfillmentPct`가 이전보다 크게 낮아진다 (운영시각 필드가 있는 출하만 세므로 초기엔 0에 가깝다 — 정상)

- [ ] **Step 7: npm script 등록과 커밋**

`package.json`에 추가한다.

```json
    "test:contract-window": "tsx scripts/test-contract-fulfillment-window.ts",
```

```bash
git add src/lib/customer-contracts.ts src/app/api/customers/route.ts scripts/test-contract-fulfillment-window.ts package.json
git commit -m "fix(contracts): 이행률 집계 창을 벽시계 달력월에서 운영월로 교체"
```

---

### Task 7: 사용량 실적 창 운영 30일화 (F2)

**Files:**
- Modify: `src/lib/usage-twin-data.ts:29-45`

**Interfaces:**
- Consumes: `operatingDaysToMs` (기존), `getOrInitTwinState`
- Produces: 없음 (`UsageTwinMaterial.usages[].actualQty` 의미만 정정)

- [ ] **Step 1: 위반 확인**

`src/lib/usage-twin-data.ts:31`이 `new Date(Date.now() - 30 * 86_400_000)`로 **30 벽시계일**(= 운영 720일 = 24개월) 창을 잡고, 그 합을 운영 1개월 설계치 `monthlyQty`와 나란히 놓는다(`UsageClient.tsx:519`의 `usageGap = totalQty - actualQty`).

추가로 소스인 `materialFlowEvents`는 2026-07-27 이후 적재가 끊겨 실적이 사실상 0이다. 실제 소모는 `twinBurnEvents`에 쌓인다.

- [ ] **Step 2: 소스와 창을 함께 교체**

import를 추가한다.

```ts
import { getOrInitTwinState } from "@/lib/twin/state";
import { operatingDaysToMs, OPERATING_DAYS_PER_MONTH } from "@/lib/twin/operating-clock";
```

`getUsageTwinData()` 앞부분을 바꾼다. `materialFlowEvents` 대신 `twinBurnEvents`를 쓰고, 창을 운영 30일로 잡는다.

```ts
export async function getUsageTwinData(): Promise<UsageTwinData> {
  const { twinBurnEvents } = await collections();
  // 창은 **운영 30일**이다 — 비교 대상인 monthlyQty가 운영 1개월치이기 때문이다. 예전에는
  // 30 벽시계일(= 운영 720일 = 24개월)을 모아 1개월 설계치와 나란히 놓고 usageGap을 계산했다.
  // 소스도 materialFlowEvents에서 twinBurnEvents로 옮긴다 — 전자는 2026-07-27 이후 적재가
  // 끊겨 실적이 사실상 0이었다.
  const twinState = await getOrInitTwinState();
  const sinceOperatingMs = Math.max(0, (twinState.operatingEpochMs ?? 0) - operatingDaysToMs(OPERATING_DAYS_PER_MONTH));
  const [usages, inventories, warehouses, capacities, consumptionEvents] = await Promise.all([
    getProcessUsagesWithMaterial(),
    getInventoryRows(),
    getWarehouses(),
    getWarehouseCapacity(),
    twinBurnEvents.find({ operatingEpochMs: { $gte: sinceOperatingMs } }).toArray(),
  ]);
```

- [ ] **Step 3: 집계 키를 맞춘다**

`twinBurnEvents`에는 `fabId`·`processCode`가 없고 `materialId`·`burnedQty`만 있다. 기존 키(`materialId|processCode|product`)를 자재 단위로 낮추고, 화면이 공정별로 배분하지 않도록 자재 합계만 쓴다.

`actualMap` 블록을 바꾼다.

```ts
  // twinBurnEvents는 자재 단위로만 기록된다(공정·제품 분해 없음). 실적을 자재 합계로 잡고,
  // 같은 자재의 여러 공정 행에는 첫 행에만 실적을 실어 중복 합산을 막는다.
  const actualMap = new Map<string, number>();
  for (const event of consumptionEvents) {
    actualMap.set(event.materialId, (actualMap.get(event.materialId) ?? 0) + event.burnedQty);
  }
  const actualClaimed = new Set<string>();
```

`material.usages.push` 블록의 `actualQty`를 바꾼다.

```ts
    material.usages.push({
      proc: usage.processCode,
      product: usage.product,
      qty: usage.monthlyQty,
      actualQty: actualClaimed.has(usage.materialId) ? 0 : (actualClaimed.add(usage.materialId), actualMap.get(usage.materialId) ?? 0),
    });
```

- [ ] **Step 4: 타입 검사**

Run: `npm run typecheck 2>&1 | grep -v '^\.next/' | grep 'error TS'`
Expected: 출력 없음. `materialFlowEvents`가 더 이상 안 쓰이면 구조분해에서 제거한다.

- [ ] **Step 5: 화면 확인**

Run: `curl -s -m 30 http://localhost:3000/usage > /dev/null && echo "렌더 OK"`
Expected: `렌더 OK`. 브라우저에서 `/usage`의 "실적"이 설계 월소요와 같은 자릿수인지 확인한다 (예전에는 24배 컸다)

- [ ] **Step 6: 커밋**

```bash
git add src/lib/usage-twin-data.ts
git commit -m "fix(usage): 실적 집계 창을 운영 30일로 바꾸고 소스를 twinBurnEvents로 교체"
```

---

## Phase 2 — 트렌드 대시보드

### Task 8: 일별 스냅샷 모델과 순수 빌더

**Files:**
- Modify: `src/lib/db.ts` (`TwinDailySnapshotDoc` + 컬렉션 등록)
- Create: `src/lib/twin/daily-snapshot.ts`
- Create: `scripts/test-daily-snapshot.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `operatingDayOf` (Task 4)
- Produces:
  - `TwinDailySnapshotDoc` (db.ts)
  - `buildDailySnapshot(input: DailySnapshotInput): TwinDailySnapshotDoc`
  - `DailySnapshotInput` 타입

- [ ] **Step 1: 문서 타입과 컬렉션 등록**

`src/lib/db.ts`에 인터페이스를 추가한다.

```ts
/**
 * 운영일 1일치 운영 상태 스냅샷 — 트렌드 화면의 유일한 데이터원.
 *
 * 재고 커버리지·창고 점유율은 *상태*라 이벤트로 과거를 복원할 수 없다. 어제의 점유율은 어제
 * 찍어둬야만 안다. 그래서 이벤트 재집계가 아니라 스냅샷으로 쌓는다.
 *
 * `_id`가 운영일이라 같은 날이 두 번 적재될 수 없다. 엔진이 멈추면 운영일이 넘어가지 않으므로
 * 스냅샷도 안 생기고, 그 공백 자체가 정지의 증거가 된다.
 */
export interface TwinDailySnapshotDoc {
  _id: string;               // `OP-${operatingDay}`
  operatingDay: number;
  wallDayKey: string;        // "2026-08-18" — 벽시계 축 토글용 버킷
  /** 벽시계 사실 기록 — 가속하지 않는다 */
  recordedAt: Date;
  production: { product: Product; producedQty: number; designDailyQty: number; ratePct: number }[];
  materials: {
    stockoutCount: number;
    criticalCount: number;
    medianDoh: number;
    worst: { materialCode: string; doh: number }[];
  };
  warehouses: { code: string; utilization: number; baselineUtilization: number }[];
  shipments: { product: Product; shippedQty: number; contractDailyQty: number; fulfillmentPct: number }[];
  policy: { r1: number; r2: number; r3: number; r4: number };
  engine: { ticks: number; elapsedOperatingMs: number; clampedCatchUps: number };
}
```

`collections()`의 반환 타입에 추가한다.

```ts
  twinDailySnapshots: Collection<TwinDailySnapshotDoc>;
```

그리고 반환 객체에 추가한다.

```ts
    twinDailySnapshots: db.collection<TwinDailySnapshotDoc>("twinDailySnapshots"),
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

Create: `scripts/test-daily-snapshot.ts`

```ts
import assert from "node:assert/strict";
import { buildDailySnapshot } from "../src/lib/twin/daily-snapshot";

const base = {
  operatingDay: 9,
  recordedAt: new Date("2026-08-18T12:00:00Z"),
  producedByProduct: { HBM: 190125, DRAM: 4562096, NAND: 4316544 },
  designDailyByProduct: { HBM: 190125, DRAM: 4562096, NAND: 4316544 },
  shippedByProduct: { HBM: 171112, DRAM: 4105886, NAND: 3884889 },
  contractDailyByProduct: { HBM: 171112, DRAM: 4105886, NAND: 3884889 },
  materialDohs: [{ materialCode: "GAS-001", doh: 0 }, { materialCode: "CHM-001", doh: 0 }, { materialCode: "CSM-002", doh: 3 }, { materialCode: "GAS-003", doh: 11 }, { materialCode: "GAS-010", doh: 22 }],
  criticalCount: 3,
  warehouses: [{ code: "MWH-01", utilization: 79, baselineUtilization: 60 }],
  policy: { r1: 0, r2: 0, r3: 0, r4: 0 },
  engine: { ticks: 80, elapsedOperatingMs: 86_400_000, clampedCatchUps: 0 },
};

const snap = buildDailySnapshot(base);

assert.equal(snap._id, "OP-9", "_id는 운영일 기반");
assert.equal(snap.operatingDay, 9);
assert.equal(snap.wallDayKey, "2026-08-18", "벽시계 버킷은 recordedAt의 UTC 날짜");

assert.equal(snap.production.length, 3, "3제품");
assert.equal(snap.production.find(p => p.product === "HBM")!.ratePct, 100, "설계와 같으면 100%");

// 설계 산출이 0인 제품은 비율을 100%로 착각하면 안 된다.
const zero = buildDailySnapshot({ ...base, designDailyByProduct: { HBM: 0, DRAM: 1, NAND: 1 }, producedByProduct: { HBM: 5, DRAM: 1, NAND: 1 } });
assert.equal(zero.production.find(p => p.product === "HBM")!.ratePct, 0, "설계 0이면 비율 0 — 0으로 나누지 않는다");

assert.equal(snap.materials.stockoutCount, 2, "DOH 0인 자재가 결품");
assert.equal(snap.materials.criticalCount, 3);
assert.equal(snap.materials.medianDoh, 3, "5개의 중앙값");
assert.equal(snap.materials.worst.length, 5, "하위 5종");
assert.equal(snap.materials.worst[0].materialCode, "GAS-001", "가장 낮은 DOH가 먼저");

// 짝수 개수의 중앙값은 가운데 두 값의 평균.
const even = buildDailySnapshot({ ...base, materialDohs: [{ materialCode: "A", doh: 1 }, { materialCode: "B", doh: 3 }, { materialCode: "C", doh: 5 }, { materialCode: "D", doh: 9 }] });
assert.equal(even.materials.medianDoh, 4, "짝수 중앙값 = (3+5)/2");

// 자재가 하나도 없으면 중앙값 0, 하위 목록 빈 배열 — 화면이 undefined를 만나지 않게.
const empty = buildDailySnapshot({ ...base, materialDohs: [] });
assert.equal(empty.materials.medianDoh, 0);
assert.deepEqual(empty.materials.worst, []);
assert.equal(empty.materials.stockoutCount, 0);

assert.equal(snap.shipments.find(s => s.product === "DRAM")!.fulfillmentPct, 100, "계약과 같으면 100%");
const noContract = buildDailySnapshot({ ...base, contractDailyByProduct: { HBM: 0, DRAM: 1, NAND: 1 } });
assert.equal(noContract.shipments.find(s => s.product === "HBM")!.fulfillmentPct, 0, "계약 0이면 이행률 0");

console.log("✅ daily snapshot passed");
```

- [ ] **Step 3: 실패 확인**

Run: `npx tsx scripts/test-daily-snapshot.ts`
Expected: FAIL — `Cannot find module '../src/lib/twin/daily-snapshot'`

- [ ] **Step 4: 최소 구현**

Create: `src/lib/twin/daily-snapshot.ts`

```ts
import type { Product, TwinDailySnapshotDoc } from "@/lib/db";

// 운영일 1일치 스냅샷을 만드는 순수 함수. DB를 만지지 않으므로 테스트가 쉽고, 엔진 tick은
// 값을 모아 넘기기만 한다.

export type DailySnapshotInput = {
  operatingDay: number;
  /** 벽시계 사실 기록 */
  recordedAt: Date;
  producedByProduct: Partial<Record<Product, number>>;
  designDailyByProduct: Partial<Record<Product, number>>;
  shippedByProduct: Partial<Record<Product, number>>;
  contractDailyByProduct: Partial<Record<Product, number>>;
  materialDohs: { materialCode: string; doh: number }[];
  criticalCount: number;
  warehouses: { code: string; utilization: number; baselineUtilization: number }[];
  policy: { r1: number; r2: number; r3: number; r4: number };
  engine: { ticks: number; elapsedOperatingMs: number; clampedCatchUps: number };
};

const PRODUCTS: Product[] = ["HBM", "DRAM", "NAND"];

/** 분모가 0이면 100%가 아니라 0%다 — 설계 산출이 없는 제품을 "완벽 달성"으로 읽으면 안 된다. */
function pctOf(actual: number, target: number): number {
  if (target <= 0) return 0;
  return Math.round((actual / target) * 1000) / 10;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function buildDailySnapshot(input: DailySnapshotInput): TwinDailySnapshotDoc {
  const byDoh = [...input.materialDohs].sort((a, b) => a.doh - b.doh);
  return {
    _id: `OP-${input.operatingDay}`,
    operatingDay: input.operatingDay,
    wallDayKey: input.recordedAt.toISOString().slice(0, 10),
    recordedAt: input.recordedAt,
    production: PRODUCTS.map((product) => {
      const producedQty = input.producedByProduct[product] ?? 0;
      const designDailyQty = input.designDailyByProduct[product] ?? 0;
      return { product, producedQty, designDailyQty, ratePct: pctOf(producedQty, designDailyQty) };
    }),
    materials: {
      stockoutCount: byDoh.filter((m) => m.doh <= 0).length,
      criticalCount: input.criticalCount,
      medianDoh: medianOf(byDoh.map((m) => m.doh)),
      worst: byDoh.slice(0, 5),
    },
    warehouses: input.warehouses,
    shipments: PRODUCTS.map((product) => {
      const shippedQty = input.shippedByProduct[product] ?? 0;
      const contractDailyQty = input.contractDailyByProduct[product] ?? 0;
      return { product, shippedQty, contractDailyQty, fulfillmentPct: pctOf(shippedQty, contractDailyQty) };
    }),
    policy: input.policy,
    engine: input.engine,
  };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx tsx scripts/test-daily-snapshot.ts`
Expected: `✅ daily snapshot passed`

- [ ] **Step 6: npm script 등록과 커밋**

`package.json`에 추가한다.

```json
    "test:daily-snapshot": "tsx scripts/test-daily-snapshot.ts",
```

```bash
git add src/lib/db.ts src/lib/twin/daily-snapshot.ts scripts/test-daily-snapshot.ts package.json
git commit -m "feat(twin): 일별 스냅샷 모델과 순수 빌더"
```

---

### Task 9: 엔진 tick에서 스냅샷 적재

**Files:**
- Modify: `src/lib/twin/engine.ts` (운영시계 전진 직후 + 상태저장 직전)

**Interfaces:**
- Consumes: `operatingDaysCompletedBetween` (Task 4), `buildDailySnapshot` (Task 8), `getWarehouseCapacity`·`getInventoryRows` (`src/lib/queries.ts`)
- Produces: `twinDailySnapshots` 문서

- [ ] **Step 1: 제품별 출하 누적 변수를 만들고 완료된 운영일을 계산한다**

엔진에는 `autoShipped`(스칼라)만 있고 제품별 누적이 없다(`engine.ts:240, 351`). 스냅샷이 제품별 출하량을 요구하므로 `finishedGoodsAddedByProduct`와 같은 패턴으로 추가한다.

`src/lib/twin/engine.ts`의 import에 추가한다.

```ts
import { operatingDaysCompletedBetween, OPERATING_DAYS_PER_MONTH } from "@/lib/twin/operating-clock";
import { buildDailySnapshot } from "@/lib/twin/daily-snapshot";
import { buildContractLines, designMonthlyOutput } from "@/lib/customer-contracts";
```

`let autoShipped = 0;`(240행) 바로 아래에 누적 맵을 만든다.

```ts
    const autoShippedByProduct: Partial<Record<Product, number>> = {};
```

`autoShipped += alloc.qty;`(351행) 바로 아래에 제품별로도 더한다.

```ts
          autoShippedByProduct[product] = (autoShippedByProduct[product] ?? 0) + alloc.qty;
```

운영시계 전진 블록(`const elapsedOperatingDays = ...` 다음, 225행 부근) 바로 아래에 넣는다.

```ts
    // 이번 tick에 넘어간 운영일. 하루가 끝나야 그 날의 집계가 확정되므로 진행 중인 날은 빼고,
    // catch-up으로 여러 날을 건너뛰면 그 사이 날을 모두 받는다.
    const completedOperatingDays = operatingDaysCompletedBetween(
      state.operatingEpochMs ?? 0,
      clock.operatingEpochMs,
    );
```

- [ ] **Step 2: 상태저장 직전에 스냅샷을 적재한다**

`mark("발주·입고정산");` 다음, `const { twinEngineState } = await collections();` 앞에 넣는다.

```ts
    // ── 일별 스냅샷 (운영일 경계에서만) ──
    // 재고 커버리지·창고 점유는 상태라 나중에 복원할 수 없다. 하루가 끝나는 이 순간에만 남는다.
    if (completedOperatingDays.length > 0) {
      const snapMark = Date.now();
      const { twinDailySnapshots } = await collections();
      const [invRows, whCapacity] = await Promise.all([getInventoryRows(), getWarehouseCapacity()]);
      const seenMaterial = new Set<string>();
      const materialDohs = invRows
        .filter((r) => { if (seenMaterial.has(r.materialId)) return false; seenMaterial.add(r.materialId); return r.material.ropDays > 0 && r.doh != null; })
        .map((r) => ({ materialCode: r.material.code, doh: r.doh as number }));
      const criticalCount = invRows.filter((r) => r.doh != null && r.material.ropDays > 0 && r.doh < r.material.ropDays * 0.5).length;
      // 설계 일산출 = 설계 월산출 ÷ 운영 30일. designMonthlyOutput은 계약 월량을 만드는
      // 함수와 같은 것을 쓴다(customer-contracts.ts) — 두 값이 갈라지면 비율이 거짓말을 한다.
      const contractLines = buildContractLines(await customers.find({}).toArray());
      const designDailyByProduct: Partial<Record<Product, number>> = {};
      const contractDailyByProduct: Partial<Record<Product, number>> = {};
      for (const { product } of ACTIVE_PRODUCTION_PRODUCTS) {
        designDailyByProduct[product] = designMonthlyOutput(product) / OPERATING_DAYS_PER_MONTH;
        // SPOT은 약정 물량이 0이라 자동으로 빠진다(buildContractLines).
        const contractedMonthly = contractLines
          .filter((l) => l.product === product)
          .reduce((sum, l) => sum + l.contractedMonthlyQty, 0);
        contractDailyByProduct[product] = contractedMonthly / OPERATING_DAYS_PER_MONTH;
      }
      // 여러 날이 한꺼번에 완료되면(정지 후 catch-up) 마지막 날에만 실측을 싣고, 나머지는
      // 같은 상태로 채운다 — 그 날들의 실제 상태는 관측되지 않았기 때문이다.
      for (const operatingDay of completedOperatingDays) {
        const snapshot = buildDailySnapshot({
          operatingDay,
          recordedAt: now,
          producedByProduct: finishedGoodsAddedByProduct,
          designDailyByProduct,
          shippedByProduct: autoShippedByProduct,
          contractDailyByProduct,
          materialDohs,
          criticalCount,
          warehouses: whCapacity
            .filter((wh) => wh.capacityMode === "SPACE")
            .map((wh) => ({ code: wh.code, utilization: wh.utilization, baselineUtilization: 0 })),
          policy: { r1: 0, r2: 0, r3: 0, r4: 0 },
          engine: { ticks: 1, elapsedOperatingMs: clock.elapsedOperatingMs, clampedCatchUps: clock.clampedCatchUp ? 1 : 0 },
        });
        await twinDailySnapshots.updateOne({ _id: snapshot._id }, { $setOnInsert: snapshot }, { upsert: true });
      }
      phase["일별 스냅샷"] = Date.now() - snapMark;
    }
```

- [ ] **Step 3: 참조하는 이름이 모두 존재하는지 확인**

Run: `grep -n "autoShippedByProduct\|ACTIVE_PRODUCTION_PRODUCTS\|const { inventory, materials" src/lib/twin/engine.ts | head`
Expected: `autoShippedByProduct`가 선언·누적·사용 세 곳에 보이고, `customers`가 134행 구조분해에 이미 들어 있다(자동출하가 쓰고 있다). `ACTIVE_PRODUCTION_PRODUCTS`가 import 되어 있지 않으면 `@/lib/fab-production-config`에서 추가한다.

- [ ] **Step 4: 타입 검사**

Run: `npm run typecheck 2>&1 | grep -v '^\.next/' | grep 'error TS'`
Expected: 출력 없음

- [ ] **Step 5: 실제 적재 확인**

운영일 경계는 실제 1시간마다 온다. 즉시 확인하려면 운영시각을 경계 직전으로 옮긴다.

Run:
```bash
cat > /tmp/nudge.ts <<'EOF'
import "dotenv/config";
import { collections, getMongoClient } from "./src/lib/db";
import { operatingDaysToMs, operatingDayOf } from "./src/lib/twin/operating-clock";
async function main() {
  const { twinEngineState, twinDailySnapshots } = await collections();
  const st = await twinEngineState.findOne({ _id: "singleton" });
  const day = operatingDayOf(st!.operatingEpochMs ?? 0);
  // 다음 운영일 경계 30초(운영시간) 앞으로 당긴다 — 다음 tick이 경계를 넘게 된다.
  const target = operatingDaysToMs(day + 1) - 30_000;
  await twinEngineState.updateOne({ _id: "singleton" }, { $set: { operatingEpochMs: target } });
  console.log(`운영시각을 ${day + 1}일 경계 직전으로 이동. 다음 tick(최대 60초)을 기다린다.`);
  await (await getMongoClient()).close();
}
main().catch(e => { console.error(e); process.exit(1); });
EOF
cp /tmp/nudge.ts ./tmp-nudge.ts && npx dotenv-cli -e .env -- npx tsx tmp-nudge.ts; rm -f tmp-nudge.ts
sleep 90
cat > /tmp/check.ts <<'EOF'
import "dotenv/config";
import { collections, getMongoClient } from "./src/lib/db";
async function main() {
  const { twinDailySnapshots } = await collections();
  const docs = await twinDailySnapshots.find({}).sort({ operatingDay: -1 }).limit(3).toArray();
  console.log(`스냅샷 ${await twinDailySnapshots.countDocuments()}건`);
  for (const d of docs) console.log(`  ${d._id} wallDay=${d.wallDayKey} 결품=${d.materials.stockoutCount} 중앙DOH=${d.materials.medianDoh} 창고=${d.warehouses.length}`);
  await (await getMongoClient()).close();
}
main().catch(e => { console.error(e); process.exit(1); });
EOF
cp /tmp/check.ts ./tmp-check.ts && npx dotenv-cli -e .env -- npx tsx tmp-check.ts; rm -f tmp-check.ts
```
Expected: 스냅샷 1건 이상, `OP-<n>` 형태의 `_id`

- [ ] **Step 6: 커밋**

```bash
git add src/lib/twin/engine.ts
git commit -m "feat(twin): 운영일 경계에서 일별 스냅샷 적재"
```

---

### Task 10: 트렌드 조회 API

**Files:**
- Create: `src/app/api/twin/trends/route.ts`

**Interfaces:**
- Consumes: `twinDailySnapshots` (Task 8)
- Produces: `GET /api/twin/trends?axis=operating|wall&days=<n>` → `{ axis, days, startedAt, points: TwinDailySnapshotDoc[] }`

- [ ] **Step 1: 라우트 작성**

Create: `src/app/api/twin/trends/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections } from "@/lib/db";

// 트렌드 화면의 유일한 데이터원. 스냅샷 컬렉션만 읽고 파생 계산은 하지 않는다 —
// 집계는 적재 시점(engine tick)에 이미 끝나 있다.
export const dynamic = "force-dynamic";

const MAX_DAYS = 90;

export async function GET(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const { twinDailySnapshots } = await collections();
  const axis = req.nextUrl.searchParams.get("axis") === "wall" ? "wall" : "operating";
  const requested = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const days = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), MAX_DAYS) : 30;

  const points = await twinDailySnapshots.find({}).sort({ operatingDay: -1 }).limit(days).toArray();
  points.reverse();

  // 적재 시작일 — 백필하지 않으므로 화면이 "언제부터의 기록인지"를 밝혀야 한다.
  const first = await twinDailySnapshots.find({}).sort({ operatingDay: 1 }).limit(1).next();

  return NextResponse.json({
    axis,
    days,
    startedAt: first?.recordedAt ?? null,
    startedOperatingDay: first?.operatingDay ?? null,
    points,
  });
}
```

- [ ] **Step 2: 타입 검사**

Run: `npm run typecheck 2>&1 | grep -v '^\.next/' | grep 'error TS'`
Expected: 출력 없음

- [ ] **Step 3: 응답 확인**

Run: `curl -s -m 20 "http://localhost:3000/api/twin/trends?days=7" | head -c 500`
Expected: `{"axis":"operating","days":7,...,"points":[...]}` — 인증이 걸려 있으면 `{"error":"Unauthorized"}`가 정상이며 브라우저 로그인 후 확인한다

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/twin/trends/route.ts
git commit -m "feat(trends): 스냅샷 조회 API"
```

---

### Task 11: 차트 스케일 순수 함수

**Files:**
- Create: `src/app/(dashboard)/trends/chart-scale.ts`
- Create: `scripts/test-chart-scale.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `linearScale(domain: [number, number], range: [number, number]): (v: number) => number`
  - `niceDomain(values: number[], opts?: { includeZero?: boolean }): [number, number]`
  - `linePath(points: { x: number; y: number }[]): string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Create: `scripts/test-chart-scale.ts`

```ts
import assert from "node:assert/strict";
import { linearScale, niceDomain, linePath } from "../src/app/(dashboard)/trends/chart-scale";

const s = linearScale([0, 100], [0, 200]);
assert.equal(s(0), 0);
assert.equal(s(50), 100);
assert.equal(s(100), 200);

// 도메인 폭이 0이면 나눗셈이 터진다 — 범위 중앙으로 눕힌다.
const flat = linearScale([5, 5], [0, 200]);
assert.equal(flat(5), 100, "도메인 폭 0이면 범위 중앙");

// y축은 위아래가 뒤집힌다(SVG 좌표계).
const inv = linearScale([0, 10], [100, 0]);
assert.equal(inv(0), 100);
assert.equal(inv(10), 0);

assert.deepEqual(niceDomain([3, 7, 5]), [3, 7], "기본은 최소~최대");
assert.deepEqual(niceDomain([3, 7, 5], { includeZero: true }), [0, 7], "0 포함 요청 시 하한 0");
assert.deepEqual(niceDomain([]), [0, 1], "표본이 없으면 안전한 기본 도메인");
assert.deepEqual(niceDomain([4]), [4, 5], "단일 표본은 폭 0이 되지 않게 벌린다");
assert.deepEqual(niceDomain([0, 0, 0]), [0, 1], "전부 0이어도 폭 0을 만들지 않는다");

assert.equal(linePath([]), "", "점이 없으면 빈 path");
assert.equal(linePath([{ x: 1, y: 2 }]), "M 1 2", "점 하나는 M만");
assert.equal(linePath([{ x: 1, y: 2 }, { x: 3, y: 4 }]), "M 1 2 L 3 4");

console.log("✅ chart scale passed");
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx scripts/test-chart-scale.ts`
Expected: FAIL — 모듈을 찾을 수 없음

- [ ] **Step 3: 최소 구현**

Create: `src/app/(dashboard)/trends/chart-scale.ts`

```ts
// 차트 좌표 변환 순수 함수. 차트 라이브러리를 넣지 않으므로(package.json 의존성 동결)
// 스케일과 path 생성을 직접 갖는다. React를 import하지 않아 tsx로 바로 테스트된다.

/** 선형 스케일. 도메인 폭이 0이면 범위 중앙으로 눕힌다 — 표본이 하나뿐인 날 NaN이 나오지 않게. */
export function linearScale(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (span === 0) return () => (r0 + r1) / 2;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** 표본에서 안전한 도메인을 만든다. 빈 배열·단일 표본·전부 동일값에서도 폭이 0이 되지 않는다. */
export function niceDomain(values: number[], opts: { includeZero?: boolean } = {}): [number, number] {
  if (values.length === 0) return [0, 1];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (opts.includeZero) min = Math.min(0, min);
  if (min === max) max = min + 1;
  return [min, max];
}

/** SVG 폴리라인 path. 결측 구간은 호출자가 배열을 끊어 넘긴다. */
export function linePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  const [head, ...rest] = points;
  return `M ${head.x} ${head.y}` + rest.map((p) => ` L ${p.x} ${p.y}`).join("");
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx scripts/test-chart-scale.ts`
Expected: `✅ chart scale passed`

- [ ] **Step 5: npm script 등록과 커밋**

`package.json`에 추가한다.

```json
    "test:chart-scale": "tsx scripts/test-chart-scale.ts",
```

```bash
git add "src/app/(dashboard)/trends/chart-scale.ts" scripts/test-chart-scale.ts package.json
git commit -m "feat(trends): 차트 스케일 순수 함수"
```

---

### Task 12: 차트 컴포넌트

**Files:**
- Create: `src/app/(dashboard)/trends/charts/palette.ts`
- Create: `src/app/(dashboard)/trends/charts/LineChart.tsx`
- Create: `src/app/(dashboard)/trends/charts/BarChart.tsx`
- Create: `src/app/(dashboard)/trends/charts/Sparkline.tsx`

**Interfaces:**
- Consumes: `linearScale`, `niceDomain`, `linePath` (Task 11)
- Produces:
  - `PRODUCT_COLOR: Record<Product, string>`
  - `<LineChart series={{ key, label, color, points: (number|null)[] }[]} xLabels={string[]} referencePct={number|null} unit={string} />`
  - `<BarChart values={number[]} xLabels={string[]} label={string} color={string} />`
  - `<Sparkline values={number[]} label={string} thresholds={{ value: number; color: string; label: string }[]} />`

- [ ] **Step 1: 팔레트 파일**

Create: `src/app/(dashboard)/trends/charts/palette.ts`

```ts
import type { Product } from "@/lib/db";

// 제품 계열 색 — dataviz 6검사 전항목 PASS (light, surface #fcfcfb):
// 최악 인접쌍 deutan ΔE 9.8 · tritan 28.9 · 정상시야 26.9 · 대비 전부 >= 3:1.
// 색은 **엔티티에 고정**한다. 필터가 계열 수를 바꿔도 살아남은 계열의 색은 바뀌지 않는다.
export const PRODUCT_COLOR: Record<Product, string> = {
  HBM: "#0078D4",
  DRAM: "#B5179E",
  NAND: "#0E9B8A",
};

// 상태색은 예약이다 — 계열 색으로 재사용하지 않는다.
export const STATUS_COLOR = {
  critical: "#EA002C",
  warning: "#F7A600",
  ok: "#00B96B",
} as const;

export const AXIS_INK = "#999999";
export const GRID_INK = "#E8E8E8";
```

- [ ] **Step 2: LineChart**

Create: `src/app/(dashboard)/trends/charts/LineChart.tsx`

```tsx
"use client";

import { useId, useState } from "react";
import { linearScale, niceDomain, linePath } from "../chart-scale";
import { AXIS_INK, GRID_INK } from "./palette";

export type LineSeries = { key: string; label: string; color: string; points: (number | null)[] };

// 다계열 라인 + 기준선. 이중축은 만들지 않는다 — 단위가 다르면 차트를 나눈다.
export default function LineChart({
  series, xLabels, referencePct = null, unit = "%", height = 200,
}: {
  series: LineSeries[]; xLabels: string[]; referencePct?: number | null; unit?: string; height?: number;
}) {
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = height, PAD = { top: 12, right: 16, bottom: 26, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const all = series.flatMap((s) => s.points.filter((p): p is number => p != null));
  const domain = niceDomain(referencePct != null ? [...all, referencePct] : all, { includeZero: true });
  const y = linearScale(domain, [PAD.top + plotH, PAD.top]);
  const x = linearScale([0, Math.max(xLabels.length - 1, 1)], [PAD.left, PAD.left + plotW]);

  const ticks = [domain[0], (domain[0] + domain[1]) / 2, domain[1]];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${series.map((s) => s.label).join(", ")} 추이`}>
        <clipPath id={clipId}><rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} /></clipPath>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke={GRID_INK} strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill={AXIS_INK}>{Math.round(t)}</text>
          </g>
        ))}

        {referencePct != null && (
          <line x1={PAD.left} x2={PAD.left + plotW} y1={y(referencePct)} y2={y(referencePct)}
                stroke={AXIS_INK} strokeWidth={1} strokeDasharray="4 3" />
        )}

        <g clipPath={`url(#${clipId})`}>
          {series.map((s) => {
            // 결측(null)에서 선을 끊는다 — 이어 그리면 없는 날을 있는 것처럼 만든다.
            const runs: { x: number; y: number }[][] = [];
            let run: { x: number; y: number }[] = [];
            s.points.forEach((v, i) => {
              if (v == null) { if (run.length) runs.push(run); run = []; return; }
              run.push({ x: x(i), y: y(v) });
            });
            if (run.length) runs.push(run);
            return (
              <g key={s.key}>
                {runs.map((r, i) => (
                  <path key={i} d={linePath(r)} fill="none" stroke={s.color} strokeWidth={2}
                        strokeLinecap="round" strokeLinejoin="round" />
                ))}
                {hover != null && s.points[hover] != null && (
                  <circle cx={x(hover)} cy={y(s.points[hover]!)} r={4} fill={s.color} stroke="#FFFFFF" strokeWidth={2} />
                )}
              </g>
            );
          })}
        </g>

        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke={AXIS_INK} strokeWidth={1} />
        )}

        {xLabels.map((label, i) =>
          i % Math.ceil(xLabels.length / 6 || 1) === 0 ? (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={9} fill={AXIS_INK}>{label}</text>
          ) : null,
        )}

        {xLabels.map((_, i) => (
          <rect key={i} x={x(i) - plotW / Math.max(xLabels.length, 1) / 2} y={PAD.top}
                width={plotW / Math.max(xLabels.length, 1)} height={plotH} fill="transparent"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[10px] font-bold text-[#333]">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
            {hover != null && s.points[hover] != null && <span className="tabular-nums text-[#666]">{s.points[hover]}{unit}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: BarChart**

Create: `src/app/(dashboard)/trends/charts/BarChart.tsx`

```tsx
"use client";

import { useState } from "react";
import { linearScale, niceDomain } from "../chart-scale";
import { AXIS_INK, GRID_INK } from "./palette";

// 단일 계열 막대. 데이터 끝을 4px 라운드하고 막대 사이에 2px 표면 간격을 둔다.
export default function BarChart({
  values, xLabels, label, color, height = 160,
}: { values: number[]; xLabels: string[]; label: string; color: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = height, PAD = { top: 12, right: 16, bottom: 26, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const domain = niceDomain(values, { includeZero: true });
  const y = linearScale(domain, [PAD.top + plotH, PAD.top]);
  const slot = plotW / Math.max(values.length, 1);
  const barW = Math.max(slot - 2, 1);   // 2px 표면 간격

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label} 추이`}>
        {[domain[0], domain[1]].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke={GRID_INK} strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill={AXIS_INK}>{Math.round(t)}</text>
          </g>
        ))}
        {values.map((v, i) => {
          const top = y(v);
          const base = y(domain[0]);
          return (
            <rect key={i} x={PAD.left + i * slot + 1} y={Math.min(top, base)}
                  width={barW} height={Math.max(Math.abs(base - top), 1)}
                  rx={4} fill={color} opacity={hover == null || hover === i ? 1 : 0.45}
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          );
        })}
        {xLabels.map((l, i) =>
          i % Math.ceil(xLabels.length / 6 || 1) === 0 ? (
            <text key={i} x={PAD.left + i * slot + barW / 2} y={H - 8} textAnchor="middle" fontSize={9} fill={AXIS_INK}>{l}</text>
          ) : null,
        )}
      </svg>
      <div className="mt-1 text-[10px] font-bold text-[#333]">
        <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: color }} />
        {label}
        {hover != null && <span className="ml-2 tabular-nums text-[#666]">{xLabels[hover]} · {values[hover]}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Sparkline**

Create: `src/app/(dashboard)/trends/charts/Sparkline.tsx`

```tsx
"use client";

import { linearScale, niceDomain, linePath } from "../chart-scale";
import { AXIS_INK } from "./palette";

// 창고 8개를 한 화면에 놓기 위한 small multiples 한 칸.
// 계열이 8개면 categorical 색 한계를 넘으므로 색으로 구분하지 않고 칸으로 나눈다.
export default function Sparkline({
  values, label, thresholds = [],
}: { values: number[]; label: string; thresholds?: { value: number; color: string; label: string }[] }) {
  const W = 200, H = 56, PAD = 6;
  const domain = niceDomain([...values, ...thresholds.map((t) => t.value)], { includeZero: true });
  const y = linearScale(domain, [H - PAD, PAD]);
  const x = linearScale([0, Math.max(values.length - 1, 1)], [PAD, W - PAD]);
  const last = values.length ? values[values.length - 1] : null;

  return (
    <div className="rounded-lg border bg-white px-2 py-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-bold text-[#333]">{label}</span>
        <span className="tabular-nums text-[11px] font-black text-[#141413]">{last != null ? `${Math.round(last)}%` : "—"}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label} 점유율 추이`}>
        {thresholds.map((t) => (
          <line key={t.label} x1={PAD} x2={W - PAD} y1={y(t.value)} y2={y(t.value)}
                stroke={t.color} strokeWidth={1} strokeDasharray="3 2" />
        ))}
        <path d={linePath(values.map((v, i) => ({ x: x(i), y: y(v) })))}
              fill="none" stroke={AXIS_INK} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
```

- [ ] **Step 5: 타입 검사와 커밋**

Run: `npm run typecheck 2>&1 | grep -v '^\.next/' | grep 'error TS'`
Expected: 출력 없음

```bash
git add "src/app/(dashboard)/trends/charts"
git commit -m "feat(trends): 인라인 SVG 차트 컴포넌트"
```

---

### Task 13: 트렌드 화면 조립

**Files:**
- Create: `src/app/(dashboard)/trends/page.tsx`
- Create: `src/app/(dashboard)/trends/TrendsClient.tsx`
- Modify: `src/app/(dashboard)/layout.tsx:14-15`

**Interfaces:**
- Consumes: `GET /api/twin/trends` (Task 10), 차트 컴포넌트 (Task 12)
- Produces: `/trends` 페이지

- [ ] **Step 1: Next.js 가이드 확인**

Run: `ls node_modules/next/dist/docs/ && grep -rl "force-dynamic\|searchParams" node_modules/next/dist/docs/ | head -5`
읽고 폐기 예정 API를 쓰지 않는지 확인한다 (RULES.md § Next.js).

- [ ] **Step 2: 서버 진입점**

Create: `src/app/(dashboard)/trends/page.tsx`

```tsx
export const dynamic = "force-dynamic";

import { collections } from "@/lib/db";
import TrendsClient from "./TrendsClient";

export default async function TrendsPage() {
  const { twinDailySnapshots } = await collections();
  const first = await twinDailySnapshots.find({}).sort({ operatingDay: 1 }).limit(1).next();

  return (
    <>
      <div className="mb-1 text-2xl font-extrabold tracking-tight">운영 트렌드</div>
      <div className="mb-6 text-sm text-[#999]">
        설계 기준선 대비 편차 · 운영일 축 기본 (실제 1시간 = 운영 1일) ·{" "}
        {first
          ? `적재 시작 운영 ${first.operatingDay}일차 (${new Date(first.recordedAt).toLocaleDateString("ko-KR")})`
          : "아직 적재된 스냅샷이 없다 — 운영일이 한 번 넘어가면 첫 점이 생긴다"}
      </div>
      <TrendsClient />
    </>
  );
}
```

- [ ] **Step 3: 클라이언트 조립**

Create: `src/app/(dashboard)/trends/TrendsClient.tsx`

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import LineChart from "./charts/LineChart";
import BarChart from "./charts/BarChart";
import Sparkline from "./charts/Sparkline";
import { PRODUCT_COLOR, STATUS_COLOR } from "./charts/palette";
import type { Product } from "@/lib/db";

type Snapshot = {
  operatingDay: number; wallDayKey: string; recordedAt: string;
  production: { product: Product; producedQty: number; designDailyQty: number; ratePct: number }[];
  materials: { stockoutCount: number; criticalCount: number; medianDoh: number; worst: { materialCode: string; doh: number }[] };
  warehouses: { code: string; utilization: number; baselineUtilization: number }[];
  shipments: { product: Product; shippedQty: number; contractDailyQty: number; fulfillmentPct: number }[];
  policy: { r1: number; r2: number; r3: number; r4: number };
  engine: { ticks: number; elapsedOperatingMs: number; clampedCatchUps: number };
};

const PRODUCTS: Product[] = ["HBM", "DRAM", "NAND"];
const RANGES = [7, 30, 90];

export default function TrendsClient() {
  const [axis, setAxis] = useState<"operating" | "wall">("operating");
  const [days, setDays] = useState(30);
  const [points, setPoints] = useState<Snapshot[]>([]);
  const [showTable, setShowTable] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/twin/trends?axis=${axis}&days=${days}`, { cache: "no-store" });
    const json = await res.json();
    setPoints(Array.isArray(json.points) ? json.points : []);
    setLoading(false);
  }, [axis, days]);

  useEffect(() => { void load(); }, [load]);

  const xLabels = points.map((p) => (axis === "operating" ? `${p.operatingDay}일차` : p.wallDayKey.slice(5)));

  const productSeries = (pick: (s: Snapshot, product: Product) => number | null) =>
    PRODUCTS.map((product) => ({
      key: product, label: product, color: PRODUCT_COLOR[product],
      points: points.map((s) => pick(s, product)),
    }));

  const warehouseCodes = [...new Set(points.flatMap((p) => p.warehouses.map((w) => w.code)))].sort();

  if (loading) return <div className="text-sm text-[#999]">불러오는 중…</div>;
  if (points.length === 0) {
    return (
      <div className="rounded-2xl border bg-white px-5 py-8 text-center text-sm text-[#666]">
        아직 스냅샷이 없다. 엔진이 운영일 경계를 한 번 넘으면 첫 점이 찍힌다 — 24배속에서 실제 1시간이다.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border">
          {(["operating", "wall"] as const).map((a) => (
            <button key={a} onClick={() => setAxis(a)}
                    className={`px-3 py-1.5 text-xs font-bold ${axis === a ? "bg-[#141413] text-white" : "bg-white text-[#666]"}`}>
              {a === "operating" ? "운영일" : "벽시계일"}
            </button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-lg border">
          {RANGES.map((d) => (
            <button key={d} onClick={() => setDays(d)}
                    className={`px-3 py-1.5 text-xs font-bold ${days === d ? "bg-[#141413] text-white" : "bg-white text-[#666]"}`}>
              {d}일
            </button>
          ))}
        </div>
        <button onClick={() => setShowTable((v) => !v)} className="rounded-lg border px-3 py-1.5 text-xs font-bold text-[#666]">
          {showTable ? "차트 보기" : "표 보기"}
        </button>
      </div>

      {showTable ? (
        <div className="overflow-x-auto rounded-2xl border bg-white">
          <table className="w-full text-xs">
            <thead className="bg-[#F5F5F5] text-[10px] font-bold text-[#666]">
              <tr><th className="px-3 py-2 text-left">축</th><th className="px-3 py-2">결품</th><th className="px-3 py-2">중앙DOH</th>
                {PRODUCTS.map((p) => <th key={p} className="px-3 py-2">{p} 산출률</th>)}
                {PRODUCTS.map((p) => <th key={p} className="px-3 py-2">{p} 이행률</th>)}</tr>
            </thead>
            <tbody>
              {points.map((s) => (
                <tr key={s.operatingDay} className="border-t">
                  <td className="px-3 py-1.5 font-bold">{axis === "operating" ? `${s.operatingDay}일차` : s.wallDayKey}</td>
                  <td className="px-3 py-1.5 text-center tabular-nums">{s.materials.stockoutCount}</td>
                  <td className="px-3 py-1.5 text-center tabular-nums">{s.materials.medianDoh}</td>
                  {PRODUCTS.map((p) => <td key={p} className="px-3 py-1.5 text-center tabular-nums">{s.production.find((x) => x.product === p)?.ratePct ?? "—"}</td>)}
                  {PRODUCTS.map((p) => <td key={p} className="px-3 py-1.5 text-center tabular-nums">{s.shipments.find((x) => x.product === p)?.fulfillmentPct ?? "—"}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <section className="rounded-2xl border bg-white p-4">
            <h2 className="mb-2 text-sm font-bold">생산 — 설계 대비 실산출률</h2>
            <LineChart xLabels={xLabels} referencePct={100} unit="%"
                       series={productSeries((s, p) => s.production.find((x) => x.product === p)?.ratePct ?? null)} />
          </section>

          <section className="rounded-2xl border bg-white p-4">
            <h2 className="mb-2 text-sm font-bold">자재 — 결품 종수</h2>
            <BarChart xLabels={xLabels} label="재고 0 자재" color={STATUS_COLOR.critical}
                      values={points.map((s) => s.materials.stockoutCount)} />
            <h2 className="mb-2 mt-4 text-sm font-bold">자재 — 커버리지 중앙값</h2>
            <LineChart xLabels={xLabels} unit="일"
                       series={[{ key: "medianDoh", label: "중앙 DOH", color: "#0078D4", points: points.map((s) => s.materials.medianDoh) }]} />
          </section>

          <section className="rounded-2xl border bg-white p-4">
            <h2 className="mb-2 text-sm font-bold">창고 — 점유율</h2>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {warehouseCodes.map((code) => (
                <Sparkline key={code} label={code}
                           values={points.map((s) => s.warehouses.find((w) => w.code === code)?.utilization ?? 0)}
                           thresholds={[
                             { value: 95, color: STATUS_COLOR.warning, label: "발주 상한" },
                             { value: 100, color: STATUS_COLOR.critical, label: "포화 임계" },
                           ]} />
              ))}
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-4">
            <h2 className="mb-2 text-sm font-bold">출하 — 계약 이행률</h2>
            <LineChart xLabels={xLabels} referencePct={100} unit="%"
                       series={productSeries((s, p) => s.shipments.find((x) => x.product === p)?.fulfillmentPct ?? null)} />
          </section>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 사이드바 메뉴 추가**

`src/app/(dashboard)/layout.tsx`의 첫 그룹에서 `{ href: "/", label: "관제탑 라이브" }` 바로 다음 줄에 넣는다.

```tsx
    { href: "/trends", label: "운영 트렌드" },
```

- [ ] **Step 5: 타입 검사와 렌더 확인**

Run: `npm run typecheck 2>&1 | grep -v '^\.next/' | grep 'error TS'; npm run lint 2>&1 | tail -5`
Expected: typecheck 오류 없음. lint는 기존 이슈(FinishedGoodsClient 등) 외 새 경고가 없어야 한다

브라우저에서 `/trends`를 열어 4섹션이 렌더되는지, 축 토글이 동작하는지, 라벨이 겹치지 않는지 눈으로 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add "src/app/(dashboard)/trends" "src/app/(dashboard)/layout.tsx"
git commit -m "feat(trends): 운영 트렌드 화면 — 4축 시계열"
```

---

### Task 14: 정책 변경 마커와 엔진 공백 밴드

**Files:**
- Modify: `src/lib/twin/daily-snapshot.ts` (정책 위반 건수는 이미 필드로 있음 — 마커 유도만 추가)
- Modify: `src/app/(dashboard)/trends/TrendsClient.tsx`
- Modify: `src/app/(dashboard)/trends/charts/LineChart.tsx`

**Interfaces:**
- Consumes: `Snapshot.policy`, `Snapshot.engine.clampedCatchUps`
- Produces: `policyChangePoints(points: { policy: {...} }[]): number[]` — 위반 건수가 바뀐 인덱스

- [ ] **Step 1: 마커 유도 함수를 chart-scale에 추가하고 테스트를 쓴다**

`scripts/test-chart-scale.ts`의 `console.log` 직전에 추가하고, import에 `policyChangePoints`를 넣는다.

```ts
// 정책 변경 마커 — R1·R2·R4는 마스터가 바뀔 때만 계단으로 변한다. 변한 지점만 세로선으로 찍는다.
const p = (r1: number, r2: number, r3: number, r4: number) => ({ policy: { r1, r2, r3, r4 } });
assert.deepEqual(policyChangePoints([]), [], "표본 없음");
assert.deepEqual(policyChangePoints([p(0, 0, 0, 0)]), [], "첫 점은 변화가 아니다");
assert.deepEqual(policyChangePoints([p(10, 0, 0, 0), p(10, 0, 0, 0)]), [], "그대로면 마커 없음");
assert.deepEqual(policyChangePoints([p(10, 0, 0, 0), p(0, 0, 0, 0)]), [1], "줄어든 지점에 마커");
assert.deepEqual(policyChangePoints([p(0, 0, 0, 0), p(0, 5, 0, 0), p(0, 5, 0, 2)]), [1, 2], "어느 규칙이든 변하면 마커");
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx scripts/test-chart-scale.ts`
Expected: FAIL — `policyChangePoints is not a function`

- [ ] **Step 3: 구현**

`src/app/(dashboard)/trends/chart-scale.ts` 끝에 추가한다.

```ts
/**
 * 정책 위반 건수가 바뀐 지점의 인덱스.
 *
 * R1·R2·R4는 자재·창고 마스터가 바뀔 때만 값이 변한다 — 연속 곡선이 아니라 사건이다.
 * "ROP 37종을 고쳤더니 이후 결품 곡선이 꺾였는가"를 한 화면에서 읽게 하는 장치다.
 */
export function policyChangePoints(points: { policy: { r1: number; r2: number; r3: number; r4: number } }[]): number[] {
  const marks: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].policy;
    const b = points[i].policy;
    if (a.r1 !== b.r1 || a.r2 !== b.r2 || a.r3 !== b.r3 || a.r4 !== b.r4) marks.push(i);
  }
  return marks;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx scripts/test-chart-scale.ts`
Expected: `✅ chart scale passed`

- [ ] **Step 5: LineChart에 마커·공백 밴드 props 추가**

`LineChart.tsx`의 props에 두 개를 더한다.

```tsx
}: {
  series: LineSeries[]; xLabels: string[]; referencePct?: number | null; unit?: string; height?: number;
  markers?: number[]; gapBands?: [number, number][];
}) {
```

시그니처 기본값에 `markers = [], gapBands = []`를 넣고, `<g clipPath=...>` 바로 앞에 렌더를 추가한다.

```tsx
        {gapBands.map(([from, to], i) => (
          <rect key={i} x={x(from)} y={PAD.top} width={Math.max(x(to) - x(from), 2)} height={plotH}
                fill={GRID_INK} opacity={0.5} />
        ))}
        {markers.map((m) => (
          <line key={m} x1={x(m)} x2={x(m)} y1={PAD.top} y2={PAD.top + plotH}
                stroke="#7C3AED" strokeWidth={1} strokeDasharray="2 2" />
        ))}
```

- [ ] **Step 6: 화면에서 전달**

`TrendsClient.tsx`에서 import에 `policyChangePoints`를 추가하고, 생산·출하 `LineChart`에 넘긴다.

```tsx
import { policyChangePoints } from "./chart-scale";
```

```tsx
  const markers = policyChangePoints(points);
  // 벽시계 축에서 운영일이 건너뛴 구간 = 엔진 정지. catch-up 상한이 걸린 날이 그 증거다.
  const gapBands: [number, number][] = points
    .map((s, i) => (s.engine.clampedCatchUps > 0 && i > 0 ? [i - 1, i] as [number, number] : null))
    .filter((v): v is [number, number] => v !== null);
```

두 `LineChart`에 `markers={markers} gapBands={axis === "wall" ? gapBands : []}`를 추가한다.

- [ ] **Step 7: 검증과 커밋**

Run: `npx tsx scripts/test-chart-scale.ts && npm run typecheck 2>&1 | grep -v '^\.next/' | grep 'error TS'`
Expected: `✅ chart scale passed`, typecheck 오류 없음

```bash
git add "src/app/(dashboard)/trends" scripts/test-chart-scale.ts
git commit -m "feat(trends): 정책 변경 마커와 엔진 공백 밴드"
```

---

### Task 15: 전체 회귀와 문서 반영

**Files:**
- Modify: `src/app/(dashboard)/devlog/page.tsx`
- Modify: `docs/fab-operating-baseline.md`

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: 전체 테스트 회귀**

Run:
```bash
for t in test:operating-clock test:twin-lead-time test:inventory-policy test:procurement test:twin-inbound test:twin-burn test:twin-state test:contract-window test:daily-snapshot test:chart-scale; do
  printf "%-28s" "$t"; npx dotenv-cli -e .env -- npm run $t 2>&1 | tail -1
done
```
Expected: 전부 `✅` 로 끝난다. `test:operating-clock` npm script가 없으면 `package.json`에 `"test:operating-clock": "tsx scripts/test-operating-clock.ts"`를 추가한다.

- [ ] **Step 2: typecheck와 lint**

Run: `npm run typecheck 2>&1 | grep -v '^\.next/' | grep -c 'error TS'; npm run lint 2>&1 | tail -3`
Expected: typecheck 오류 0. lint는 착수 전 기준선(오류 1·경고 4, 전부 이번 작업과 무관한 파일)을 넘지 않는다.

- [ ] **Step 3: devlog에 Day 25 추가**

`src/app/(dashboard)/devlog/page.tsx`의 `LOGS` 배열 끝(`  ] },\n];` 앞)에 넣는다.

```tsx
  ] },
  { day: 25, date: "2026-08-18", label: "운영 트렌드 대시보드와 24배속 정합성 수정", color: "#B45309", items: [
    "24배속 감사 — 운영시계를 쓰는 쪽(WIP·소모·발주 ETA·최종테스트·자동출하 실행)은 정합했으나, 집계 창이 벽시계인 지점 두 곳에서 24배 오류가 나고 있었다. 계약 이행률은 벽시계 달력 월 창에 운영 24개월치를 모아 운영 1개월 계약으로 나눴고(실측 DRAM 6.5배·NAND 6.4배·HBM 3.8배 과대, 벽시계 월초마다 0으로 리셋되는 톱니), 공정별 사용량 실적은 30 벽시계일(= 운영 720일) 소모를 운영 1개월 설계치와 나란히 놓고 usageGap을 계산했다. 둘 다 운영시간 창으로 교체",
    "화면이 배속을 1×로 표시하던 것 정정 — twinState.speedMultiplier는 운영시계가 읽지 않는 사문화 필드인데 M20 노드밀도 카드가 그 값을 배속으로 렌더했다. 필드를 제거하고 OPERATING_SPEED_MULTIPLIER 표기로 교체",
    "approve-all-pending-pos의 simDaysPerTick 제거 — RULES가 금지한 tick 횟수 기반 시간 진행이 스크립트에 남아 있었다",
    "스케줄러 기동 취약점 수정 — register()가 두 동적 import를 모두 await한 뒤에야 startTwinScheduler를 불러서, 뒤쪽 import가 부팅 시 던지면 트윈 엔진이 조용히 안 떴다. 2026-08-12 22:35부터 132시간 tick 0회였던 사고의 유력한 경로다. 각 스케줄러를 독립 기동하고 실패를 이름과 함께 로깅",
    "운영 트렌드 화면 신설(/trends) — 생산 실산출률·자재 결품과 커버리지·창고 점유율·계약 이행률 4축을 운영일 축에 그린다. 재고 커버리지와 창고 점유는 상태라 이벤트로 과거를 복원할 수 없어, 엔진 tick이 운영일 경계를 넘을 때 twinDailySnapshots에 하루치를 확정 적재한다. 별도 스케줄러를 만들지 않은 건 RULES의 '기능별 독자 시계 금지' 때문이고, 운영시계를 이미 들고 있는 tick이 유일하게 옳은 위치다",
    "과거 백필은 하지 않는다 — 운영시계에 catch-up 상한이 있어 정지 공백이 잘리므로 벽↔운영 매핑이 구간별로 끊긴다(실측: 5.5 벽시계일 정지에 운영시각은 1일만 흐름). 과거 이벤트의 벽시계 tickAt에서 그 시점의 운영일을 되살릴 방법이 없다. 화면에 적재 시작일을 명시하는 쪽을 택했다",
    "엔진 정지가 그림에 드러나게 — 엔진이 멈추면 운영일이 안 넘어가 스냅샷도 안 생긴다. 벽시계 축으로 토글하면 그 구간이 공백 밴드로 보이고, 정책 변경 마커와 겹쳐 읽으면 '마스터를 고친 뒤 결품 곡선이 꺾였는가'가 한 화면에서 확인된다",
    "차트는 라이브러리 없이 인라인 SVG — 제품 계열 색(HBM #0078D4·DRAM #B5179E·NAND #0E9B8A)은 색약 검증 6항목 전부 통과(최악 인접쌍 deutan ΔE 9.8). 상태색은 예약이라 계열 색으로 쓰지 않는다",
  ] },
];
```

- [ ] **Step 4: baseline 문서의 다음 결정 사항 갱신**

`docs/fab-operating-baseline.md` §8에 한 줄 추가한다.

```markdown
3. R1~R4 위반 건수를 매일 스냅샷으로 남기고 있다(`twinDailySnapshots.policy`, 2026-08-18~). 지금은 엔진이 0으로 채워 넣으므로, `audit-agent-policy-consistency.ts`의 판정을 tick에서 직접 계산해 채우도록 옮길 것.
```

- [ ] **Step 5: 커밋**

```bash
git add "src/app/(dashboard)/devlog/page.tsx" docs/fab-operating-baseline.md package.json
git commit -m "docs: 운영 트렌드 대시보드와 24배속 수정 이력 반영"
```

---

## 알려진 한계

- **`policy` 필드는 현재 0으로 적재된다.** R1~R4 판정 로직은 `scripts/audit-agent-policy-consistency.ts`에 있고 tick에서 부르려면 그 순수 부분을 `src/lib`로 옮겨야 한다. Task 14의 마커는 값이 채워지면 즉시 동작하도록 만들어져 있다. 후속 작업으로 분리했다.
- **`baselineUtilization`도 0으로 적재된다.** R3의 기준선 예상 점유를 tick에서 계산하려면 같은 이동이 필요하다. 스파크라인의 95%·100% 임계선은 상수라 지금도 동작한다.
- **여러 운영일이 한꺼번에 완료되면(정지 후 catch-up) 그 날들은 같은 상태로 채워진다.** 실제 상태가 관측되지 않았기 때문이고, `engine.clampedCatchUps > 0`이 그 사실을 표시한다.
