# M20 실제 캐파 기반 WIP 엔진 Implementation Plan

> **2026-07-19 변경 주의:** 이 계획의 생산능력·WIP 개념은 [`docs/fab-master.md`](../../fab-master.md)로 승계되었다. 특히 Task 1의 "기존 HBM `processUsage.monthlyQty` 전체를 2.6배"하는 절차는 폐기되었으므로 실행하지 않는다. 자재량은 [`docs/material-consumption-master.md`](../../material-consumption-master.md)의 wafer당 원단위에서 시나리오별로 다시 산출해야 한다. 이 계획은 구현 이력과 AGGREGATE WIP 설계 참고용으로만 유지한다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M20(HBM)의 웨이퍼 로트(FOUP) 동시 재공재고(WIP)를, 실제 SK하이닉스 M16 공개 캐파 수치를 반영한 `nominalWspm`으로부터 Little's Law로 계산한 목표치(약 16,380개)까지 실제로 채워 돌아가게 만들고, 가동률을 실시간으로 조절할 수 있는 다이얼을 제공한다.

**Architecture:** 기존 12개 FOUP "시각 추적(VISUAL)" 코호트(`FOUP_CODES`, `ProcessFlow3D`, `LotRouteTrackerCard`)는 전혀 건드리지 않는다. 그 대신 `waferLots`에 `cohort: "AGGREGATE"`로 구분되는 새 로트 집단을 두고, 이벤트 원장(`waferLotStepEvents`) 없이 로트 문서에 `currentStepIndex`/`lastEventAt`을 비정규화해 저장하는 경량 진행 모델로 수만 개 규모를 감당한다. 가동률(`utilization`)은 `fabScenarios` 컬렉션에 저장되는 실시간 조절 값이고, 캐파 자체(`nominalWspm`)는 정적 코드 상수(실측 재보정)로 유지한다.

**Tech Stack:** Next.js App Router API routes, MongoDB(트랜잭션/bulkWrite), TypeScript. 유닛테스트 프레임워크가 없는 프로젝트라 `scripts/verify-*.ts`(assert 기반, 실제 DB에 대고 실행 후 자체 정리)를 TDD의 red/green 사이클 대체 수단으로 쓴다 — 이번 세션에서 이미 이 패턴으로 HU 분할 예약 버그를 고쳤다(`scripts/verify-hu-split-reservation.ts` 참고).

## Global Constraints

- DB 접근 스크립트는 반드시 `npx dotenv-cli -e .env -- npx tsx scripts/<name>.ts` 형태로 실행한다 (DATABASE_URL을 커맨드에 직접 노출하지 않는다).
- 기존 12개 VISUAL 코호트(`FOUP_CODES`, `getOrCreateActiveLot`, `listActiveLotStates`, `advanceLotStep`)는 이 플랜에서 코드를 수정하지 않는다 — 회귀 위험 제로를 유지한다.
- AGGREGATE 코호트 로트는 패키징 노드 진입 시에도 `createM20PilotWorkOrder`를 호출하지 않는다 — WMS/발주 에이전트 체인은 여전히 VISUAL 코호트(12개) 전용 스코프다. 자재 소비 트리거를 AGGREGATE로 확장하는 것은 이번 라운드 스코프 밖(패브가 "캠퍼스 신경망" 아이디어에서 이미 불가 판정).
- AGGREGATE 코호트는 `waferLotStepEvents`에 스텝별 감사 이벤트를 쓰지 않는다 — 수만 개 규모에서 이벤트 컬렉션이 무한 팽창하는 것을 피하기 위한 의도적 단순화이며, 진행 상태는 `WaferLotDoc.currentStepIndex`/`lastEventAt`에 직접 비정규화한다.
- 웜스타트 스텝 분포는 균등 랜덤(`Math.random() * totalSteps`)이다 — 노드별 실제 체류시간 가중치는 `RouteMasterNode`에 dwell 필드가 없어 이번 스코프에서 구현하지 않는다(향후 과제로 남김, 이미 이전 세션에서 합의).
- M21/M22는 이번 플랜에서 다루지 않는다(사용자 확정: "m21, 22는 순차적으로 할거야 20부터 확실히 하자"). `targetWipCount`/`ensureAggregateWip`는 fabId를 인자로 받는 범용 시그니처로 작성하되, 실제 동작은 M20으로 하드가드한다.
- 3D 개별 렌더링 확장은 이번 플랜 스코프 밖이다 — AGGREGATE 코호트는 `ProcessFlow3D`/`LotRouteTrackerCard`에 노출되지 않는다.

---

### Task 1: M20 nominalWspm 실측 재보정 + processUsage 비례 재조정

실제 SK하이닉스 M16(이천) 공개 캐파는 월 10만~17만장(전 세션 웹 리서치, 메모리 기록)이다. 지금 `FAB_SCENARIO`의 M20 `nominalWspm: 50_000`은 그 25~50%에 불과한 임의 모델링 값이다. 사용자가 "실제 M16 공개수치(10만~17만)로 상향"을 명시적으로 선택했으므로, 중간값인 130,000으로 올린다. 이 상수 하나로 `dailyPlanKWafer`/`utilizedMonthlyKWafer`가 자동으로 재계산되므로 `production-actuals.ts`/`daily-control-live.ts`/`control-tower.ts`는 코드 수정이 필요 없다(모두 매 요청마다 라이브 계산). 단, `prisma/seed.ts`에 하드코딩된 `processUsageData`의 HBM 행(`monthlyQty`)은 옛 50,000 기준으로 산정된 절대값이라 그대로 두면 "캐파는 2.6배 늘었는데 자재 원단위는 그대로"인 물리적으로 말이 안 되는 상태가 된다 — HBM 행만 비례(130,000/50,000 = 2.6배) 재조정하는 마이그레이션 스크립트가 필요하다.

**Files:**
- Modify: `src/lib/fab-scenario.ts:20`
- Modify: `scripts/test-fab-scenario.ts`
- Create: `scripts/scale-hbm-process-usage.ts`
- Modify: `package.json` (npm script 추가)

**Interfaces:**
- Produces: `FAB_SCENARIO` M20 엔트리 `nominalWspm: 130_000` — 이후 모든 Task가 이 값을 기준으로 계산.
- Produces: `HBM_WSPM_SCALE_RATIO = 130_000 / 50_000` 상수(스크립트 로컬, 재사용 없음).

- [ ] **Step 1: 재보정 전 기준값을 스크립트로 고정(RED 대신 "현재 값 확인")**

`scripts/test-fab-scenario.ts`는 이미 존재하는 assert 스크립트다. 수정 전 실행해서 지금 값(50,000 기준)이 통과하는 걸 확인한다.

Run: `npx tsx scripts/test-fab-scenario.ts`
Expected: `✅ fab scenario rules passed` (에러 없음)

- [ ] **Step 2: `FAB_SCENARIO`의 M20 `nominalWspm` 상향**

`src/lib/fab-scenario.ts:20`을 다음으로 교체:

```ts
  // 실측 재보정(2026-07-19): SK하이닉스 M16(이천) 공개 캐파는 월 10만~17만장(docs/route-master.md 리서치 근거) —
  // 중간값 채택. 기존 50,000은 임의 모델링 값이었음(MODELED_BASELINE).
  { id: "M20", name: "HBM Fab", product: "HBM", nominalWspm: 130_000, utilization: 0.90, waferYield: 0.85,
    marketReferenceWspm: 450_000, dimensionsM: { length: 330, width: 160, height: 105 }, color: "#EA002C" },
```

