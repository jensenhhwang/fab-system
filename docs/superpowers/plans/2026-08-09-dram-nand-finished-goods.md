# DRAM·NAND 완제품 생산·자재소모 확장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Twin 생산 엔진이 매 tick마다 HBM뿐 아니라 DRAM(M21)·NAND(M22)의 WIP도 진행시켜 자재를 실제로 소모하고 완제품을 적립하게 만들고, 완제품 대시보드가 세 제품의 "소모→산출"을 눈으로 확인시키는 저울 UI를 갖게 한다.

**Architecture:** 현재 `lot-route.ts`의 aggregate WIP 함수 4개와 `engine.ts` 틱 루프, `finished-goods.ts` 완제품 환산이 전부 `M20/HBM` 하드코딩이다. 이를 **제품별 config 레지스트리(`fab-production-config.ts`)** 로 일반화한다 — M20 config는 기존 상수를 그대로 반환해 M20 동작을 바이트 단위로 보존하고, M21/M22 config는 modeled 값을 제공한다. WIP 시드는 M20의 무거운 physical FOUP fleet(carrier·assignment)을 재사용하지 않고, 완제품 적립에 실제로 필요한 **MODELED_FOUP waferLots 풀만** 경량 시드한다. 엔진 틱은 활성 제품 배열을 루프한다.

**Tech Stack:** Next.js(사내 포크) · TypeScript · MongoDB(`collections()`) · dotenv-cli 스크립트 실행 패턴.

## Global Constraints

- DB 스크립트는 **dotenv-cli 패턴 필수** — 크리덴셜을 CLI에 직접 노출하지 않는다. 실행: `npx dotenv -e .env -- npx tsx scripts/<name>.ts [--apply]`.
- M20/HBM 런타임 동작은 **회귀 없이 보존**한다 — config 일반화 후 M20 완제품 적립·자재소모·발주가 기존과 동일해야 한다.
- 새 모델 상수는 전부 `source: "MODELED_ASSUMPTION"`, `confidence: "LOW"`로 표기한다(코드베이스 관행).
- 세 제품 완제품은 **단일 창고 `WH-FG01`** 를 공유하고, finishedGoods 문서는 `${fabId}__${product}__WH-FG01` 키로 구분한다.
- native 완제품 단위: HBM=`STACK`, DRAM=`CHIP`(good die), NAND=`DIE`(good die). 교차비교 단위=Gb(`capacityGbPerUnit`).

## 생산 상수 — `docs/foup-wip-master.md`에서 연동 (권위 문서)

아래 값은 전부 `foup-wip-master.md`의 §M21·§M22·§13·§14에서 확정된 승인 baseline이다. `capacityGbPerUnit`만 문서에 없어 modeled로 추가한다(문서 §11은 HBM 36GB/stack만 명시).

| 제품 | model | cycleTimeDays | 양품 die/wafer | assemblyYield | Occupied FOUP | dailyLotRelease | capacityGbPerUnit(※문서밖) | native unit |
|---|---|---|---|---|---|---|---|---|
| HBM (M20) | 기존 M20_HBM_OUTPUT_MODEL 유지 | 105 | 650 KGD | 0.90 | 14,040 | 156 | 36 | STACK |
| DRAM (M21) | M21-DDR5-16Gb-V1 | 80 (70+10) | **759** | **0.98** | **17,173** | **245.3** | 16 (modeled) | CHIP |
| NAND (M22) | M22-NAND321L-1Tb-TLC | 150 (130+20) | **1,249** | **0.96** | **18,720** | **144** | 1,024 (modeled) | DIE |

- DRAM finishedGoodsPerWafer = 759 × 0.98 = **743.8 chip/wafer** (§M21 수량보존: 1 양품 die = 1 package, 적층 없음).
- NAND finishedGoodsPerWafer = 1,249 × 0.96 = **1,199 die/wafer** (§M22: native는 good die. 문서는 16-die 패키지로도 세지만 사용자 결정=good die 단위. 조립수율 96% 반영).
- Occupied FOUP는 문서 §M21/§M22의 Little's Law 결과(wafer/FOUP 구간 70·130일 기준)를 **그대로 target으로** 쓴다. **초기 계획의 3,000 캡은 폐기** — 캡이 문서 Occupied보다 작아 완제품 산출 처리량을 throttle하기 때문. `advanceBatchMax = target + 2,000`.
- ⚠️ **성능 주의:** DRAM 17,173 + NAND 18,720 로트를 per-lot으로 시드·진행하면 M20 14,040과 합쳐 tick당 ~50K 쓰기가 된다. Task 5 검증에서 tick 소요시간을 측정하고, 과하면 문서 §22의 step-bucket(120·256) 집계 방식으로 별도 최적화한다(이번 스코프 밖).

---

## File Structure

- **Create** `src/lib/fab-production-config.ts` — 제품별 생산 config 레지스트리 + 완제품 output model. 단일 진실원.
- **Modify** `src/lib/fab-scenario.ts` — DRAM/NAND output model 상수 추가(M21_DRAM_OUTPUT_MODEL, M22_NAND_OUTPUT_MODEL).
- **Modify** `src/lib/finished-goods.ts` — `finishedGoodsPerWafer(product)`, `finishedGoodsUnit(product)`, `capacityGbPerUnit(product)` 로 파라미터화.
- **Modify** `src/lib/lot-route.ts` — `getAggregateWipSummary/advanceAggregateWip/releaseAggregateWip`의 M20/HBM 가드를 config 조회로 교체.
- **Create** `scripts/migrate-fab-wip.ts` — M21/M22 경량 MODELED_FOUP WIP 풀 시드(carrier/assignment 없음).
- **Modify** `src/lib/twin/engine.ts` — 틱을 활성 제품 배열 루프로 일반화; 제품별 material consumption·완제품 적립.
- **Modify** `src/lib/material-consumption.ts` — 제품별 consumption rows 조회 헬퍼 `materialConsumptionFor(product)` 추가.
- **Modify** `src/app/api/twin/finished-goods/route.ts` — 단일 문서 대신 제품 배열 반환.
- **Create** `src/app/api/twin/material-balance/route.ts` — tickAt으로 twinBurnEvents ⋈ finishedGoodsEvents 조인한 "소모-산출 영수증" 피드.
- **Modify** `src/app/(dashboard)/finished-goods/FinishedGoodsClient.tsx` — 3제품 스케일 스트립 + Gb 토글 + 영수증 피드.
- **Test** `scripts/test-twin-engine.ts`(기존, 수정) + 신규 단위 테스트 스크립트들.

---