- [ ] **Step 3: `test-fab-scenario.ts`의 하드코딩 기대값을 새 계산치로 갱신**

M20: `utilizedWspm = 130_000 * 0.90 = 117_000`, `effectiveWspm = 117_000 * 0.85 = 99_450`, `waferEquivalentSharePct = 99_450 / 450_000 * 100 = 22.1`.
캠퍼스: `nominalWspm = 130_000 + 80_000 + 100_000 = 310_000`, `effectiveWspm = 99_450 + 66_240 + 79_200 = 244_890`.

`scripts/test-fab-scenario.ts` 전체를 다음으로 교체:

```ts
import { campusScenarioMetrics, FAB_SCENARIO, fabScenarioMetrics } from "../src/lib/fab-scenario";

const [m20, m21, m22] = FAB_SCENARIO.map(fabScenarioMetrics);
console.assert(Math.round(m20.effectiveWspm) === 99_450, "M20 유효 WSPM");
console.assert(Math.round(m21.effectiveWspm) === 66_240, "M21 유효 WSPM");
console.assert(Math.round(m22.effectiveWspm) === 79_200, "M22 유효 WSPM");
console.assert(Math.abs(m20.waferEquivalentSharePct - 22.1) < 0.05, "M20 설계비중");
const campus = campusScenarioMetrics();
console.assert(campus.nominalWspm === 310_000, "캠퍼스 명목 WSPM");
console.assert(Math.round(campus.effectiveWspm) === 244_890, "캠퍼스 유효 WSPM");
console.log("✅ fab scenario rules passed");
```

- [ ] **Step 4: 재보정 계산 검증**

Run: `npx tsx scripts/test-fab-scenario.ts`
Expected: `✅ fab scenario rules passed` (콘솔에 assert 실패 로그가 없어야 함 — `console.assert`는 실패해도 throw하지 않으므로 출력에 `Assertion failed` 문자열이 없는지 직접 확인)

- [ ] **Step 5: processUsage HBM 비례 재조정 스크립트 작성 (dry-run/--apply/--rollback 패턴)**

기존 `scripts/apply-opening-inventory-scaleup.ts`와 동일한 안전 패턴(기본 dry-run, `--apply`로만 실제 반영, `--rollback`으로 역산 가능)을 따른다.

Create `scripts/scale-hbm-process-usage.ts`:

```ts
import "dotenv/config";
import { collections } from "../src/lib/db";

const RATIO = 130_000 / 50_000; // FAB_SCENARIO M20 nominalWspm 재보정 비율(scripts/scale-hbm-process-usage.ts는 이 비율에 항상 종속)
const apply = process.argv.includes("--apply");
const rollback = process.argv.includes("--rollback");
const factor = rollback ? 1 / RATIO : RATIO;

async function main() {
  const { processUsage } = await collections();
  const rows = await processUsage.find({ product: "HBM" }).toArray();
  if (!rows.length) { console.log("[scale-hbm-usage] HBM processUsage 행이 없습니다."); return; }

  console.log(`[scale-hbm-usage] mode=${apply ? (rollback ? "ROLLBACK-APPLY" : "APPLY") : "DRY-RUN"} rows=${rows.length} factor=${factor.toFixed(4)}`);
  for (const row of rows) {
    const next = Math.round(row.monthlyQty * factor * 100) / 100;
    console.log(`${row.materialId}\t${row.processCode}\tcurrent=${row.monthlyQty}\tnext=${next}`);
  }
  if (!apply) { console.log("변경 없음. 실제 적용: npx dotenv-cli -e .env -- npx tsx scripts/scale-hbm-process-usage.ts -- --apply"); return; }

  const ops = rows.map((row) => ({
    updateOne: {
      filter: { _id: row._id, monthlyQty: row.monthlyQty },
      update: { $set: { monthlyQty: Math.round(row.monthlyQty * factor * 100) / 100 } },
    },
  }));
  const result = await processUsage.bulkWrite(ops, { ordered: false });
  console.log(`[scale-hbm-usage] applied modifiedCount=${result.modifiedCount}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
```

- [ ] **Step 6: `package.json`에 npm 스크립트 추가**

`package.json`의 `"db:scale-opening-inventory": "tsx scripts/apply-opening-inventory-scaleup.ts"` 줄 바로 아래에 추가:

```json
    ,"db:scale-hbm-usage": "tsx scripts/scale-hbm-process-usage.ts"
```

- [ ] **Step 7: dry-run 실행 후 사용자에게 diff 확인받기 (수동 체크포인트)**

Run: `npx dotenv-cli -e .env -- npx tsx scripts/scale-hbm-process-usage.ts`
Expected: HBM 자재별 `current`/`next` 목록 출력, "변경 없음" 안내. **이 출력을 사용자에게 보여주고 승인받은 뒤에만 다음 스텝(--apply)을 실행한다** — 실제 DB에 쓰기 전 확인이 필요한 지점.

- [ ] **Step 8: 승인 후 적용**

Run: `npx dotenv-cli -e .env -- npx tsx scripts/scale-hbm-process-usage.ts -- --apply`
Expected: `[scale-hbm-usage] applied modifiedCount=<rows와 동일한 수>`

- [ ] **Step 9: 커밋**

```bash
git add src/lib/fab-scenario.ts scripts/test-fab-scenario.ts scripts/scale-hbm-process-usage.ts package.json
git commit -m "feat: M20 nominalWspm을 실측 M16 공개수치(130,000)로 재보정, HBM processUsage 비례 조정"
```

---

### Task 2: `fabScenarios` 컬렉션 — 가동률 실시간 조회/수정

가동률(`utilization`)만 DB에 저장해 실시간으로 바꿀 수 있게 한다. `nominalWspm`은 Task 1에서 정적 상수로 재보정했으므로 여기서는 건드리지 않는다 — 실캐파(설비투자)와 가동률(운영 레버)을 분리하는 것이 현실 팹 운영과도 맞다.

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/lib/fab-scenario.ts`
- Test: `scripts/verify-fab-scenario-live.ts`

**Interfaces:**
- Consumes: `FAB_SCENARIO`, `FabScenario`, `fabScenarioMetrics` (Task 1에서 재보정된 값, `src/lib/fab-scenario.ts`).
- Produces: `getLiveFabScenario(fabId: FabId): Promise<FabScenario>`, `setFabUtilization(fabId: FabId, utilization: number, actorId: string): Promise<FabScenario>` — Task 8(API 라우트)이 그대로 호출.

- [ ] **Step 1: 실패하는 검증 스크립트 작성**

Create `scripts/verify-fab-scenario-live.ts`:

```ts
import "dotenv/config";
import assert from "node:assert/strict";
import { collections } from "../src/lib/db";
import { getLiveFabScenario, setFabUtilization } from "../src/lib/fab-scenario";

async function main() {
  const { fabScenarios } = await collections();
  await fabScenarios.deleteOne({ _id: "M20" });

  const before = await getLiveFabScenario("M20");
  assert.equal(before.utilization, 0.90, "DB에 문서가 없으면 정적 FAB_SCENARIO 값(0.90)으로 폴백해야 합니다");
  assert.equal(before.nominalWspm, 130_000, "nominalWspm은 항상 정적 값이어야 합니다");
  console.log("✅ 1) DB 문서 없을 때 정적값 폴백 확인");

  const updated = await setFabUtilization("M20", 0.75, "test-script");
  assert.equal(updated.utilization, 0.75);
  console.log("✅ 2) setFabUtilization 반환값 확인");

  const after = await getLiveFabScenario("M20");
  assert.equal(after.utilization, 0.75, "DB에 저장된 가동률이 반영되어야 합니다");
  assert.equal(after.nominalWspm, 130_000, "nominalWspm은 여전히 정적 값이어야 합니다");
  console.log("✅ 3) DB 저장 후 getLiveFabScenario 반영 확인");

  await assert.rejects(() => setFabUtilization("M20", 1.5, "test-script"), /가동률/, "1 초과 가동률은 거부되어야 합니다");
  console.log("✅ 4) 범위 밖 가동률 거부 확인");

  await fabScenarios.deleteOne({ _id: "M20" });
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npx dotenv-cli -e .env -- npx tsx scripts/verify-fab-scenario-live.ts`
Expected: `TypeError: getLiveFabScenario is not a function` (아직 구현 안 됨)

- [ ] **Step 3: `db.ts`에 `FabScenarioDoc` + 컬렉션 추가**

`src/lib/db.ts`의 `WaferLotStepEventDoc` 인터페이스(약 427행) 바로 아래에 추가:

```ts
export interface FabScenarioDoc {
  _id: FabId; // "M20" | "M21" | "M22"
  product: Product;
  utilization: number; // 실시간 조절 가능한 가동률(0~1). nominalWspm은 fab-scenario.ts의 정적 값을 그대로 씀.
  updatedAt: Date;
  updatedBy: string;
}
```

`collections()` 반환 타입(약 646행, `waferLotStepEvents: Collection<WaferLotStepEventDoc>;` 다음 줄)에 추가:

```ts
  fabScenarios: Collection<FabScenarioDoc>;
```

`collections()` 구현부(약 695행, `waferLotStepEvents: db.collection<WaferLotStepEventDoc>("waferLotStepEvents"),` 다음 줄)에 추가:

```ts
    fabScenarios: db.collection<FabScenarioDoc>("fabScenarios"),
```

- [ ] **Step 4: `fab-scenario.ts`에 라이브 조회/수정 함수 구현**

`src/lib/fab-scenario.ts` 맨 위에 import 추가:

```ts
import { collections } from "@/lib/db";
import type { FabId } from "@/lib/fab-domain";
```

파일 맨 아래(`campusScenarioMetrics` 함수 다음)에 추가:

```ts
export async function getLiveFabScenario(fabId: FabId): Promise<FabScenario> {
  const base = FAB_SCENARIO.find((entry) => entry.id === fabId);
  if (!base) throw new Error(`알 수 없는 fabId: ${fabId}`);
  const { fabScenarios } = await collections();
  const doc = await fabScenarios.findOne({ _id: fabId });
  if (!doc) return base;
  return { ...base, utilization: doc.utilization };
}

export async function setFabUtilization(fabId: FabId, utilization: number, actorId: string): Promise<FabScenario> {
  if (!Number.isFinite(utilization) || utilization <= 0 || utilization > 1) {
    throw new Error("가동률은 0 초과 1 이하여야 합니다.");
  }
  const base = FAB_SCENARIO.find((entry) => entry.id === fabId);
  if (!base) throw new Error(`알 수 없는 fabId: ${fabId}`);
  const { fabScenarios } = await collections();
  const now = new Date();
  await fabScenarios.updateOne(
    { _id: fabId },
    { $set: { product: base.product, utilization, updatedAt: now, updatedBy: actorId } },
    { upsert: true },
  );
  return { ...base, utilization };
}
```

- [ ] **Step 5: 다시 실행해서 통과 확인**

Run: `npx dotenv-cli -e .env -- npx tsx scripts/verify-fab-scenario-live.ts`
Expected: 4개 체크 모두 `✅` 출력

- [ ] **Step 6: 타입 체크**

Run: `npx tsc --noEmit -p .`
Expected: 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add src/lib/db.ts src/lib/fab-scenario.ts scripts/verify-fab-scenario-live.ts
git commit -m "feat: fabScenarios 컬렉션으로 가동률 실시간 조회/수정 지원"
```

---

### Task 3: 인덱스 추가 + `fabScenarios` 초기 시드

`waferLots`/`waferLotStepEvents`는 지금 인덱스가 전혀 없다(패브가 이전 세션에 지적) — AGGREGATE 코호트로 로트 수가 12개에서 수만 개로 뛰기 전에 반드시 선행돼야 한다.

**Files:**
- Create: `scripts/migrate-wafer-lot-wip-indexes.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `collections()` (`src/lib/db.ts`, Task 2에서 확장된 `fabScenarios` 포함).
- Produces: 없음(인프라 전용 마이그레이션, 이후 Task는 인덱스 존재를 전제로만 함).

- [ ] **Step 1: 마이그레이션 스크립트 작성**

Create `scripts/migrate-wafer-lot-wip-indexes.ts`:

```ts
import "dotenv/config";
import { collections } from "../src/lib/db";

async function main() {
  const { waferLots, waferLotStepEvents, fabScenarios } = await collections();

  await Promise.all([
    waferLots.createIndex({ fabId: 1, product: 1, foupCode: 1, status: 1 }),
    waferLots.createIndex({ fabId: 1, product: 1, cohort: 1, status: 1, lastEventAt: 1 }),
    waferLotStepEvents.createIndex({ lotId: 1, stepIndex: 1 }, { unique: true }),
    waferLotStepEvents.createIndex({ idempotencyKey: 1 }, { unique: true }),
  ]);
  console.log("✅ waferLots/waferLotStepEvents 인덱스 생성 완료");

  const now = new Date();
  for (const fab of [{ id: "M20" as const, product: "HBM" as const, utilization: 0.90 }]) {
    await fabScenarios.updateOne(
      { _id: fab.id },
      { $setOnInsert: { _id: fab.id, product: fab.product, utilization: fab.utilization, updatedAt: now, updatedBy: "SYSTEM_SEED" } },
      { upsert: true },
    );
  }
  console.log("✅ fabScenarios M20 초기 시드 완료(이미 있으면 유지)");
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
```

- [ ] **Step 2: `package.json`에 npm 스크립트 추가**

`"db:migrate-route-master": "tsx scripts/migrate-route-master.ts",` 다음 줄에 추가:

```json
    "db:migrate-wafer-lot-wip": "tsx scripts/migrate-wafer-lot-wip-indexes.ts",
```

- [ ] **Step 3: 실행**

Run: `npx dotenv-cli -e .env -- npx tsx scripts/migrate-wafer-lot-wip-indexes.ts`
Expected: 두 줄의 `✅` 로그

- [ ] **Step 4: 인덱스 생성 확인**

Run:
```bash
npx dotenv-cli -e .env -- npx tsx -e '
import { collections } from "./src/lib/db";
(async () => {
  const { waferLots, waferLotStepEvents } = await collections();
  console.log("waferLots", await waferLots.indexes());
  console.log("waferLotStepEvents", await waferLotStepEvents.indexes());
  process.exit(0);
})();
'
```
Expected: 각 컬렉션에 Step 1에서 정의한 인덱스가 `_id_` 기본 인덱스 외에 추가로 나열됨

- [ ] **Step 5: 커밋**

```bash
git add scripts/migrate-wafer-lot-wip-indexes.ts package.json
git commit -m "feat: waferLots/waferLotStepEvents 인덱스 추가 + fabScenarios M20 초기 시드"
```