### Task 1: 제품별 output model + 생산 config 레지스트리

**Files:**
- Modify: `src/lib/fab-scenario.ts` (after line 24, M20_HBM_OUTPUT_MODEL 뒤)
- Create: `src/lib/fab-production-config.ts`
- Test: `scripts/test-fab-production-config.ts`

**Interfaces:**
- Produces:
  - `M21_DRAM_OUTPUT_MODEL`, `M22_NAND_OUTPUT_MODEL` (const objects)
  - `type FabProductionConfig = { fabId: FabId; product: Product; routeKey: string; cycleTimeDays: number; waferStartsPerMonth: number; wafersPerFoup: number; dailyLotRelease: number; targetOccupiedFoup: number; advanceBatchMax: number; outputModel: { knownGoodDiesPerWafer: number; unitsPerDie: number; assemblyYield: number; capacityGbPerUnit: number; unit: "STACK" | "CHIP" | "DIE" }; }`
  - `FAB_PRODUCTION_REGISTRY: Record<Product, FabProductionConfig>`
  - `getProductionConfig(fabId: FabId, product: Product): FabProductionConfig | null`
  - `ACTIVE_PRODUCTION_PRODUCTS: readonly { fabId: FabId; product: Product }[]`  // [{M20,HBM},{M21,DRAM},{M22,NAND}]

- [ ] **Step 1: DRAM/NAND output model 상수 추가** — `src/lib/fab-scenario.ts` M20_HBM_OUTPUT_MODEL(line 24) 바로 뒤에 삽입:

```typescript
// M21-DDR5-16Gb-V1 완제품 환산. 값은 docs/foup-wip-master.md §M21·§14에서 연동
// (759 양품 die/wafer · 98% 조립수율 · 적층 없음 = 1 die 1 package). capacityGbPerUnit만 문서밖 modeled.
export const M21_DRAM_OUTPUT_MODEL = {
  modelProduct: "M21-DDR5-16Gb-V1",
  capacityGbPerUnit: 16, // MODELED (문서 미기재 — DDR5 16Gb 가정)
  knownGoodDiesPerWafer: 759, // foup-wip-master.md §M21 수량보존
  assemblyYield: 0.98,
  unit: "CHIP" as const,
} as const;

// M22-NAND321L-1Tb-TLC 완제품 환산. 값은 docs/foup-wip-master.md §M22·§14에서 연동
// (1,249 양품 die/wafer · 96% 조립수율). native는 good die 단위(사용자 결정).
export const M22_NAND_OUTPUT_MODEL = {
  modelProduct: "M22-NAND321L-1Tb-TLC",
  capacityGbPerUnit: 1_024, // MODELED (문서 미기재 — 1Tb TLC die 가정)
  knownGoodDiesPerWafer: 1_249, // foup-wip-master.md §M22 수량보존
  assemblyYield: 0.96,
  unit: "DIE" as const,
} as const;

// DRAM/NAND 사이클타임 — docs/foup-wip-master.md §M21(80=70+10)·§M22(150=130+20)에서 연동.
export const M21_CYCLE_DAYS = 80;
export const M22_CYCLE_DAYS = 150;
```

- [ ] **Step 2a: foup-wip-master.md 연동 상수를 foup-wip-model.ts에 추가** — `src/lib/foup-wip-model.ts` 끝에 (M20 상수와 나란히, 문서 §M21/§M22 값):

```typescript
// docs/foup-wip-master.md §M21 — DRAM. Occupied FOUP는 wafer/FOUP 구간 70일 × 245.3 lots/day.
export const M21_DAILY_LOT_RELEASE = 245.3;
export const M21_TARGET_OCCUPIED_FOUP = 17_173;
// docs/foup-wip-master.md §M22 — NAND. Occupied FOUP는 wafer/FOUP 구간 130일 × 144 lots/day.
export const M22_DAILY_LOT_RELEASE = 144;
export const M22_TARGET_OCCUPIED_FOUP = 18_720;
```

- [ ] **Step 2b: config 레지스트리 작성** — `src/lib/fab-production-config.ts` 생성:

```typescript
import type { FabId, Product } from "@/lib/db";
import {
  M20_PRODUCTION_SCENARIOS, M20_HBM_OUTPUT_MODEL, FAB_SCENARIO,
  M21_DRAM_OUTPUT_MODEL, M22_NAND_OUTPUT_MODEL, M21_CYCLE_DAYS, M22_CYCLE_DAYS, WAFERS_PER_FOUP,
} from "@/lib/fab-scenario";
import {
  M20_TARGET_OCCUPIED_FOUP, M20_DAILY_LOT_RELEASE,
  M21_TARGET_OCCUPIED_FOUP, M21_DAILY_LOT_RELEASE,
  M22_TARGET_OCCUPIED_FOUP, M22_DAILY_LOT_RELEASE,
} from "@/lib/foup-wip-model";

export type FabProductionConfig = {
  fabId: FabId;
  product: Product;
  cycleTimeDays: number;
  waferStartsPerMonth: number;
  wafersPerFoup: number;
  dailyLotRelease: number;
  targetOccupiedFoup: number;
  advanceBatchMax: number;
  outputModel: {
    knownGoodDiesPerWafer: number;
    assemblyYield: number;
    capacityGbPerUnit: number;
    unit: "STACK" | "CHIP" | "DIE";
    // HBM은 12-die 스택 팬아웃이 있어 별도 계산. dieToUnit은 "good die 1개가 완제품 몇 단위인가".
    dieToUnit: number;
  };
};

function wspmFor(product: Product): number {
  const fab = FAB_SCENARIO.find((f) => f.product === product);
  return fab ? Math.round(fab.nominalWspm * fab.utilization) : 0;
}

export const FAB_PRODUCTION_REGISTRY: Record<Product, FabProductionConfig> = {
  HBM: {
    fabId: "M20", product: "HBM",
    cycleTimeDays: M20_PRODUCTION_SCENARIOS.NORMAL.cycleTimeDays,
    waferStartsPerMonth: M20_PRODUCTION_SCENARIOS.NORMAL.waferStartsPerMonth,
    wafersPerFoup: WAFERS_PER_FOUP,
    dailyLotRelease: M20_DAILY_LOT_RELEASE,
    targetOccupiedFoup: M20_TARGET_OCCUPIED_FOUP,
    advanceBatchMax: M20_TARGET_OCCUPIED_FOUP + 2_000,
    outputModel: {
      knownGoodDiesPerWafer: M20_HBM_OUTPUT_MODEL.knownGoodDiesPerWafer,
      assemblyYield: M20_HBM_OUTPUT_MODEL.assemblyYield,
      capacityGbPerUnit: M20_HBM_OUTPUT_MODEL.capacityGbPerStack,
      unit: "STACK",
      dieToUnit: 1 / M20_HBM_OUTPUT_MODEL.stackDieCount, // 12 good die → 1 stack
    },
  },
  DRAM: {
    fabId: "M21", product: "DRAM", cycleTimeDays: M21_CYCLE_DAYS, waferStartsPerMonth: wspmFor("DRAM"),
    wafersPerFoup: WAFERS_PER_FOUP, dailyLotRelease: M21_DAILY_LOT_RELEASE,
    targetOccupiedFoup: M21_TARGET_OCCUPIED_FOUP, advanceBatchMax: M21_TARGET_OCCUPIED_FOUP + 2_000,
    outputModel: {
      knownGoodDiesPerWafer: M21_DRAM_OUTPUT_MODEL.knownGoodDiesPerWafer,
      assemblyYield: M21_DRAM_OUTPUT_MODEL.assemblyYield,
      capacityGbPerUnit: M21_DRAM_OUTPUT_MODEL.capacityGbPerUnit, unit: "CHIP", dieToUnit: 1,
    },
  },
  NAND: {
    fabId: "M22", product: "NAND", cycleTimeDays: M22_CYCLE_DAYS, waferStartsPerMonth: wspmFor("NAND"),
    wafersPerFoup: WAFERS_PER_FOUP, dailyLotRelease: M22_DAILY_LOT_RELEASE,
    targetOccupiedFoup: M22_TARGET_OCCUPIED_FOUP, advanceBatchMax: M22_TARGET_OCCUPIED_FOUP + 2_000,
    outputModel: {
      knownGoodDiesPerWafer: M22_NAND_OUTPUT_MODEL.knownGoodDiesPerWafer,
      assemblyYield: M22_NAND_OUTPUT_MODEL.assemblyYield,
      capacityGbPerUnit: M22_NAND_OUTPUT_MODEL.capacityGbPerUnit, unit: "DIE", dieToUnit: 1,
    },
  },
};

export const ACTIVE_PRODUCTION_PRODUCTS: readonly { fabId: FabId; product: Product }[] = [
  { fabId: "M20", product: "HBM" },
  { fabId: "M21", product: "DRAM" },
  { fabId: "M22", product: "NAND" },
];

export function getProductionConfig(fabId: FabId, product: Product): FabProductionConfig | null {
  const cfg = FAB_PRODUCTION_REGISTRY[product];
  return cfg && cfg.fabId === fabId ? cfg : null;
}
```