---

### Task 4: Little's Law 기반 `targetWipCount` 순수 함수

**Files:**
- Modify: `src/lib/fab-scenario.ts`
- Modify: `src/lib/lot-route.ts`
- Test: `scripts/verify-target-wip-calc.ts`

**Interfaces:**
- Consumes: `FabScenario`, `fabScenarioMetrics` (`src/lib/fab-scenario.ts`).
- Produces: `WAFERS_PER_FOUP = 25`(`src/lib/fab-scenario.ts`), `targetWipCount(scenario: FabScenario, cycleDays: number, wafersPerFoup?: number): number`(`src/lib/fab-scenario.ts`), `M20_CYCLE_DAYS = 105`(`src/lib/lot-route.ts`) — Task 5의 `ensureAggregateWip`가 그대로 호출.

- [ ] **Step 1: 실패하는 검증 스크립트 작성**

Create `scripts/verify-target-wip-calc.ts`:

```ts
import assert from "node:assert/strict";
import { FAB_SCENARIO, targetWipCount } from "../src/lib/fab-scenario";
import { M20_CYCLE_DAYS } from "../src/lib/lot-route";

const m20 = FAB_SCENARIO.find((f) => f.id === "M20")!;
// utilizedWspm = 130,000 * 0.90 = 117,000 → dailyWaferStarts = 3,900 → dailyFoupStarts = 3,900/25 = 156/일 → ×105일
const target = targetWipCount(m20, M20_CYCLE_DAYS);
assert.equal(target, 16_380, `M20 목표 WIP 계산이 어긋났습니다: ${target}`);
console.log(`✅ M20 목표 WIP = ${target}개 (nominalWspm=${m20.nominalWspm}, utilization=${m20.utilization}, cycleDays=${M20_CYCLE_DAYS})`);

const half = targetWipCount({ ...m20, utilization: 0.45 }, M20_CYCLE_DAYS);
assert.equal(half, Math.round(target / 2), "가동률이 절반이면 목표 WIP도 절반이어야 합니다");
console.log(`✅ 가동률 0.45일 때 목표 WIP = ${half}개 (선형 비례 확인)`);
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npx tsx scripts/verify-target-wip-calc.ts`
Expected: `SyntaxError` 또는 `targetWipCount is not a function`/`M20_CYCLE_DAYS`가 `undefined` — 아직 구현 안 됨

- [ ] **Step 3: `fab-scenario.ts`에 `WAFERS_PER_FOUP`/`targetWipCount` 추가**

`src/lib/fab-scenario.ts`의 `fabScenarioMetrics` 함수 바로 다음에 추가:

```ts
// 300mm FOUP 표준 적재 용량(업계 공통 규격, MODELED_BASELINE) — 25장.
export const WAFERS_PER_FOUP = 25;

// Little's Law: 동시 WIP(개) = 일일 투입량(FOUP/일) × 공정 체류시간(일).
export function targetWipCount(scenario: FabScenario, cycleDays: number, wafersPerFoup: number = WAFERS_PER_FOUP): number {
  const { dailyWaferStarts } = fabScenarioMetrics(scenario);
  const dailyFoupStarts = dailyWaferStarts / wafersPerFoup;
  return Math.round(dailyFoupStarts * cycleDays);
}
```

- [ ] **Step 4: `lot-route.ts`에 `M20_CYCLE_DAYS` 추가**

`src/lib/lot-route.ts`의 `AUTO_ADVANCE_INTERVAL_MS` 선언 바로 다음에 추가:

```ts
// docs/route-master.md: 실제 웨이퍼 투입→패키징 완료는 약 3~4개월(90~120일) — 중간값 채택(MODELED_BASELINE).
export const M20_CYCLE_DAYS = 105;
```

- [ ] **Step 5: 다시 실행해서 통과 확인**

Run: `npx tsx scripts/verify-target-wip-calc.ts`
Expected: 두 `✅` 라인 출력, 목표 WIP 16,380 확인

- [ ] **Step 6: 타입 체크 + 커밋**

Run: `npx tsc --noEmit -p .`

```bash
git add src/lib/fab-scenario.ts src/lib/lot-route.ts scripts/verify-target-wip-calc.ts
git commit -m "feat: Little's Law 기반 M20 목표 WIP 계산 함수 추가"
```

---

### Task 5: `WaferLotDoc` AGGREGATE 코호트 확장 + 웜스타트 생성(`ensureAggregateWip`)

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/lib/lot-route.ts`
- Test: `scripts/verify-ensure-aggregate-wip.ts`

**Interfaces:**
- Consumes: `targetWipCount`, `WAFERS_PER_FOUP`(`src/lib/fab-scenario.ts`, Task 4), `M20_CYCLE_DAYS`(Task 4), `getLiveFabScenario`(Task 2), `getRouteMaster`/`expandRouteMaster`(`src/lib/route-master.ts`, 기존).
- Produces: `WaferLotDoc.cohort?: "AGGREGATE"`, `currentStepIndex?: number`, `currentNodeId?: string`, `lastEventAt?: Date`(`src/lib/db.ts`), `ensureAggregateWip(fabId: FabId, product: Product, actorId: string): Promise<{ targetWip: number; currentWip: number; created: number }>`(`src/lib/lot-route.ts`) — Task 6(`advanceAggregateWip`)과 Task 7(API 라우트)이 그대로 호출.

- [ ] **Step 1: 실패하는 검증 스크립트 작성**

Create `scripts/verify-ensure-aggregate-wip.ts`:

```ts
import "dotenv/config";
import assert from "node:assert/strict";
import { collections } from "../src/lib/db";
import { ensureAggregateWip } from "../src/lib/lot-route";

const ACTOR = "test-script:ensure-aggregate-wip";