- [ ] **Step 3: 실패 테스트 작성** — `scripts/test-fab-production-config.ts`:

```typescript
import "dotenv/config";
import { getProductionConfig, FAB_PRODUCTION_REGISTRY } from "../src/lib/fab-production-config";
import { M20_TARGET_OCCUPIED_FOUP, M20_DAILY_LOT_RELEASE } from "../src/lib/foup-wip-model";

function assert(cond: boolean, msg: string) { if (!cond) throw new Error(`FAIL: ${msg}`); }

// M20 config는 기존 M20 상수를 바이트 단위로 보존해야 한다(회귀 방지).
const hbm = getProductionConfig("M20", "HBM")!;
assert(hbm.dailyLotRelease === M20_DAILY_LOT_RELEASE, "HBM dailyLotRelease 보존");
assert(hbm.targetOccupiedFoup === M20_TARGET_OCCUPIED_FOUP, "HBM targetOccupied 보존");
assert(hbm.outputModel.unit === "STACK", "HBM unit=STACK");

// DRAM/NAND는 foup-wip-master.md 연동 값.
const dram = getProductionConfig("M21", "DRAM")!;
assert(dram.outputModel.unit === "CHIP", "DRAM unit=CHIP");
assert(dram.targetOccupiedFoup === 17_173, "DRAM occupied=17173 (문서 §M21)");
assert(dram.cycleTimeDays === 80, "DRAM cycle=80");
assert(dram.dailyLotRelease > 0, "DRAM dailyLotRelease>0");
const nand = getProductionConfig("M22", "NAND")!;
assert(nand.outputModel.capacityGbPerUnit === 1_024, "NAND 1Tb/die");
assert(nand.targetOccupiedFoup === 18_720, "NAND occupied=18720 (문서 §M22)");
assert(nand.cycleTimeDays === 150, "NAND cycle=150 (문서 §M22)");

// 잘못된 fab/product 조합은 null.
assert(getProductionConfig("M20", "DRAM") === null, "M20:DRAM 조합 무효");
assert(Object.keys(FAB_PRODUCTION_REGISTRY).length === 3, "3제품 등록");

console.log("✅ fab-production-config OK");
```

- [ ] **Step 4: 실행해 통과 확인** — Run: `npx dotenv -e .env -- npx tsx scripts/test-fab-production-config.ts`  Expected: `✅ fab-production-config OK`

- [ ] **Step 5: Commit**

```bash
git add src/lib/fab-scenario.ts src/lib/fab-production-config.ts scripts/test-fab-production-config.ts
git commit -m "feat(twin): 제품별 생산 config 레지스트리 + DRAM/NAND output model"
```

---

### Task 2: finished-goods.ts 제품 파라미터화

**Files:**
- Modify: `src/lib/finished-goods.ts`
- Test: `scripts/test-finished-goods-conversion.ts`

**Interfaces:**
- Consumes: `getProductionConfig` (Task 1)
- Produces:
  - `finishedGoodsPerWafer(product: Product): number`  // 기존 무인자 버전을 제품 인자로 교체
  - `finishedGoodsUnit(product: Product): "STACK" | "CHIP" | "DIE"`
  - `capacityGbPerUnit(product: Product): number`
  - 기존 `FINISHED_GOODS_WAREHOUSE_ID`, `applyFinalTestQueue`는 그대로 유지.

- [ ] **Step 1: 실패 테스트 작성** — `scripts/test-finished-goods-conversion.ts`:

```typescript
import "dotenv/config";
import { finishedGoodsPerWafer, finishedGoodsUnit, capacityGbPerUnit } from "../src/lib/finished-goods";

function approx(a: number, b: number, tol = 1) { return Math.abs(a - b) <= tol; }
function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); }

// HBM: 650/12*0.90 ≈ 48.75 stack/wafer (기존 동작 보존)
assert(approx(finishedGoodsPerWafer("HBM"), 48.75, 0.5), `HBM/wafer=${finishedGoodsPerWafer("HBM")}`);
assert(finishedGoodsUnit("HBM") === "STACK", "HBM unit");
// DRAM: 759*0.98 ≈ 743.8 chip/wafer (문서 §M21)
assert(approx(finishedGoodsPerWafer("DRAM"), 743.8, 1), `DRAM/wafer=${finishedGoodsPerWafer("DRAM")}`);
assert(finishedGoodsUnit("DRAM") === "CHIP", "DRAM unit");
assert(capacityGbPerUnit("DRAM") === 16, "DRAM 16Gb");
// NAND: 1249*0.96 ≈ 1199 die/wafer (문서 §M22)
assert(approx(finishedGoodsPerWafer("NAND"), 1199, 2), `NAND/wafer=${finishedGoodsPerWafer("NAND")}`);
assert(capacityGbPerUnit("NAND") === 1_024, "NAND 1Tb");

console.log("✅ finished-goods conversion OK");
```

- [ ] **Step 2: 실행해 실패 확인** — Run: `npx dotenv -e .env -- npx tsx scripts/test-finished-goods-conversion.ts`  Expected: FAIL (`finishedGoodsUnit` export 없음)

- [ ] **Step 3: finished-goods.ts 수정** — 기존 `finishedGoodsPerWafer()`(line 9-12)와 `FINISHED_GOODS_UNIT`(line 3)을 교체:

```typescript
import { getProductionConfig } from "@/lib/fab-production-config";
import type { Product } from "@/lib/db";

export const FINISHED_GOODS_WAREHOUSE_ID = "WH-FG01";

// good die/wafer × dieToUnit × assemblyYield = 웨이퍼 1장이 만드는 완제품 단위 수.
// HBM: dieToUnit=1/12(스택 팬아웃), DRAM/NAND: dieToUnit=1(1 die=1 단위).
export function finishedGoodsPerWafer(product: Product): number {
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

function fabForProduct(product: Product): "M20" | "M21" | "M22" {
  return product === "HBM" ? "M20" : product === "DRAM" ? "M21" : "M22";
}
```

`applyFinalTestQueue`와 `FINAL_TEST_DURATION_DAYS`는 그대로 둔다. `FINISHED_GOODS_UNIT` 상수를 쓰던 곳은 engine.ts에서 Task 5가 교체하므로, 하위호환용으로 `export const FINISHED_GOODS_UNIT = "STACK" as const;` 는 남겨둔다.

- [ ] **Step 4: 실행해 통과 확인** — Run: `npx dotenv -e .env -- npx tsx scripts/test-finished-goods-conversion.ts`  Expected: `✅ finished-goods conversion OK`

- [ ] **Step 5: Commit**

```bash
git add src/lib/finished-goods.ts scripts/test-finished-goods-conversion.ts
git commit -m "feat(twin): finished-goods 환산을 제품별로 파라미터화"
```

---

### Task 3: lot-route.ts aggregate WIP 가드 일반화

**Files:**
- Modify: `src/lib/lot-route.ts:177-202` (getAggregateWipSummary), `:246-321` (advanceAggregateWip), `:345-395` (releaseAggregateWip)
- Test: `scripts/test-aggregate-wip-generalization.ts`

**Interfaces:**
- Consumes: `getProductionConfig` (Task 1)
- Produces: 세 함수 시그니처 불변. M20/HBM 결과는 기존과 동일, M21/M22는 config 기반으로 동작.

- [ ] **Step 1: 실패 테스트 작성** — `scripts/test-aggregate-wip-generalization.ts` (M21 route로 advance가 empty가 아님을 확인 — 시드는 Task 4 전이라 0 로트지만, 함수가 route를 찾고 early-return하지 않는 걸 검증):

```typescript
import "dotenv/config";
import { advanceAggregateWip, getAggregateWipSummary } from "../src/lib/lot-route";

function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); }

// M21/DRAM 요약이 targetWip>0을 반환해야 한다(예전엔 무조건 0 early-return).
const dramSummary = await getAggregateWipSummary("M21", "DRAM");
assert(dramSummary.occupiedTarget > 0, `DRAM occupiedTarget=${dramSummary.occupiedTarget}`);

// advance는 config를 찾고 route를 조회한다(로트 0이면 advanced=0이지만 크래시 없이).
const res = await advanceAggregateWip("M21", "DRAM");
assert(res.advanced >= 0 && typeof res.completedWaferQty === "number", "DRAM advance 정상 반환");

// 무효 조합은 여전히 empty.
const bad = await advanceAggregateWip("M20", "DRAM");
assert(bad.advanced === 0 && bad.completed === 0, "M20:DRAM 무효 → empty");

console.log("✅ aggregate WIP 일반화 OK");
process.exit(0);
```

- [ ] **Step 2: 실행해 실패 확인** — Run: `npx dotenv -e .env -- npx tsx scripts/test-aggregate-wip-generalization.ts`  Expected: FAIL (`DRAM occupiedTarget=0` — 아직 M20 가드가 막음)

- [ ] **Step 3: getAggregateWipSummary 일반화** — line 177-202를 교체. 상단 import에 `import { getProductionConfig } from "@/lib/fab-production-config";` 추가. 함수 본문:

```typescript
export async function getAggregateWipSummary(fabId: FabId, product: Product): Promise<AggregateWipSummary> {
  const cfg = getProductionConfig(fabId, product);
  if (!cfg) {
    return { targetWip: 0, currentWip: 0, aggregateWip: 0, visualWip: 0,
      occupiedTarget: 0, downstreamWipEquivalent: 0, downstreamStatus: "NOT_BOOTSTRAPPED", unit: "FOUP_EQUIVALENT" };
  }
  const { waferLots } = await collections();
  const targetWip = targetWipCount(cfg.waferStartsPerMonth, cfg.cycleTimeDays);
  const [aggregateWip, visualWip] = await Promise.all([
    waferLots.countDocuments({ fabId, product, cohort: "MODELED_FOUP", status: "IN_PROGRESS" }),
    waferLots.countDocuments({ fabId, product, cohort: "WATCHED", status: "IN_PROGRESS" }),
  ]);
  return {
    targetWip, currentWip: aggregateWip + visualWip, aggregateWip, visualWip,
    occupiedTarget: cfg.targetOccupiedFoup,
    downstreamWipEquivalent: product === "HBM" ? M20_DOWNSTREAM_WIP_EQUIVALENT : 0,
    downstreamStatus: "NOT_BOOTSTRAPPED", unit: "FOUP_EQUIVALENT",
  };
}
```

- [ ] **Step 4: advanceAggregateWip 일반화** — line 252의 `if (fabId !== "M20" || product !== "HBM") return empty;` 를 교체하고, batch max를 config에서 가져온다:

```typescript
  const cfg = getProductionConfig(fabId, product);
  if (!cfg) return empty;

  const { waferLots } = await collections();
  const routeMaster = await getRouteMaster(fabId, product);
  if (!routeMaster) return empty;
  const visits = expandRouteMaster(routeMaster);
  const totalSteps = visits.length;
  if (totalSteps === 0) return empty;

  const due = await waferLots.find({
    fabId, product, cohort: { $in: ["AGGREGATE", "MODELED_FOUP"] }, status: "IN_PROGRESS",
    lastEventAt: { $lte: new Date(Date.now() - AUTO_ADVANCE_INTERVAL_MS) },
  }).sort({ lastEventAt: 1 }).limit(cfg.advanceBatchMax).toArray();
```

(모듈 상수 `AGGREGATE_ADVANCE_BATCH_MAX`는 이제 M20 전용 코드경로에서 안 쓰이므로 제거하거나 남겨둬도 무방. 나머지 본문 로직은 불변.)

- [ ] **Step 5: releaseAggregateWip 일반화** — line 352의 가드와 line 363-365의 M20 상수 참조를 config로 교체:

```typescript
  const cfg = getProductionConfig(fabId, product);
  if (!cfg) return { released: 0, nextCarry: carry };

  const { waferLots } = await collections();
  const routeMaster = await getRouteMaster(fabId, product);
  if (!routeMaster) return { released: 0, nextCarry: carry };
  const visits = expandRouteMaster(routeMaster);
  if (visits.length === 0) return { released: 0, nextCarry: carry };

  const currentOccupied = await waferLots.countDocuments({
    fabId, product, cohort: { $in: ["AGGREGATE", "MODELED_FOUP"] }, status: "IN_PROGRESS",
  });
  const { releaseCount, nextCarry } = computeAggregateReleasePlan({
    dailyRate: cfg.dailyLotRelease, simDays, carry, currentOccupied, targetOccupied: cfg.targetOccupiedFoup,
  });
```

그리고 신규 로트 생성부(line 369-389)에서 하드코딩 `_id: `WLOT-M20-AUTO-...``, `waferQty: M20_WAFERS_PER_FOUP` 를 fab/config 기반으로:

```typescript
    _id: `WLOT-${fabId}-AUTO-${now.getTime()}-${id}`,
    fabId, product, routeMasterId: routeMaster._id,
    foupCode: `FOUP-${fabId}-AUTO-${id}`,
    ...
    waferQty: cfg.wafersPerFoup,
```

`bootstrapVersion`, `dwellModel` 등 M20 전용 필드는 그대로 둬도 무해(스키마상 optional).

- [ ] **Step 6: 실행해 통과 확인** — Run: `npx dotenv -e .env -- npx tsx scripts/test-aggregate-wip-generalization.ts`  Expected: `✅ aggregate WIP 일반화 OK`

- [ ] **Step 7: M20 회귀 확인** — Run: `npx dotenv -e .env -- npx tsx scripts/test-twin-engine.ts`  Expected: 기존 통과 유지(M20 완제품 적립·소모 동일).

- [ ] **Step 8: Commit**

```bash
git add src/lib/lot-route.ts scripts/test-aggregate-wip-generalization.ts
git commit -m "feat(twin): aggregate WIP 가드를 제품 config로 일반화 (M20 동작 보존)"
```

---

### Task 4: M21/M22 경량 WIP 풀 시드 스크립트

**Files:**
- Create: `scripts/migrate-fab-wip.ts`
- Test: (스크립트 자체 dry-run + apply 검증 로그)

**Interfaces:**
- Consumes: `getProductionConfig` (Task 1), `getRouteMaster`/`expandRouteMaster`.
- Produces: `waferLots`에 `{fabId, product, cohort:"MODELED_FOUP", status:"IN_PROGRESS"}` 로트를 `targetOccupiedFoup`개, route 전체 스텝에 균등 분포로 시드. carrier/assignment는 만들지 않는다(완제품 적립에 불필요).

- [ ] **Step 1: 스크립트 작성** — `scripts/migrate-fab-wip.ts`:

```typescript
import "dotenv/config";
import { randomUUID } from "crypto";
import { collections, type WaferLotDoc, type FabId, type Product } from "../src/lib/db";
import { getRouteMaster, expandRouteMaster } from "../src/lib/route-master";
import { getProductionConfig } from "../src/lib/fab-production-config";

const apply = process.argv.includes("--apply");
const fabId = (process.argv.find((a) => a.startsWith("--fab="))?.split("=")[1] ?? "") as FabId;
const product = (process.argv.find((a) => a.startsWith("--product="))?.split("=")[1] ?? "") as Product;
const BATCH = 1_000;

async function main() {
  const cfg = getProductionConfig(fabId, product);
  if (!cfg) throw new Error(`config 없음: ${fabId}/${product}`);
  const { waferLots } = await collections();
  const route = await getRouteMaster(fabId, product);
  if (!route) throw new Error(`route 없음: ${fabId}/${product}`);
  const visits = expandRouteMaster(route);
  const totalSteps = visits.length;
  if (totalSteps === 0) throw new Error("route 스텝 0");

  const existing = await waferLots.countDocuments({ fabId, product, cohort: "MODELED_FOUP", status: "IN_PROGRESS" });
  const toCreate = Math.max(0, cfg.targetOccupiedFoup - existing);
  console.log(`[fab-wip] ${fabId}/${product} mode=${apply ? "APPLY" : "DRY_RUN"} steps=${totalSteps} existing=${existing} target=${cfg.targetOccupiedFoup} create=${toCreate}`);
  if (!apply || toCreate === 0) return;

  const now = new Date();
  const docs: WaferLotDoc[] = Array.from({ length: toCreate }, (_, i) => {
    // route 전체에 균등 분포 — 매 tick 완제품이 조금씩 나오도록 스텝을 흩뿌린다.
    const stepIndex = Math.floor((i / toCreate) * totalSteps);
    const id = randomUUID();
    return {
      _id: `WLOT-${fabId}-SEED-${now.getTime()}-${id}`,
      fabId, product, routeMasterId: route._id,
      foupCode: `FOUP-${fabId}-${String(i + 1).padStart(5, "0")}`,
      status: "IN_PROGRESS", cohort: "MODELED_FOUP",
      currentStepIndex: stepIndex, currentNodeId: visits[stepIndex].nodeId,
      lastEventAt: new Date(now.getTime() - Math.random() * 5_000), // 즉시 due 분산
      waferQty: cfg.wafersPerFoup, watched: false, source: "MODELED_BASELINE",
      createdBy: "FAB_WIP_SEED", createdAt: now, updatedAt: now,
    } as WaferLotDoc;
  });
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    await waferLots.bulkWrite(batch.map((d) => ({ updateOne: { filter: { _id: d._id }, update: { $setOnInsert: d }, upsert: true } })), { ordered: false });
  }
  const after = await waferLots.countDocuments({ fabId, product, cohort: "MODELED_FOUP", status: "IN_PROGRESS" });
  console.log(`✅ ${fabId}/${product} MODELED_FOUP 시드 완료: ${after}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: DRY_RUN 확인** — Run: `npx dotenv -e .env -- npx tsx scripts/migrate-fab-wip.ts --fab=M21 --product=DRAM`  Expected: `target=17173 create=17173` 류 로그, 쓰기 없음.