async function main() {
  const { waferLots } = await collections();
  await waferLots.deleteMany({ fabId: "M20", product: "HBM", cohort: "AGGREGATE" });

  const result = await ensureAggregateWip("M20", "HBM", ACTOR);
  assert(result.targetWip > 0, "목표 WIP은 0보다 커야 합니다");
  assert(result.created > 0, "최초 호출은 부족분을 채워야 합니다");
  console.log(`✅ 1) 목표=${result.targetWip} 생성=${result.created}`);

  const lots = await waferLots.find({ fabId: "M20", product: "HBM", cohort: "AGGREGATE" }).toArray();
  assert.equal(lots.length, result.created);
  for (const lot of lots) {
    assert.equal(lot.status, "IN_PROGRESS");
    assert(typeof lot.currentStepIndex === "number" && lot.currentStepIndex >= 0, "currentStepIndex가 있어야 합니다");
    assert(lot.currentNodeId, "currentNodeId가 있어야 합니다");
    assert(lot.lastEventAt, "lastEventAt이 있어야 합니다");
  }
  console.log(`✅ 2) 생성된 ${lots.length}개 로트 모두 currentStepIndex/currentNodeId/lastEventAt 보유`);

  const distinctSteps = new Set(lots.map((l) => l.currentStepIndex)).size;
  assert(distinctSteps > 1, "웜스타트는 균등 랜덤 분포라 여러 스텝에 흩어져야 합니다");
  console.log(`✅ 3) ${distinctSteps}개의 서로 다른 스텝에 분포(웜스타트 확인)`);

  const { workOrders } = await collections();
  const aggregatePackagingWOs = await workOrders.countDocuments({ scope: "M20_PILOT", lotId: { $in: lots.map((l) => l._id) } });
  assert.equal(aggregatePackagingWOs, 0, "AGGREGATE 코호트는 패키징 진입해도 M20 파일럿 워크오더를 만들면 안 됩니다");
  console.log("✅ 4) AGGREGATE 코호트는 M20_PILOT 워크오더를 생성하지 않음 확인");

  // 실제 M20 목표(16,380개)는 배치 상한(1,000개)보다 훨씬 커서 한 번의 호출로는 절대 채워지지 않는다.
  // "목표 도달 후엔 추가 생성을 멈춘다"는 별도 로직을 여러 번 폴링해서 검증하는 대신,
  // 여기서는 목표치 부근까지 직접 시드해서 그 경계 조건만 싸게 확인한다(전체 수렴 과정은 Task 10 e2e에서 검증).
  await waferLots.insertMany(Array.from({ length: Math.max(0, result.targetWip - result.created) }, (_, i) => ({
    _id: `WLOT:M20:HBM:AGG:seed-topoff-${i}`, fabId: "M20" as const, product: "HBM" as const,
    routeMasterId: "M20:HBM", foupCode: `FOUP-WIP-SEED-${i}`, status: "IN_PROGRESS" as const, cohort: "AGGREGATE" as const,
    currentStepIndex: 0, currentNodeId: "seed", lastEventAt: new Date(), createdBy: ACTOR, createdAt: new Date(), updatedAt: new Date(),
  })));
  const second = await ensureAggregateWip("M20", "HBM", ACTOR);
  assert.equal(second.created, 0, "목표치에 도달한 뒤엔 재호출이 추가 생성을 하면 안 됩니다");
  console.log("✅ 5) 목표 도달 후 재호출 시 추가 생성 없음(직접 top-off로 경계 조건 재현)");

  await waferLots.deleteMany({ fabId: "M20", product: "HBM", cohort: "AGGREGATE" });
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npx dotenv-cli -e .env -- npx tsx scripts/verify-ensure-aggregate-wip.ts`
Expected: `ensureAggregateWip is not a function`

- [ ] **Step 3: `db.ts`의 `WaferLotDoc`에 필드 추가**

`src/lib/db.ts`의 `WaferLotDoc` 인터페이스(약 414행)를 다음으로 교체:

```ts
export interface WaferLotDoc {
  _id: string;
  fabId: FabId;
  product: Product;
  routeMasterId: string; // `${fabId}:${product}`
  foupCode: string; // 예: "FOUP-01" (VISUAL) 또는 "FOUP-WIP-xxxxx" (AGGREGATE)
  status: WaferLotStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  // AGGREGATE 코호트 전용 필드 — undefined면 기존 12개 VISUAL(3D 개별 추적) 로트.
  cohort?: "AGGREGATE";
  currentStepIndex?: number; // waferLotStepEvents 감사 이벤트 없이 진행 상태를 로트 문서에 직접 비정규화
  currentNodeId?: string;
  lastEventAt?: Date;
}
```

- [ ] **Step 4: `lot-route.ts`에 `ensureAggregateWip` 구현**

`src/lib/lot-route.ts` 맨 위 import에 추가:

```ts
import { randomUUID } from "crypto";
import { getLiveFabScenario, targetWipCount } from "@/lib/fab-scenario";
```

파일 맨 아래(`advanceLotStep` 함수 다음)에 추가:

```ts
const AGGREGATE_WIP_CREATE_BATCH_MAX = 1_000; // 한 번 호출에 만들 최대 로트 수 — 대량 생성 시 요청 지연 방지, 여러 번 폴링에 걸쳐 목표치까지 수렴

// M20/HBM 한정: 실제 WSPM(가동률 포함)로부터 Little's Law로 계산한 목표 WIP까지 AGGREGATE 코호트 로트를 채운다.
// 새로 만드는 로트는 균등 랜덤 스텝에 웜스타트(과거부터 가동 중이던 것처럼 currentStepIndex를 임의 배치)하고,
// 3D 개별 렌더링(VISUAL 코호트)이나 M20 파일럿 워크오더/WMS 체인과는 완전히 분리된 통계적 집단이다.
export async function ensureAggregateWip(fabId: FabId, product: Product, actorId: string): Promise<{ targetWip: number; currentWip: number; created: number }> {
  if (fabId !== "M20" || product !== "HBM") return { targetWip: 0, currentWip: 0, created: 0 };

  const { waferLots } = await collections();
  const scenario = await getLiveFabScenario(fabId);
  const target = targetWipCount(scenario, M20_CYCLE_DAYS);

  const routeMaster = await getRouteMaster(fabId, product);
  if (!routeMaster) return { targetWip: target, currentWip: 0, created: 0 };
  const visits = expandRouteMaster(routeMaster);
  const totalSteps = visits.length;
  if (totalSteps === 0) return { targetWip: target, currentWip: 0, created: 0 };

  const currentWip = await waferLots.countDocuments({ fabId, product, status: "IN_PROGRESS" });
  const shortfall = Math.max(0, target - currentWip);
  const toCreate = Math.min(shortfall, AGGREGATE_WIP_CREATE_BATCH_MAX);
  if (toCreate === 0) return { targetWip: target, currentWip, created: 0 };

  const now = new Date();
  const docs: WaferLotDoc[] = Array.from({ length: toCreate }, () => {
    const stepIndex = Math.floor(Math.random() * totalSteps);
    const visit = visits[stepIndex];
    const id = randomUUID();
    return {
      _id: `WLOT:${fabId}:${product}:AGG:${id}`,
      fabId, product, routeMasterId: `${fabId}:${product}`,
      foupCode: `FOUP-WIP-${id.slice(0, 8)}`,
      status: "IN_PROGRESS",
      cohort: "AGGREGATE",
      currentStepIndex: stepIndex,
      currentNodeId: visit.nodeId,
      lastEventAt: now,
      createdBy: actorId, createdAt: now, updatedAt: now,
    };
  });
  await waferLots.insertMany(docs);
  return { targetWip: target, currentWip: currentWip + toCreate, created: toCreate };
}
```

- [ ] **Step 5: 다시 실행해서 통과 확인**

Run: `npx dotenv-cli -e .env -- npx tsx scripts/verify-ensure-aggregate-wip.ts`
Expected: 5개 `✅` 출력 (첫 호출은 배치 상한(1,000개)까지만 생성하고, 목표 도달 후 정지하는 경계 조건은 직접 top-off로 재현해서 확인 — 처음부터 목표까지 실제로 수렴하는 전체 과정은 Task 10 e2e 스크립트가 검증한다)

- [ ] **Step 6: 타입 체크 + 커밋**

Run: `npx tsc --noEmit -p .`

```bash
git add src/lib/db.ts src/lib/lot-route.ts scripts/verify-ensure-aggregate-wip.ts
git commit -m "feat: AGGREGATE 코호트 웜스타트 생성(ensureAggregateWip) 추가"
```

---

### Task 6: AGGREGATE 코호트 진행(`advanceAggregateWip`) — 벌크, 패키징 트리거 제외

**Files:**
- Modify: `src/lib/lot-route.ts`
- Test: `scripts/verify-advance-aggregate-wip.ts`

**Interfaces:**
- Consumes: `AUTO_ADVANCE_INTERVAL_MS`(기존), `getRouteMaster`/`expandRouteMaster`(기존), `ensureAggregateWip`(Task 5).
- Produces: `advanceAggregateWip(fabId: FabId, product: Product): Promise<{ advanced: number; completed: number }>` — Task 7(API 라우트)이 그대로 호출.

- [ ] **Step 1: 실패하는 검증 스크립트 작성**

Create `scripts/verify-advance-aggregate-wip.ts`:

```ts
import "dotenv/config";
import assert from "node:assert/strict";
import { collections } from "../src/lib/db";
import { advanceAggregateWip, AUTO_ADVANCE_INTERVAL_MS } from "../src/lib/lot-route";

async function main() {
  const { waferLots } = await collections();
  const lotId = "WLOT:M20:HBM:AGG:test-advance";
  await waferLots.deleteOne({ _id: lotId });
  const staleTime = new Date(Date.now() - AUTO_ADVANCE_INTERVAL_MS - 1_000);
  await waferLots.insertOne({
    _id: lotId, fabId: "M20", product: "HBM", routeMasterId: "M20:HBM", foupCode: "FOUP-WIP-TEST",
    status: "IN_PROGRESS", cohort: "AGGREGATE", currentStepIndex: 5, currentNodeId: "placeholder",
    lastEventAt: staleTime, createdBy: "test", createdAt: staleTime, updatedAt: staleTime,
  });

  const result = await advanceAggregateWip("M20", "HBM");
  assert(result.advanced >= 1, "기한이 지난 로트는 진행되어야 합니다");
  console.log(`✅ 1) advanced=${result.advanced} completed=${result.completed}`);

  const after = await waferLots.findOne({ _id: lotId });
  assert.equal(after?.currentStepIndex, 6, "스텝이 1 증가해야 합니다");
  assert(after && after.lastEventAt.getTime() > staleTime.getTime(), "lastEventAt이 갱신되어야 합니다");
  console.log(`✅ 2) currentStepIndex=${after?.currentStepIndex}, lastEventAt 갱신 확인`);

  const notDue = await advanceAggregateWip("M20", "HBM");
  assert.equal(notDue.advanced, 0, "방금 갱신된 로트는 아직 기한이 안 됐으므로 다시 진행되면 안 됩니다");
  console.log("✅ 3) 기한 전 재호출 시 advanced=0");

  await waferLots.deleteOne({ _id: lotId });
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npx dotenv-cli -e .env -- npx tsx scripts/verify-advance-aggregate-wip.ts`
Expected: `advanceAggregateWip is not a function`

- [ ] **Step 3: `lot-route.ts`에 `advanceAggregateWip` 구현**

`ensureAggregateWip` 함수 다음에 추가:

```ts
const AGGREGATE_ADVANCE_BATCH_MAX = 2_000;

// AGGREGATE 코호트를 벌크로 한 스텝씩 진행시킨다. VISUAL 코호트(advanceLotStep)와 달리
// waferLotStepEvents를 쓰지 않고, packaging 노드 진입 시에도 createM20PilotWorkOrder를 절대 호출하지 않는다
// (자재 소비 트리거는 여전히 VISUAL 12개 전용 스코프).
export async function advanceAggregateWip(fabId: FabId, product: Product): Promise<{ advanced: number; completed: number }> {
  if (fabId !== "M20" || product !== "HBM") return { advanced: 0, completed: 0 };

  const { waferLots } = await collections();
  const routeMaster = await getRouteMaster(fabId, product);
  if (!routeMaster) return { advanced: 0, completed: 0 };
  const visits = expandRouteMaster(routeMaster);
  const totalSteps = visits.length;

  const due = await waferLots.find({
    fabId, product, cohort: "AGGREGATE", status: "IN_PROGRESS",
    lastEventAt: { $lte: new Date(Date.now() - AUTO_ADVANCE_INTERVAL_MS) },
  }).limit(AGGREGATE_ADVANCE_BATCH_MAX).toArray();
  if (due.length === 0) return { advanced: 0, completed: 0 };

  const now = new Date();
  let completed = 0;
  const ops = due.map((lot) => {
    const nextStep = (lot.currentStepIndex ?? 0) + 1;
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
  return { advanced: result.modifiedCount, completed };
}
```

- [ ] **Step 4: 다시 실행해서 통과 확인**

Run: `npx dotenv-cli -e .env -- npx tsx scripts/verify-advance-aggregate-wip.ts`
Expected: 3개 `✅` 출력

- [ ] **Step 5: 타입 체크 + 커밋**

Run: `npx tsc --noEmit -p .`

```bash
git add src/lib/lot-route.ts scripts/verify-advance-aggregate-wip.ts
git commit -m "feat: AGGREGATE 코호트 벌크 진행(advanceAggregateWip) 추가"
```

---

### Task 7: `GET /api/wafer-lots/aggregate-wip` 라우트

**Files:**
- Create: `src/app/api/wafer-lots/aggregate-wip/route.ts`

**Interfaces:**
- Consumes: `ensureAggregateWip`, `advanceAggregateWip`(`src/lib/lot-route.ts`, Task 5·6), `requireRole`/`WRITE_ROLES`(`src/lib/api-auth.ts`, 기존), `FAB_IDS`/`FabId`(`src/lib/fab-domain.ts`, 기존).
- Produces: `GET /api/wafer-lots/aggregate-wip?fabId=M20&product=HBM` → `{ targetWip, currentWip, created, advanced, completed }` — Task 9(UI)가 폴링.

- [ ] **Step 1: 라우트 작성**

Create `src/app/api/wafer-lots/aggregate-wip/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { advanceAggregateWip, ensureAggregateWip } from "@/lib/lot-route";
import { FAB_IDS, type FabId } from "@/lib/fab-domain";
import type { Product } from "@/lib/db";

export const dynamic = "force-dynamic";

const PRODUCTS: Product[] = ["HBM", "DRAM", "NAND"];

export async function GET(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const fabId = req.nextUrl.searchParams.get("fabId") as FabId | null;
  const product = req.nextUrl.searchParams.get("product") as Product | null;
  if (!fabId || !FAB_IDS.includes(fabId)) {
    return NextResponse.json({ error: "fabId는 M20/M21/M22 중 하나여야 합니다." }, { status: 400 });
  }
  if (!product || !PRODUCTS.includes(product)) {
    return NextResponse.json({ error: "product는 HBM/DRAM/NAND 중 하나여야 합니다." }, { status: 400 });
  }

  try {
    const ensured = await ensureAggregateWip(fabId, product, access.user.id);
    const advanced = await advanceAggregateWip(fabId, product);
    return NextResponse.json({
      targetWip: ensured.targetWip, currentWip: ensured.currentWip,
      created: ensured.created, advanced: advanced.advanced, completed: advanced.completed,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AGGREGATE WIP 조회 실패" }, { status: 409 });
  }
}
```

- [ ] **Step 2: 개발 서버로 수동 확인**

Run: `npm run dev` (백그라운드로 이미 떠 있지 않다면)

로그인된 브라우저 세션 또는 기존 쿠키를 사용해:
```bash
curl -s "http://localhost:3000/api/wafer-lots/aggregate-wip?fabId=M20&product=HBM" -H "Cookie: <개발 세션 쿠키>" | jq
```
Expected: `{ "targetWip": 16380, "currentWip": <0~1000>, "created": <최대 1000>, "advanced": 0, "completed": 0 }` (인증이 막히면 이 스텝은 Task 9에서 브라우저로 직접 확인하는 것으로 대체한다)

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/wafer-lots/aggregate-wip/route.ts
git commit -m "feat: AGGREGATE WIP 조회/진행 API 라우트 추가"
```

---

### Task 8: `GET/PATCH /api/fab-scenario/[fabId]` 라우트 — 가동률 다이얼 백엔드

**Files:**
- Modify: `src/lib/api-auth.ts`
- Create: `src/app/api/fab-scenario/[fabId]/route.ts`

**Interfaces:**
- Consumes: `getLiveFabScenario`/`setFabUtilization`/`fabScenarioMetrics`/`targetWipCount`(`src/lib/fab-scenario.ts`, Task 2·4), `M20_CYCLE_DAYS`(`src/lib/lot-route.ts`, Task 4).
- Produces: `GET /api/fab-scenario/[fabId]` → `{ scenario, metrics, targetWip }`, `PATCH /api/fab-scenario/[fabId]` body `{ utilization }` → 동일 shape — Task 9(UI)가 그대로 호출.

- [ ] **Step 1: `WRITE_ROLES`에 `fabScenario` 추가**

`src/lib/api-auth.ts`의 `WRITE_ROLES` 객체에서 `materialReroute: ["ADMIN", "MATERIALS"],` 다음 줄에 추가:

```ts
  fabScenario: ["ADMIN", "PRODUCTION"],
```

- [ ] **Step 2: 라우트 작성**

Create `src/app/api/fab-scenario/[fabId]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { FAB_IDS, type FabId } from "@/lib/fab-domain";
import { fabScenarioMetrics, getLiveFabScenario, setFabUtilization, targetWipCount } from "@/lib/fab-scenario";
import { M20_CYCLE_DAYS } from "@/lib/lot-route";

export const dynamic = "force-dynamic";

function targetWipFor(fabId: FabId, scenario: Awaited<ReturnType<typeof getLiveFabScenario>>) {
  return fabId === "M20" ? targetWipCount(scenario, M20_CYCLE_DAYS) : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ fabId: string }> }) {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;
  const { fabId } = await params;
  if (!FAB_IDS.includes(fabId as FabId)) return NextResponse.json({ error: "알 수 없는 fabId" }, { status: 400 });
  const scenario = await getLiveFabScenario(fabId as FabId);
  return NextResponse.json({
    scenario, metrics: fabScenarioMetrics(scenario), targetWip: targetWipFor(fabId as FabId, scenario),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ fabId: string }> }) {
  const access = await requireRole(WRITE_ROLES.fabScenario);
  if (access.error) return access.error;
  const { fabId } = await params;
  if (fabId !== "M20") return NextResponse.json({ error: "이번 단계에선 M20 가동률만 조절할 수 있습니다." }, { status: 400 });
  const body = await req.json() as { utilization?: number };
  if (typeof body.utilization !== "number") return NextResponse.json({ error: "utilization 필수" }, { status: 400 });
  try {
    const scenario = await setFabUtilization(fabId, body.utilization, access.user.id);
    return NextResponse.json({
      scenario, metrics: fabScenarioMetrics(scenario), targetWip: targetWipFor(fabId, scenario),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "업데이트 실패" }, { status: 400 });
  }
}
```

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit -p .`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/lib/api-auth.ts "src/app/api/fab-scenario/[fabId]/route.ts"
git commit -m "feat: 팹 가동률 조회/조절 API 라우트 추가"
```

---

### Task 9: `FabThroughputDial` UI — 가동률 슬라이더 + 목표/현재 WIP

**Files:**
- Create: `src/app/(dashboard)/usage/FabThroughputDial.tsx`
- Modify: `src/app/(dashboard)/usage/UsageClient.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /api/fab-scenario/M20`(Task 8), `GET /api/wafer-lots/aggregate-wip`(Task 7).
- Produces: `<FabThroughputDial fabId="M20" />` React 컴포넌트 — `UsageClient.tsx`의 M20 브랜치에 `LotRouteTrackerCard` 위에 배치.

- [ ] **Step 1: 컴포넌트 작성**

Create `src/app/(dashboard)/usage/FabThroughputDial.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import type { FabId } from "@/lib/fab-domain";

type ScenarioResponse = {
  scenario: { id: FabId; nominalWspm: number; utilization: number };
  metrics: { utilizedWspm: number; effectiveWspm: number; dailyWaferStarts: number };
  targetWip: number | null;
};
type AggregateWipResponse = { targetWip: number; currentWip: number; created: number; advanced: number; completed: number };

export default function FabThroughputDial({ fabId }: { fabId: FabId }) {
  const [scenario, setScenario] = useState<ScenarioResponse | null>(null);
  const [wip, setWip] = useState<AggregateWipResponse | null>(null);
  const [sliderValue, setSliderValue] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadScenario = useCallback(async () => {
    const response = await fetch(`/api/fab-scenario/${fabId}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as ScenarioResponse;
    setScenario(data);
  }, [fabId]);

  const loadWip = useCallback(async () => {
    const response = await fetch(`/api/wafer-lots/aggregate-wip?fabId=${fabId}&product=HBM`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as AggregateWipResponse;
    setWip(data);
  }, [fabId]);

  useEffect(() => {
    void loadScenario();
    const interval = window.setInterval(() => { if (!document.hidden) void loadWip(); }, 6_000);
    const initial = window.setTimeout(() => void loadWip(), 0);
    return () => { window.clearInterval(interval); window.clearTimeout(initial); };
  }, [loadScenario, loadWip]);

  const commitUtilization = async (value: number) => {
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/fab-scenario/${fabId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utilization: value }),
      });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? "저장 실패"); }
      const data = await response.json() as ScenarioResponse;
      setScenario(data);
      void loadWip();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  if (fabId !== "M20") return null;
  if (!scenario) return <div className="rounded-xl border border-[#D8DDE2] bg-white p-4 text-[11px] text-[#999]">가동 정보 로딩 중…</div>;

  const displayUtilization = sliderValue ?? scenario.scenario.utilization;
  const targetWip = scenario.targetWip ?? 0;
  const currentWip = wip?.currentWip ?? 0;
  const wipRatio = targetWip > 0 ? Math.min(1, currentWip / targetWip) : 0;
  const wipColor = wipRatio > 0.9 ? "#00B96B" : wipRatio > 0.5 ? "#F7A600" : "#EA002C";

  return (
    <div className="rounded-xl border border-[#D8DDE2] bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-black uppercase tracking-[0.08em] text-[#7D8790]">FAB THROUGHPUT · {fabId}</div>
        {saving && <span className="text-[9px] text-[#999]">저장 중…</span>}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <input
          type="range" min={0.1} max={1} step={0.01} value={displayUtilization}
          onChange={(event) => setSliderValue(Number(event.target.value))}
          onMouseUp={(event) => void commitUtilization(Number((event.target as HTMLInputElement).value))}
          onTouchEnd={(event) => void commitUtilization(Number((event.target as HTMLInputElement).value))}
          className="flex-1"
        />
        <span className="w-14 text-right font-mono text-sm font-black text-[#20262D]">{Math.round(displayUtilization * 100)}%</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-[10px]">
        <div>
          <div className="text-[#8A929A]">유효 WSPM</div>
          <div className="mt-0.5 font-mono text-sm font-black text-[#303840]">{Math.round(scenario.metrics.utilizedWspm).toLocaleString()}</div>
        </div>
        <div>
          <div className="text-[#8A929A]">목표 WIP</div>
          <div className="mt-0.5 font-mono text-sm font-black text-[#303840]">{targetWip.toLocaleString()}개</div>
        </div>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-[#8A929A]">현재 WIP</span>
          <span className="font-mono font-black" style={{ color: wipColor }}>{currentWip.toLocaleString()} / {targetWip.toLocaleString()}</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#F2F4F6]">
          <div className="h-full rounded-full transition-all" style={{ width: `${wipRatio * 100}%`, background: wipColor }} />
        </div>
      </div>
      {error && <div className="mt-2 text-[10px] font-bold text-[#EA002C]">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 2: `UsageClient.tsx`에 연결**

`src/app/(dashboard)/usage/UsageClient.tsx` 맨 위 import 목록에 추가:

```tsx
import FabThroughputDial from "./FabThroughputDial";
```

`{selectedFab === "M20" && <LotRouteTrackerCard fabId="M20" product="HBM" onLiveFoupsChange={setLiveFoups} />}` 줄(약 380행)을 다음으로 교체:

```tsx
          {selectedFab === "M20" && (
            <div className="flex flex-col gap-3">
              <FabThroughputDial fabId="M20" />
              <LotRouteTrackerCard fabId="M20" product="HBM" onLiveFoupsChange={setLiveFoups} />
            </div>
          )}
```

- [ ] **Step 3: 개발 서버에서 육안 확인**

Run: `npm run dev` (이미 떠 있지 않다면)

브라우저로 `/usage?fab=M20` 접속 (또는 FAB SCOPE에서 M20 선택) → `LotRouteTrackerCard` 위에 `FAB THROUGHPUT · M20` 카드가 보이는지, 슬라이더를 움직이면 유효 WSPM/목표 WIP 숫자가 바뀌는지, 놓으면 "저장 중…"이 잠깐 뜨고 목표 WIP이 갱신되는지, 6초 뒤 현재 WIP 진행바가 움직이기 시작하는지 확인. **이 스텝은 실제 브라우저 조작 후 결과를 사용자에게 보고한다(자동 스크린샷 도구가 없으면 육안 확인 결과를 텍스트로 보고).**

- [ ] **Step 4: 커밋**

```bash
git add "src/app/(dashboard)/usage/FabThroughputDial.tsx" "src/app/(dashboard)/usage/UsageClient.tsx"
git commit -m "feat: M20 가동률 다이얼 + 목표/현재 WIP UI 추가"
```

---

### Task 10: 엔드투엔드 검증 — VISUAL 코호트 무회귀 + AGGREGATE 코호트 목표 수렴

**Files:**
- Create: `scripts/verify-m20-wip-engine-e2e.ts`

**Interfaces:**
- Consumes: 이 플랜의 모든 이전 Task 산출물.
- Produces: 없음(검증 전용).

- [ ] **Step 1: 검증 스크립트 작성**

Create `scripts/verify-m20-wip-engine-e2e.ts`:

```ts
import "dotenv/config";
import assert from "node:assert/strict";
import { collections } from "../src/lib/db";
import { advanceAggregateWip, ensureAggregateWip, FOUP_CODES, listActiveLotStates } from "../src/lib/lot-route";

const ACTOR = "test-script:m20-wip-engine-e2e";

async function main() {
  const { waferLots } = await collections();

  // 1) 기존 12개 VISUAL 코호트는 그대로 동작해야 한다(무회귀).
  const visualBefore = await listActiveLotStates("M20", "HBM", ACTOR);
  assert.equal(visualBefore.length, FOUP_CODES.length, "VISUAL 코호트는 여전히 12개여야 합니다");
  assert(visualBefore.every((state) => state.lot.cohort === undefined), "VISUAL 로트는 cohort가 없어야 합니다");
  console.log(`✅ 1) VISUAL 코호트 ${visualBefore.length}개 무회귀 확인`);

  // 2) AGGREGATE 코호트를 여러 번 폴링해 목표치까지 수렴하는지 확인(배치 상한 1,000개씩).
  let last = await ensureAggregateWip("M20", "HBM", ACTOR);
  const target = last.targetWip;
  let rounds = 1;
  while (last.created > 0 && rounds < 30) {
    last = await ensureAggregateWip("M20", "HBM", ACTOR);
    rounds++;
  }
  const finalCount = await waferLots.countDocuments({ fabId: "M20", product: "HBM", cohort: "AGGREGATE", status: "IN_PROGRESS" });
  assert(finalCount >= target * 0.99, `목표(${target})에 근접해야 합니다: 실제=${finalCount}, rounds=${rounds}`);
  console.log(`✅ 2) ${rounds}회 폴링 후 AGGREGATE WIP ${finalCount}/${target}개 수렴 확인`);

  // 3) advanceAggregateWip는 아직 기한 전이라 즉시는 advanced=0이어야 한다.
  const advanceNow = await advanceAggregateWip("M20", "HBM");
  assert.equal(advanceNow.advanced, 0, "방금 생성된 로트는 AUTO_ADVANCE_INTERVAL_MS 전이라 진행되면 안 됩니다");
  console.log("✅ 3) 생성 직후에는 advanceAggregateWip가 진행시키지 않음 확인");

  // 4) 패키징 노드 진입에도 M20_PILOT 워크오더가 하나도 생기지 않았어야 한다(스코프 경계 확인).
  const { workOrders } = await collections();
  const aggregateLotIds = (await waferLots.find({ fabId: "M20", product: "HBM", cohort: "AGGREGATE" }).project({ _id: 1 }).toArray()).map((l) => l._id);
  const leakedWorkOrders = await workOrders.countDocuments({ scope: "M20_PILOT", lotId: { $in: aggregateLotIds } });
  assert.equal(leakedWorkOrders, 0, "AGGREGATE 코호트는 M20_PILOT 워크오더를 생성하면 안 됩니다");
  console.log("✅ 4) AGGREGATE 코호트발 M20_PILOT 워크오더 누수 없음 확인");

  console.log(`🎉 M20 WIP 엔진 전체 통과: VISUAL=${visualBefore.length}개(무회귀), AGGREGATE=${finalCount}/${target}개`);

  // 정리: 테스트로 생성된 AGGREGATE 로트를 지워 개발 DB를 깨끗하게 유지(선택 — 실사용 데모를 위해 남겨두고 싶다면 이 블록을 스킵).
  // await waferLots.deleteMany({ fabId: "M20", product: "HBM", cohort: "AGGREGATE" });

  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
```

- [ ] **Step 2: 실행**

Run: `npx dotenv-cli -e .env -- npx tsx scripts/verify-m20-wip-engine-e2e.ts`
Expected: 4개 `✅` + `🎉` 최종 라인. (최초 실행은 목표 16,380개를 1,000개씩 채우므로 17회 안팎 라운드 + `insertMany` 왕복 시간이 걸릴 수 있음 — 수 분 내 완료되지 않으면 `AGGREGATE_WIP_CREATE_BATCH_MAX`를 늘리는 것을 고려)

- [ ] **Step 3: 사용자에게 결과 보고 후 정리 여부 확인**

이 스크립트는 기본적으로 AGGREGATE 로트 16,380개를 개발 DB에 남겨둔다(데모용으로 유지할지, 지울지는 사용자 판단 — Step 1의 주석 처리된 `deleteMany` 블록을 사용자 지시에 따라 활성화할지 결정).

- [ ] **Step 4: 커밋**

```bash
git add scripts/verify-m20-wip-engine-e2e.ts
git commit -m "test: M20 WIP 엔진 엔드투엔드 검증 스크립트 추가"
```