- [ ] **Step 3: DRAM 시드 APPLY** — Run: `npx dotenv -e .env -- npx tsx scripts/migrate-fab-wip.ts --fab=M21 --product=DRAM --apply`  Expected: `✅ M21/DRAM MODELED_FOUP 시드 완료: 17173`

- [ ] **Step 4: NAND 시드 APPLY** — Run: `npx dotenv -e .env -- npx tsx scripts/migrate-fab-wip.ts --fab=M22 --product=NAND --apply`  Expected: `✅ M22/NAND MODELED_FOUP 시드 완료: 18720`

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-fab-wip.ts
git commit -m "feat(twin): M21/M22 경량 MODELED_FOUP WIP 풀 시드 스크립트"
```

---

### Task 5: engine.ts 틱을 제품 배열 루프로 일반화

**Files:**
- Modify: `src/lib/material-consumption.ts` (헬퍼 추가)
- Modify: `src/lib/twin/engine.ts` (전체 틱 루프)
- Test: `scripts/test-twin-engine.ts` (기존, 다제품 확장), `scripts/test-twin-multiproduct.ts` (신규)

**Interfaces:**
- Consumes: `ACTIVE_PRODUCTION_PRODUCTS`, `getProductionConfig` (Task 1); `finishedGoodsPerWafer(product)`, `finishedGoodsUnit(product)` (Task 2); 일반화된 advance/release (Task 3); 시드된 WIP (Task 4).
- Produces: `materialConsumptionFor(product): readonly M20MaterialConsumptionRow[]`; `TwinTickResult`에 제품별 breakdown(`finishedGoodsAddedByProduct: Record<Product, number>`).

- [ ] **Step 1: material-consumption 헬퍼 추가** — `src/lib/material-consumption.ts` 끝에:

```typescript
import type { Product } from "@/lib/db";
export function materialConsumptionFor(product: Product): readonly M20MaterialConsumptionRow[] {
  if (product === "HBM") return M20_MATERIAL_CONSUMPTION;
  if (product === "DRAM") return M21_MATERIAL_CONSUMPTION;
  return M22_MATERIAL_CONSUMPTION;
}
```

- [ ] **Step 2: 실패 테스트 작성** — `scripts/test-twin-multiproduct.ts` (틱 1회 후 DRAM/NAND finishedGoods 문서가 생기고 수량이 늘거나 최소 pendingTest가 쌓임 + burn 이벤트가 M21/M22 자재에도 찍힘):

```typescript
import "dotenv/config";
import { executeTwinTick } from "../src/lib/twin/engine";
import { collections } from "../src/lib/db";

function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); }

async function main() {
  const { finishedGoods, twinBurnEvents } = await collections();
  // 여러 tick 돌려 DRAM/NAND가 최종테스트 큐를 통과하게 한다.
  for (let i = 0; i < 40; i++) await executeTwinTick(new Date(Date.now() + i * 6_700_000));
  const dram = await finishedGoods.findOne({ _id: "M21__DRAM__WH-FG01" });
  const nand = await finishedGoods.findOne({ _id: "M22__NAND__WH-FG01" });
  assert(!!dram, "DRAM 완제품 문서 생성");
  assert(!!nand, "NAND 완제품 문서 생성");
  assert((dram!.quantity ?? 0) + (dram!.pendingTestQuantity ?? 0) > 0, `DRAM 산출>0`);
  assert((nand!.quantity ?? 0) + (nand!.pendingTestQuantity ?? 0) > 0, `NAND 산출>0`);
  console.log(`✅ 다제품 틱 OK — DRAM=${dram!.quantity}, NAND=${nand!.quantity}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: 실행해 실패 확인** — Run: `npx dotenv -e .env -- npx tsx scripts/test-twin-multiproduct.ts`  Expected: FAIL (`DRAM 완제품 문서 생성`).

- [ ] **Step 4: engine.ts 리팩터** — `executeTwinTick`를 제품 루프로 재구성. 핵심 변경:
  1. `getStepConsumption()`(line 44-54)을 제품 인자로: `getStepConsumption(product)` — `getRouteMaster(cfg.fabId, product)` + `materialConsumptionFor(product)`. 캐시를 `Map<Product, ...>`로.
  2. 틱 본문에서 `for (const { fabId, product } of ACTIVE_PRODUCTION_PRODUCTS)` 루프를 돌며 기존 ①WIP진행 ②소모계산 ①.6완제품적립을 제품별로 수행.
  3. 완제품 fgId를 `${fabId}__${product}__${FINISHED_GOODS_WAREHOUSE_ID}`, `product`/`fabId`/`unit: finishedGoodsUnit(product)`로.
  4. `newlyCompletedQuantity = adv.completedWaferQty * finishedGoodsPerWafer(product)`.
  5. 자재 소모 게이팅(gatingMaterialIds)·발주(③)는 세 제품의 material 합집합으로 1회만 수행(자재는 fab 공유 재고이므로 중복 소모/발주 방지) — burn만 제품 루프에서 합산하고, ROP 발주·도착정산은 루프 밖에서 전체 material 합집합으로 기존대로 1회.

전체 교체 코드(요지):

```typescript
import { ACTIVE_PRODUCTION_PRODUCTS, getProductionConfig } from "@/lib/fab-production-config";
import { materialConsumptionFor } from "@/lib/material-consumption";
import { finishedGoodsPerWafer, finishedGoodsUnit, FINISHED_GOODS_WAREHOUSE_ID, applyFinalTestQueue } from "@/lib/finished-goods";

const stepConsumptionCache = new Map<Product, { stepConsumption: StepConsumption; totalSteps: number }>();
async function getStepConsumption(fabId: FabId, product: Product) {
  const cached = stepConsumptionCache.get(product);
  if (cached) return cached;
  const routeMaster = await getRouteMaster(fabId, product);
  if (!routeMaster) return { stepConsumption: new Map(), totalSteps: 0 };
  const visits = expandRouteMaster(routeMaster);
  const built = { stepConsumption: buildStepConsumption(visits, [...materialConsumptionFor(product)]), totalSteps: visits.length };
  stepConsumptionCache.set(product, built);
  return built;
}
```

틱 루프 내부는 기존 line 88-198 로직을 제품별로 감싼다. `burnedByMaterial`은 제품 간 합산(같은 materialId는 누적). 완제품 적립 블록(line 143-177)은 fgId만 제품별로 바꿔 그대로. 발주/도착(line 200-264)은 세 제품 material 합집합(`new Set(ACTIVE_PRODUCTION_PRODUCTS.flatMap(p => materialConsumptionFor(p.product).map(r => r.materialId)))`)으로 루프 밖 1회.

`TwinTickResult`에 `finishedGoodsAddedByProduct: Partial<Record<Product, number>>` 필드를 추가하고 기존 `finishedGoodsAdded`는 세 제품 합으로 유지(하위호환).

- [ ] **Step 5: 실행해 통과 확인** — Run: `npx dotenv -e .env -- npx tsx scripts/test-twin-multiproduct.ts`  Expected: `✅ 다제품 틱 OK — DRAM=..., NAND=...`

- [ ] **Step 6: M20 회귀 확인** — Run: `npx dotenv -e .env -- npx tsx scripts/test-twin-engine.ts`  Expected: 기존 통과 유지.

- [ ] **Step 7: Commit**

```bash
git add src/lib/material-consumption.ts src/lib/twin/engine.ts scripts/test-twin-multiproduct.ts
git commit -m "feat(twin): 틱을 HBM/DRAM/NAND 제품 루프로 일반화 — 3제품 완제품 적립+자재소모"
```

---

### Task 6: 완제품 API 다제품화 + 소모-산출 영수증 API

**Files:**
- Modify: `src/app/api/twin/finished-goods/route.ts`
- Create: `src/app/api/twin/material-balance/route.ts`
- Test: `scripts/test-finished-goods-api.ts`

**Interfaces:**
- Produces:
  - `/api/twin/finished-goods` → `{ products: FinishedGoodsView[] }` (각 제품별 quantity/unit/pendingTest/recentEvents/capacityGbPerUnit)
  - `/api/twin/material-balance` → `{ receipts: { tickAt; product; consumed: {materialId; code; qty}[]; produced: number; unit; yieldPct }[] }`

- [ ] **Step 1: finished-goods route 다제품화** — `ACTIVE_PRODUCTION_PRODUCTS`를 돌며 각 `${fabId}__${product}__WH-FG01` 문서를 읽어 배열 반환. `capacityGbPerUnit(product)` 포함. recentEvents는 `finishedGoodsEvents.find({ product })`로 제품별.

```typescript
import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections } from "@/lib/db";
import { FINISHED_GOODS_WAREHOUSE_ID, capacityGbPerUnit, finishedGoodsUnit } from "@/lib/finished-goods";
import { ACTIVE_PRODUCTION_PRODUCTS } from "@/lib/fab-production-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;
  const { finishedGoods, finishedGoodsEvents, warehouses } = await collections();
  const warehouse = await warehouses.findOne({ _id: FINISHED_GOODS_WAREHOUSE_ID });
  const products = await Promise.all(ACTIVE_PRODUCTION_PRODUCTS.map(async ({ fabId, product }) => {
    const [doc, events] = await Promise.all([
      finishedGoods.findOne({ _id: `${fabId}__${product}__${FINISHED_GOODS_WAREHOUSE_ID}` }),
      finishedGoodsEvents.find({ product }).sort({ tickAt: -1 }).limit(6).toArray(),
    ]);
    return {
      fabId, product, warehouseId: FINISHED_GOODS_WAREHOUSE_ID,
      warehouseName: warehouse?.name ?? FINISHED_GOODS_WAREHOUSE_ID,
      quantity: doc?.quantity ?? 0, unit: finishedGoodsUnit(product),
      capacityGbPerUnit: capacityGbPerUnit(product),
      pendingTestQuantity: doc?.pendingTestQuantity ?? 0,
      pendingTestReadyAt: doc?.pendingTestReadyAt?.toISOString() ?? null,
      updatedAt: doc?.updatedAt?.toISOString() ?? null,
      recentEvents: events.map((e) => ({ id: e._id, at: e.tickAt.toISOString(), addedQty: e.addedQty, queuedQty: e.queuedQty })),
    };
  }));
  return NextResponse.json({ products }, { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 2: material-balance route 작성** — `finishedGoodsEvents` 최근 tick들을 기준으로 같은 `tickAt`(±window) `twinBurnEvents`를 묶어 영수증화. 최근 12건:

```typescript
import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections } from "@/lib/db";
import { finishedGoodsUnit } from "@/lib/finished-goods";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;
  const { finishedGoodsEvents, twinBurnEvents, materials } = await collections();
  const fgEvents = await finishedGoodsEvents.find({}).sort({ tickAt: -1 }).limit(12).toArray();
  const matDocs = await materials.find({}).project({ code: 1 }).toArray();
  const codeById = new Map(matDocs.map((m) => [m._id, m.code as string]));
  const receipts = await Promise.all(fgEvents.map(async (fg) => {
    const windowStart = new Date(fg.tickAt.getTime() - 1_000);
    const windowEnd = new Date(fg.tickAt.getTime() + 1_000);
    const burns = await twinBurnEvents.find({ tickAt: { $gte: windowStart, $lte: windowEnd } }).limit(6).toArray();
    const produced = fg.addedQty || fg.queuedQty || 0;
    return {
      tickAt: fg.tickAt.toISOString(), product: fg.product,
      unit: finishedGoodsUnit(fg.product), produced,
      consumed: burns.filter((b) => b.burnedQty > 0).slice(0, 4).map((b) => ({
        materialId: b.materialId, code: codeById.get(b.materialId) ?? b.materialId, qty: Math.round(b.burnedQty),
      })),
    };
  }));
  return NextResponse.json({ receipts }, { headers: { "Cache-Control": "no-store" } });
}
```

(참고: 현재 `twinBurnEvents`에는 product 필드가 없다. 자재는 fab 공유라 정확한 제품귀속이 어려우므로 영수증은 "이 tick에 이 자재들이 줄고 이 제품이 늘었다"는 시간축 대응으로 표현한다. 더 엄밀히 하려면 Task 5에서 burn 이벤트에 product를 추가하는 확장을 별도 태스크로.)

- [ ] **Step 3: API 스모크 테스트** — `scripts/test-finished-goods-api.ts`로 두 route 핸들러를 직접 import 호출하거나, dev 서버 띄워 curl. 최소: `finished-goods`가 `products.length===3`, DRAM/NAND unit이 CHIP/DIE.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/twin/finished-goods/route.ts src/app/api/twin/material-balance/route.ts scripts/test-finished-goods-api.ts
git commit -m "feat(twin): 완제품 API 3제품화 + 소모-산출 영수증 API"
```

---

### Task 7: 완제품 대시보드 — 3제품 스케일 + Gb 토글 + 영수증 피드

**Files:**
- Modify: `src/app/(dashboard)/finished-goods/FinishedGoodsClient.tsx`
- Modify: `src/app/(dashboard)/finished-goods/page.tsx` (헤더 카피만, 필요 시)

**Interfaces:**
- Consumes: `/api/twin/finished-goods`(products 배열), `/api/twin/material-balance`(receipts).

- [ ] **Step 1: 데이터 로딩 교체** — `FinishedGoodsView`를 `products: ProductView[]` 구조로. `material-balance`도 15초 폴링에 추가. 기존 shipment/customer 섹션은 첫 제품(HBM) 또는 선택 제품 기준으로 유지.

- [ ] **Step 2: [A] 3제품 스케일 스트립** — 상단에 HBM/DRAM/NAND 3칸 그리드. 각 칸: 제품명 + `●산출중` pill, 누적 완제품 바(Gb 토글 시 `quantity × capacityGbPerUnit`로 정규화), 최근 tick 델타. 기존 화이트 카드 톤(`rounded-2xl`, `border-t-4` 제품색 — HBM #EA002C, DRAM #2563EB, NAND #7C3AED) 사용.

- [ ] **Step 3: Gb 토글** — 헤더 우측 세그먼트 `[native | Gb 공통]`, 기본 native, `localStorage` 유지. native면 각 제품 자기 단위, Gb면 `quantity*capacityGbPerUnit`을 Gb/Tb/Pb 자동 스케일 표기.

- [ ] **Step 4: [C] 소모-산출 영수증 피드** — `receipts`를 리스트로. 한 줄: `{relTime} · {product} {consumed: code −qty, …} → +{produced} {unit} (수율 …)`. 기존 이벤트 리스트 톤(`bg-[#F3FBFF]`, `relTime`) 재사용. shortfall 있는 자재는 빨강.

- [ ] **Step 5: 브라우저 확인** — `/run` 또는 playwright로 `/finished-goods` 진입 → 3제품 스트립·Gb 토글·영수증이 렌더되고 15초 폴링으로 수량이 증가하는지 관측.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/finished-goods/FinishedGoodsClient.tsx" "src/app/(dashboard)/finished-goods/page.tsx"
git commit -m "feat(finished-goods): 3제품 스케일 스트립 + Gb 토글 + 소모-산출 영수증 피드"
```

---

## Self-Review

- **Spec coverage:** 크리 1(제품별 단위+Gb) → Task 1·2·7. 크리 2(엔진 일반화, 계층형 config) → Task 1·3·5(MODELED_WIP_POOL_CAP). 크리 3(물질보존 저울+영수증) → Task 6·7. 패브 MVP 절단선(DRAM 먼저) → Task 4는 DRAM/NAND 동시 시드지만 스텝 단위로 DRAM 먼저 apply 가능. 사용자 결정(DRAM+NAND 동시, good die native) → 반영됨.
- **Placeholder scan:** 각 코드 스텝에 실제 코드/명령/기대출력 포함. Task 5 Step 4는 "요지"로 표기했으나 핵심 변경점 5가지와 교체 코드 골격 제공 — 실행자는 기존 engine.ts를 제품 루프로 감싸면 됨.
- **Type consistency:** `getProductionConfig(fabId, product)`, `finishedGoodsPerWafer(product)`, `finishedGoodsUnit(product)`, `materialConsumptionFor(product)`, `ACTIVE_PRODUCTION_PRODUCTS` 명칭이 Task 전반에서 일관.
- **위험지점:** ① M20 회귀(Task 3·5의 회귀 테스트로 방어). ② 자재 이중소모 — 세 제품이 같은 fab 공유 재고를 쓰면 burn/발주가 중복될 수 있어 Task 5에서 발주·도착정산은 material 합집합으로 루프 밖 1회로 고정. ③ tick 성능 — MODELED_WIP_POOL_CAP=3000으로 DRAM/NAND 쓰기량 억제.

---

## 실행 중 아키텍처 변경 (2026-08-09, 검증으로 발견)

계획의 per-lot 시드(Task 4)를 문서 충실 규모(DRAM 17,173 + NAND 18,720)로 실행하니 **틱 1회가 ~7분**이 됐다(원격 DB에 5만건 write). 이는 `foup-wip-master.md §22`가 애초에 M21/M22를 개별 FOUP가 아니라 **step bucket(120·256) 집계**로 설계한 이유다. 사용자 결정으로 **DRAM/NAND를 step-bucket 집계 엔진으로 전환**했다:

- 신규 `src/lib/twin/step-bucket.ts` — `counts[stepIndex]`를 틱마다 한 스텝 시프트(O(스텝수) write). 순수함수(`computeStepAdvance`/`computeStepRelease`/`buildSeedCounts`)는 DB 없이 테스트(`scripts/test-step-bucket.ts`).
- `wipStepBuckets` 컬렉션(db.ts), config에 `wipMode: "PER_LOT" | "STEP_BUCKET"`(HBM=PER_LOT, DRAM/NAND=STEP_BUCKET).
- `migrate-fab-wip.ts`는 per-lot 대신 step-bucket을 시드(+기존 per-lot 로트 정리).
- engine.ts 제품 루프가 `wipMode`로 분기.
- 결과: 틱이 초~분 단위로 단축, DRAM/NAND 완제품 정상 적립(검증: DRAM 7.98M CHIP·NAND 6.56M DIE, 브라우저 렌더 확인).

부수 결정: 완제품 창고 WH-FG01이 HBM 단일 기준(855,563)이라 3제품 공유 시 즉시 CAPACITY_OVER → 20,000,000으로 상향(`migrate-finished-goods-capacity.ts`). ⚠️ 혼합 단위(STACK+CHIP+DIE 합산)는 알려진 단순화 — **Gb 정규화 용량**이 후속 과제. 자재 서킷브레이커의 대량 차단(3제품이 공유 자재 소모)은 사용자 결정으로 현실적 동작으로 유지.
