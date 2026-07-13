# ERP 시뮬레이터 + 타임 액셀레이터 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제 MongoDB DB에 `simulated: true` 마킹으로 가상 ERP 사이클(발주→입고)과 FEFO 소비를 실시간으로 반영하는 타임 액셀레이터 시뮬레이터를 구축한다.

**Architecture:** DB 상태 기반 (`simState` 싱글턴). SSE 연결 시 서버에서 틱 루프 구동, 연결 해제 시 PAUSED 저장. 재접속 시 simDate 이어서 재개. 리셋 = `deleteMany({ simulated: true })`.

**Tech Stack:** Next.js App Router, MongoDB native driver, Server-Sent Events (ReadableStream), TypeScript, tsx (스크립트 실행)

## Global Constraints

- 서버 컴포넌트에서 자기 API 라우트 HTTP 호출 금지 — `collections()` 직접 쿼리
- 시뮬레이터가 생성하는 모든 문서에 `simulated: true` 필드 추가
- 리셋 대상 컬렉션: `inventoryLots`, `inventoryMovements`, `simPurchaseOrders`, `simEvents`
- `simState._id` = `"singleton"` (고정)
- PO ID 형식: `"PO-{Date.now()}-{materialId}"`
- SSE 헤더: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`
- 스타일: white card, `rounded-2xl shadow-sm`, accent `#0078D4`
- speedMultiplier interval 최소 50ms (클램프): `Math.max(50, Math.round(1000 / speedMultiplier))`
- `as never` 패턴 사용 금지 — 타입에 `simulated?: true` 필드를 추가해서 해결

---

## 파일 구조

```
src/lib/
  db.ts                          ← 수정: SimStateDoc, SimPurchaseOrderDoc, SimEventDoc 타입 + collections()
  sim-engine.ts                  ← 신규: processTick() 순수 함수
  sim-runner.ts                  ← 신규: executeTickAndPersist() DB 실행기

src/app/api/sim/
  state/route.ts                 ← 신규: GET simState
  start/route.ts                 ← 신규: POST start
  pause/route.ts                 ← 신규: POST pause
  reset/route.ts                 ← 신규: POST reset
  tick/route.ts                  ← 신규: POST 단일 틱
  jump/route.ts                  ← 신규: POST N일 점프
  stream/route.ts                ← 신규: GET SSE 스트림
  pos/route.ts                   ← 신규: GET + POST PO
  pos/[id]/delay/route.ts        ← 신규: POST 수동 지연
  pos/[id]/partial/route.ts      ← 신규: POST 수동 부분입고
  events/route.ts                ← 신규: GET 이벤트 로그

src/app/(dashboard)/simulation/
  SimControlPanel.tsx            ← 신규: 컨트롤 바 + 이벤트 피드 + PO 패널
  page.tsx                       ← 수정: SimControlPanel 추가

src/app/(dashboard)/inventory/
  page.tsx                       ← 수정: 시뮬 배지 추가

src/app/(dashboard)/wms/
  page.tsx                       ← 수정: 시뮬 배지 추가

scripts/
  test-sim-engine.ts             ← 신규: processTick 검증 스크립트
```

---

### Task 1: DB 타입 확장

**Files:**
- Modify: `src/lib/db.ts`

**Interfaces:**
- Produces: `SimStateDoc`, `SimPurchaseOrderDoc`, `SimEventDoc` 타입 + `collections()` 반환에 3개 컬렉션 추가

- [ ] **Step 1: `src/lib/db.ts`에 타입 추가**

기존 `BenefitCaseDoc` 인터페이스 바로 아래에 추가:

```ts
export interface SimStateDoc {
  _id: "singleton";
  status: "IDLE" | "RUNNING" | "PAUSED";
  simDate: Date;
  simStartDate: Date;
  realStartedAt: Date;
  speedMultiplier: number;
}

export interface SimPurchaseOrderDoc {
  _id: string;
  materialId: string;
  qty: number;
  status: "PENDING" | "IN_TRANSIT" | "RECEIVED" | "CANCELLED";
  createdSimDate: Date;
  expectedArrival: Date;
  actualArrival?: Date;
  leadTimeDays: number;
  delayDays: number;
  simulated?: true;
}

export interface SimEventDoc {
  _id: string;
  simDate: Date;
  type: "CONSUMPTION" | "PO_CREATED" | "GR_ARRIVED" | "STOCKOUT_RISK" | "DELAY" | "PARTIAL_GR" | "PO_CANCELLED" | "MANUAL";
  materialId?: string;
  qty?: number;
  poId?: string;
  note: string;
  simulated?: true;
}
```

`InventoryLotDoc`에 `simulated?: true` 필드 추가:
```ts
export interface InventoryLotDoc {
  _id: string; materialId: string; lotNo: string; quantity: number; availableQuantity: number;
  receivedAt: Date; manufactureDate?: Date; expiryDate?: Date;
  qualityStatus: InventoryStatus; holdReason?: string; updatedAt: Date;
  warehouseId?: string; slotId?: string;
  simulated?: true;   // ← 추가
}
```

`InventoryMovementDoc`에 `simulated?: true` 필드 추가:
```ts
export interface InventoryMovementDoc {
  _id: string; handlingUnitId?: string; materialId: string; type: "RECEIPT" | "PUTAWAY" | "MOVE" | "PICK" | "ISSUE" | "HOLD" | "RELEASE" | "QUARANTINE";
  fromLocationId?: string | null; toLocationId?: string | null; quantity: number;
  reason?: string; userId: string; createdAt: Date;
  lotId?: string; processCode?: string;
  simulated?: true;   // ← 추가
}
```

- [ ] **Step 2: `collections()` 반환 타입과 구현에 3개 컬렉션 추가**

반환 타입 블록에 추가:
```ts
  simState: Collection<SimStateDoc>;
  simPurchaseOrders: Collection<SimPurchaseOrderDoc>;
  simEvents: Collection<SimEventDoc>;
```

구현 블록에 추가:
```ts
    simState: db.collection<SimStateDoc>("simState"),
    simPurchaseOrders: db.collection<SimPurchaseOrderDoc>("simPurchaseOrders"),
    simEvents: db.collection<SimEventDoc>("simEvents"),
```

- [ ] **Step 3: TypeScript 컴파일 확인**

```bash
cd /Users/hwangjihun/Fab/fab-system && npx tsc --noEmit
```

Expected: 에러 없음 (또는 기존과 동일한 에러만)

- [ ] **Step 4: 커밋**

```bash
git add src/lib/db.ts
git commit -m "feat(sim): add SimStateDoc, SimPurchaseOrderDoc, SimEventDoc types to db.ts"
```

---

### Task 2: 시뮬레이션 순수 엔진

**Files:**
- Create: `src/lib/sim-engine.ts`
- Create: `scripts/test-sim-engine.ts`

**Interfaces:**
- Consumes: `InventoryLotDoc`, `SimPurchaseOrderDoc`, `SimEventDoc` (Task 1)
- Produces: `processTick(input: TickInput): TickResult`, `getBaseLeadTime(category: string): number`, `TickInput`, `TickResult`, `MaterialUsage`, `LotUpdate`, `NewLot`, `NewPO`, `UpdatedPO`

- [ ] **Step 1: `src/lib/sim-engine.ts` 작성**

```ts
import { randomUUID } from "crypto";
import type { InventoryLotDoc, SimPurchaseOrderDoc, SimEventDoc } from "@/lib/db";

export type MaterialUsage = {
  materialId: string;
  category: string;
  dailyQty: number;
  ropDays: number;
};

export type TickInput = {
  simDate: Date;
  materials: MaterialUsage[];
  lots: InventoryLotDoc[];
  activePOs: SimPurchaseOrderDoc[];
};

export type LotUpdate = { id: string; newAvailable: number; consumed: boolean };
export type NewLot = Omit<InventoryLotDoc, "_id"> & { _id: string; simulated: true };
export type NewPO = SimPurchaseOrderDoc & { simulated: true };
export type UpdatedPO = { id: string; status?: SimPurchaseOrderDoc["status"]; delayDays?: number; actualArrival?: Date };
export type NewMovement = { _id: string; materialId: string; type: "RECEIPT"; quantity: number; lotId: string; reason: string; userId: string; createdAt: Date; simulated: true };

export type TickResult = {
  lotUpdates: LotUpdate[];
  newLots: NewLot[];
  newMovements: NewMovement[];
  newPOs: NewPO[];
  updatedPOs: UpdatedPO[];
  newEvents: SimEventDoc[];
};

const LEAD_TIME_RANGE: Record<string, [number, number]> = {
  CHM: [7, 14],
  GAS: [3, 7],
  PKG: [5, 10],
};

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function getBaseLeadTime(category: string): number {
  const [lo, hi] = LEAD_TIME_RANGE[category] ?? [7, 7];
  return randInt(lo, hi);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isDue(po: SimPurchaseOrderDoc, simDate: Date): boolean {
  const due = addDays(po.expectedArrival, po.delayDays);
  return due <= simDate;
}

export function processTick(input: TickInput): TickResult {
  const { simDate, materials, lots, activePOs } = input;
  const now = new Date();

  const lotUpdates: LotUpdate[] = [];
  const newLots: NewLot[] = [];
  const newMovements: NewMovement[] = [];
  const newPOs: NewPO[] = [];
  const updatedPOs: UpdatedPO[] = [];
  const newEvents: SimEventDoc[] = [];

  // ① 소비 처리 — FEFO (expiryDate ASC, receivedAt ASC)
  const availableLots = lots
    .filter(l => l.qualityStatus === "AVAILABLE" && l.availableQuantity > 0)
    .sort((a, b) => {
      if (a.expiryDate && b.expiryDate) return a.expiryDate.getTime() - b.expiryDate.getTime();
      if (a.expiryDate) return -1;
      if (b.expiryDate) return 1;
      return a.receivedAt.getTime() - b.receivedAt.getTime();
    });

  // 소비 후 가용 수량 추적 (ROP 체크에도 사용)
  const lotAvail = new Map<string, number>(availableLots.map(l => [l._id, l.availableQuantity]));

  for (const mat of materials) {
    let remaining = mat.dailyQty;
    const matLots = availableLots.filter(l => l.materialId === mat.materialId);

    for (const lot of matLots) {
      if (remaining <= 0) break;
      const avail = lotAvail.get(lot._id) ?? 0;
      const consume = Math.min(avail, remaining);
      if (consume <= 0) continue;
      const newAvail = avail - consume;
      lotAvail.set(lot._id, newAvail);
      remaining -= consume;
      lotUpdates.push({ id: lot._id, newAvailable: newAvail, consumed: newAvail === 0 });
    }

    const totalAfter = matLots.reduce((s, l) => s + (lotAvail.get(l._id) ?? 0), 0);
    newEvents.push({
      _id: randomUUID(),
      simDate,
      type: "CONSUMPTION",
      materialId: mat.materialId,
      qty: mat.dailyQty,
      note: `일일 소비 ${mat.dailyQty.toFixed(1)} → 잔여 ${totalAfter.toFixed(1)}`,
      simulated: true,
    });

    if (totalAfter < mat.dailyQty * mat.ropDays) {
      newEvents.push({
        _id: randomUUID(),
        simDate,
        type: "STOCKOUT_RISK",
        materialId: mat.materialId,
        qty: totalAfter,
        note: `재고 위험: 잔여 ${totalAfter.toFixed(1)} / ROP ${(mat.dailyQty * mat.ropDays).toFixed(1)}`,
        simulated: true,
      });
    }
  }

  // ② ROP 체크 → 자동 발주
  for (const mat of materials) {
    const matLots = availableLots.filter(l => l.materialId === mat.materialId);
    const totalAvail = matLots.reduce((s, l) => s + (lotAvail.get(l._id) ?? 0), 0);
    const rop = mat.dailyQty * mat.ropDays;
    const hasPending = activePOs.some(
      po => po.materialId === mat.materialId &&
            (po.status === "PENDING" || po.status === "IN_TRANSIT")
    );
    if (totalAvail < rop && !hasPending) {
      const baseLead = getBaseLeadTime(mat.category);
      const jitter = 0.8 + Math.random() * 0.4;
      const leadDays = Math.round(baseLead * jitter);
      const orderQty = Math.round(Math.max(mat.dailyQty * mat.ropDays * 3, 10));
      const poId = `PO-${Date.now()}-${mat.materialId}`;
      const expectedArrival = addDays(simDate, leadDays);
      newPOs.push({
        _id: poId,
        materialId: mat.materialId,
        qty: orderQty,
        status: "IN_TRANSIT",
        createdSimDate: simDate,
        expectedArrival,
        leadTimeDays: leadDays,
        delayDays: 0,
        simulated: true,
      });
      newEvents.push({
        _id: randomUUID(),
        simDate,
        type: "PO_CREATED",
        materialId: mat.materialId,
        qty: orderQty,
        poId,
        note: `자동 발주 ${orderQty} → 예정 D+${leadDays}`,
        simulated: true,
      });
    }
  }

  // ③ GR 처리 — 도착 예정인 IN_TRANSIT PO
  const duePoIds = new Set<string>();
  for (const po of activePOs) {
    if (po.status !== "IN_TRANSIT") continue;
    if (!isDue(po, simDate)) continue;
    duePoIds.add(po._id);
    const lotId = randomUUID();
    newLots.push({
      _id: lotId,
      materialId: po.materialId,
      lotNo: `SIM-${po._id}`,
      quantity: po.qty,
      availableQuantity: po.qty,
      receivedAt: simDate,
      qualityStatus: "AVAILABLE",
      updatedAt: now,
      simulated: true,
    });
    newMovements.push({
      _id: randomUUID(),
      materialId: po.materialId,
      type: "RECEIPT",
      quantity: po.qty,
      lotId,
      reason: `GR: ${po._id}`,
      userId: "simulator",
      createdAt: now,
      simulated: true,
    });
    updatedPOs.push({ id: po._id, status: "RECEIVED", actualArrival: simDate });
    newEvents.push({
      _id: randomUUID(),
      simDate,
      type: "GR_ARRIVED",
      materialId: po.materialId,
      qty: po.qty,
      poId: po._id,
      note: `GR 도착 ${po.qty} (${po._id})`,
      simulated: true,
    });
  }

  // ④ 랜덤 이벤트 — 아직 도착 안 한 IN_TRANSIT PO
  const pendingPos = activePOs.filter(po => po.status === "IN_TRANSIT" && !duePoIds.has(po._id));
  for (const po of pendingPos) {
    const r = Math.random();
    if (r < 0.01) {
      // 1% PO 취소 + 재발주
      updatedPOs.push({ id: po._id, status: "CANCELLED" });
      newEvents.push({ _id: randomUUID(), simDate, type: "PO_CANCELLED", materialId: po.materialId, poId: po._id, note: `PO 취소 → 재발주`, simulated: true });
      const leadDays = getBaseLeadTime(materials.find(m => m.materialId === po.materialId)?.category ?? "");
      const retryId = `PO-RETRY-${Date.now()}-${po.materialId}`;
      newPOs.push({ _id: retryId, materialId: po.materialId, qty: po.qty, status: "IN_TRANSIT", createdSimDate: simDate, expectedArrival: addDays(simDate, leadDays), leadTimeDays: leadDays, delayDays: 0, simulated: true });
    } else if (r < 0.03) {
      // 2% 부분 입고
      const ratio = 0.6 + Math.random() * 0.2;
      const partQty = Math.round(po.qty * ratio);
      const remQty = po.qty - partQty;
      const lotId = randomUUID();
      newLots.push({ _id: lotId, materialId: po.materialId, lotNo: `SIM-PARTIAL-${Date.now()}`, quantity: partQty, availableQuantity: partQty, receivedAt: simDate, qualityStatus: "AVAILABLE", updatedAt: now, simulated: true });
      newMovements.push({ _id: randomUUID(), materialId: po.materialId, type: "RECEIPT", quantity: partQty, lotId, reason: `부분 GR: ${po._id}`, userId: "simulator", createdAt: now, simulated: true });
      updatedPOs.push({ id: po._id, status: "RECEIVED", actualArrival: simDate });
      const remLeadDays = getBaseLeadTime(materials.find(m => m.materialId === po.materialId)?.category ?? "");
      const remId = `PO-REM-${Date.now()}-${po.materialId}`;
      newPOs.push({ _id: remId, materialId: po.materialId, qty: remQty, status: "IN_TRANSIT", createdSimDate: simDate, expectedArrival: addDays(simDate, remLeadDays), leadTimeDays: remLeadDays, delayDays: 0, simulated: true });
      newEvents.push({ _id: randomUUID(), simDate, type: "PARTIAL_GR", materialId: po.materialId, qty: partQty, poId: po._id, note: `부분 입고 ${partQty}/${po.qty} (${Math.round(ratio * 100)}%)`, simulated: true });
    } else if (r < 0.08) {
      // 5% 공급 지연
      const delayAdd = randInt(2, 5);
      updatedPOs.push({ id: po._id, delayDays: (po.delayDays || 0) + delayAdd });
      newEvents.push({ _id: randomUUID(), simDate, type: "DELAY", materialId: po.materialId, poId: po._id, note: `공급 지연 +${delayAdd}일`, simulated: true });
    }
  }

  return { lotUpdates, newLots, newMovements, newPOs, updatedPOs, newEvents };
}
```

- [ ] **Step 2: `scripts/test-sim-engine.ts` 작성 (검증 스크립트)**

```ts
import { processTick, type MaterialUsage, type TickInput } from "../src/lib/sim-engine";
import type { InventoryLotDoc } from "../src/lib/db";

const simDate = new Date("2026-07-13");
const materials: MaterialUsage[] = [
  { materialId: "CHM-007", category: "CHM", dailyQty: 10, ropDays: 14 },
];
const lots: InventoryLotDoc[] = [
  {
    _id: "lot-1", materialId: "CHM-007", lotNo: "TEST-001",
    quantity: 200, availableQuantity: 200,
    receivedAt: new Date("2026-07-01"),
    expiryDate: new Date("2026-09-01"),
    qualityStatus: "AVAILABLE", updatedAt: new Date(),
  },
];
const input: TickInput = { simDate, materials, lots, activePOs: [] };
const result = processTick(input);

console.assert(result.lotUpdates.length === 1, "LotUpdate 1개");
console.assert(result.lotUpdates[0].newAvailable === 190, `잔여 190, 실제: ${result.lotUpdates[0].newAvailable}`);
console.assert(result.newPOs.length === 0, "ROP 초과 아님 → PO 없음");
console.assert(result.newEvents.some(e => e.type === "CONSUMPTION"), "CONSUMPTION 이벤트 존재");

// ROP 트리거 테스트
const lowLots: InventoryLotDoc[] = [
  { ...lots[0], availableQuantity: 5 }, // 5 < ropDays(14) * dailyQty(10) = 140
];
const lowResult = processTick({ ...input, lots: lowLots });
console.assert(lowResult.newPOs.length > 0, "ROP 미달 → 자동 발주");
console.assert(lowResult.newEvents.some(e => e.type === "STOCKOUT_RISK"), "STOCKOUT_RISK 이벤트 존재");

console.log("✅ sim-engine 검증 통과");
```

- [ ] **Step 3: 검증 스크립트 실행**

```bash
cd /Users/hwangjihun/Fab/fab-system && npx tsx scripts/test-sim-engine.ts
```

Expected: `✅ sim-engine 검증 통과`

- [ ] **Step 4: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sim-engine.ts scripts/test-sim-engine.ts
git commit -m "feat(sim): add pure tick processor (sim-engine.ts) with FEFO, ROP, random events"
```

---

### Task 3: DB 실행기 + 상태 제어 API

**Files:**
- Create: `src/lib/sim-runner.ts`
- Create: `src/app/api/sim/state/route.ts`
- Create: `src/app/api/sim/start/route.ts`
- Create: `src/app/api/sim/pause/route.ts`
- Create: `src/app/api/sim/reset/route.ts`

**Interfaces:**
- Consumes: `processTick()` (Task 2), `collections()` + `SimStateDoc` (Task 1)
- Produces: `executeTickAndPersist(): Promise<TickResult>`, `initSimState(): Promise<SimStateDoc>`
- API: `GET /api/sim/state` → `SimStateDoc`, `POST /api/sim/start` → `SimStateDoc`, `POST /api/sim/pause` → `{ok}`, `POST /api/sim/reset` → `{deleted}`

- [ ] **Step 1: `src/lib/sim-runner.ts` 작성**

```ts
import { collections } from "@/lib/db";
import type { SimStateDoc } from "@/lib/db";
import { processTick, type MaterialUsage } from "@/lib/sim-engine";
import type { TickResult } from "@/lib/sim-engine";
import { randomUUID } from "crypto";

export async function getOrInitSimState(): Promise<SimStateDoc> {
  const { simState } = await collections();
  const existing = await simState.findOne({ _id: "singleton" });
  if (existing) return existing;
  const initial: SimStateDoc = {
    _id: "singleton",
    status: "IDLE",
    simDate: new Date(),
    simStartDate: new Date(),
    realStartedAt: new Date(),
    speedMultiplier: 10,
  };
  await simState.insertOne(initial);
  return initial;
}

export async function executeTickAndPersist(): Promise<TickResult> {
  const { simState, inventoryLots, simPurchaseOrders, simEvents, inventoryMovements, processUsage, materials } =
    await collections();

  const state = await simState.findOne({ _id: "singleton" });
  if (!state) throw new Error("simState 없음");

  // 자재별 일일 소비량 집계
  const usages = await processUsage.find({}).toArray();
  const materialDocs = await materials.find({}).toArray();
  const matMap = new Map(materialDocs.map(m => [m._id, m]));

  const usageByMat = new Map<string, number>();
  for (const u of usages) {
    usageByMat.set(u.materialId, (usageByMat.get(u.materialId) ?? 0) + u.monthlyQty / 30);
  }

  const materialUsages: MaterialUsage[] = [];
  for (const [materialId, dailyQty] of usageByMat) {
    const mat = matMap.get(materialId);
    if (!mat || dailyQty <= 0) continue;
    materialUsages.push({
      materialId,
      category: mat.category,
      dailyQty,
      ropDays: mat.ropDays,
    });
  }

  const lots = await inventoryLots.find({ qualityStatus: "AVAILABLE" }).toArray();
  const activePOs = await simPurchaseOrders
    .find({ status: { $in: ["PENDING", "IN_TRANSIT"] } })
    .toArray();

  const result = processTick({
    simDate: state.simDate,
    materials: materialUsages,
    lots,
    activePOs,
  });

  // DB 반영
  const writes: Promise<unknown>[] = [];

  for (const u of result.lotUpdates) {
    writes.push(
      inventoryLots.updateOne(
        { _id: u.id },
        { $set: { availableQuantity: u.newAvailable, qualityStatus: u.consumed ? "CONSUMED" : undefined, updatedAt: new Date() } }
      )
    );
  }

  for (const lot of result.newLots) {
    writes.push(inventoryLots.insertOne(lot));
  }

  for (const mv of result.newMovements) {
    writes.push(inventoryMovements.insertOne(mv));
  }

  for (const po of result.newPOs) {
    writes.push(simPurchaseOrders.insertOne(po));
  }

  for (const upd of result.updatedPOs) {
    const setFields: Record<string, unknown> = {};
    if (upd.status) setFields.status = upd.status;
    if (upd.delayDays !== undefined) setFields.delayDays = upd.delayDays;
    if (upd.actualArrival) setFields.actualArrival = upd.actualArrival;
    writes.push(simPurchaseOrders.updateOne({ _id: upd.id }, { $set: setFields }));
  }

  for (const ev of result.newEvents) {
    writes.push(simEvents.insertOne(ev));
  }

  // simDate +1일
  const nextDate = new Date(state.simDate);
  nextDate.setDate(nextDate.getDate() + 1);
  writes.push(simState.updateOne({ _id: "singleton" }, { $set: { simDate: nextDate } }));

  await Promise.all(writes);
  return result;
}
```

- [ ] **Step 2: `src/app/api/sim/state/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getOrInitSimState } from "@/lib/sim-runner";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getOrInitSimState();
  return NextResponse.json(state);
}
```

- [ ] **Step 3: `src/app/api/sim/start/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { getOrInitSimState } from "@/lib/sim-runner";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const speedMultiplier = body.speedMultiplier ?? 10;
  const { simState } = await collections();
  await getOrInitSimState();
  const now = new Date();
  await simState.updateOne(
    { _id: "singleton" },
    { $set: { status: "RUNNING", speedMultiplier, realStartedAt: now } }
  );
  const updated = await simState.findOne({ _id: "singleton" });
  return NextResponse.json(updated);
}
```

- [ ] **Step 4: `src/app/api/sim/pause/route.ts`**

```ts
import { NextResponse } from "next/server";
import { collections } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  const { simState } = await collections();
  await simState.updateOne({ _id: "singleton" }, { $set: { status: "PAUSED" } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: `src/app/api/sim/reset/route.ts`**

```ts
import { NextResponse } from "next/server";
import { collections } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  const { simState, inventoryLots, inventoryMovements, simPurchaseOrders, simEvents } =
    await collections();

  const [lots, movements, pos, events] = await Promise.all([
    inventoryLots.deleteMany({ simulated: true }),
    inventoryMovements.deleteMany({ simulated: true }),
    simPurchaseOrders.deleteMany({ simulated: true }),
    simEvents.deleteMany({ simulated: true }),
  ]);

  await simState.updateOne(
    { _id: "singleton" },
    {
      $set: {
        status: "IDLE",
        simDate: new Date(),
        simStartDate: new Date(),
        realStartedAt: new Date(),
      },
    },
    { upsert: true }
  );

  return NextResponse.json({
    deleted: {
      lots: lots.deletedCount,
      movements: movements.deletedCount,
      pos: pos.deletedCount,
      events: events.deletedCount,
    },
  });
}
```

- [ ] **Step 6: TypeScript 컴파일 확인**

```bash
cd /Users/hwangjihun/Fab/fab-system && npx tsc --noEmit
```

- [ ] **Step 7: 브라우저에서 API 확인**

개발 서버 실행 중이라면:
```bash
curl http://localhost:3000/api/sim/state
```
Expected: `{"_id":"singleton","status":"IDLE",...}`

```bash
curl -X POST http://localhost:3000/api/sim/start -H "Content-Type: application/json" -d '{"speedMultiplier":10}'
```
Expected: `{"_id":"singleton","status":"RUNNING",...}`

```bash
curl -X POST http://localhost:3000/api/sim/pause
```
Expected: `{"ok":true}`

```bash
curl -X POST http://localhost:3000/api/sim/reset
```
Expected: `{"deleted":{...}}`

- [ ] **Step 8: 커밋**

```bash
git add src/lib/sim-runner.ts src/app/api/sim/state/route.ts src/app/api/sim/start/route.ts src/app/api/sim/pause/route.ts src/app/api/sim/reset/route.ts
git commit -m "feat(sim): add sim-runner and state control APIs (state/start/pause/reset)"
```

---

### Task 4: 틱 + 점프 API

**Files:**
- Create: `src/app/api/sim/tick/route.ts`
- Create: `src/app/api/sim/jump/route.ts`

**Interfaces:**
- Consumes: `executeTickAndPersist()` (Task 3)
- Produces: `POST /api/sim/tick` → `TickResult`, `POST /api/sim/jump?days=N` → `{days, events[]}`

- [ ] **Step 1: `src/app/api/sim/tick/route.ts`**

```ts
import { NextResponse } from "next/server";
import { executeTickAndPersist } from "@/lib/sim-runner";

export const dynamic = "force-dynamic";

export async function POST() {
  const result = await executeTickAndPersist();
  return NextResponse.json(result);
}
```

- [ ] **Step 2: `src/app/api/sim/jump/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { executeTickAndPersist } from "@/lib/sim-runner";
import type { SimEventDoc } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const days = Math.min(Math.max(parseInt(searchParams.get("days") ?? "30"), 1), 365);

  const allEvents: SimEventDoc[] = [];
  for (let i = 0; i < days; i++) {
    const result = await executeTickAndPersist();
    allEvents.push(...result.newEvents);
  }

  return NextResponse.json({ days, eventCount: allEvents.length, events: allEvents.slice(-50) });
}
```

- [ ] **Step 3: 브라우저에서 API 확인**

```bash
# 틱 1회
curl -X POST http://localhost:3000/api/sim/tick

# 7일 점프
curl -X POST "http://localhost:3000/api/sim/jump?days=7"
```

Expected: 각각 TickResult JSON, `{days:7, eventCount:N, events:[...]}`

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/sim/tick/route.ts src/app/api/sim/jump/route.ts
git commit -m "feat(sim): add tick and jump APIs"
```

---

### Task 5: SSE 스트림

**Files:**
- Create: `src/app/api/sim/stream/route.ts`

**Interfaces:**
- Consumes: `executeTickAndPersist()` (Task 3), `getOrInitSimState()` (Task 3)
- Produces: `GET /api/sim/stream` → SSE 스트림 (`data: {...}\n\n`)
- SSE 이벤트 형식: `{ type: "tick" | "status" | "error", simDate?, events?, status? }`

- [ ] **Step 1: `src/app/api/sim/stream/route.ts`**

```ts
import { collections } from "@/lib/db";
import { executeTickAndPersist, getOrInitSimState } from "@/lib/sim-runner";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  let closed = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const send = (controller: ReadableStreamDefaultController, data: unknown) => {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      closed = true;
    }
  };

  const stream = new ReadableStream({
    async start(controller) {
      const state = await getOrInitSimState();
      send(controller, { type: "status", status: state.status, simDate: state.simDate });

      const loop = async () => {
        if (closed) return;
        try {
          const { simState } = await collections();
          const current = await simState.findOne({ _id: "singleton" });
          if (!current || current.status !== "RUNNING") {
            send(controller, { type: "status", status: current?.status ?? "IDLE", simDate: current?.simDate });
            timeoutId = setTimeout(loop, 2000);
            return;
          }
          const result = await executeTickAndPersist();
          const { simDate } = (await simState.findOne({ _id: "singleton" })) ?? current;
          send(controller, {
            type: "tick",
            simDate,
            newEvents: result.newEvents,
            newPOsCount: result.newPOs.length,
            grCount: result.newLots.length,
          });
          const intervalMs = Math.max(50, Math.round(1000 / current.speedMultiplier));
          timeoutId = setTimeout(loop, intervalMs);
        } catch (err) {
          send(controller, { type: "error", message: String(err) });
          timeoutId = setTimeout(loop, 3000);
        }
      };

      loop();
    },
    cancel() {
      closed = true;
      if (timeoutId) clearTimeout(timeoutId);
      collections().then(({ simState }) => {
        simState.updateOne({ _id: "singleton" }, { $set: { status: "PAUSED" } });
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

- [ ] **Step 2: 브라우저에서 SSE 확인**

개발자 도구 콘솔에서:
```js
const es = new EventSource('/api/sim/stream');
es.onmessage = e => console.log(JSON.parse(e.data));
```

먼저 `/api/sim/start` POST 후 SSE 이벤트가 흘러오는지 확인. `{ type: "tick", simDate: "...", newEvents: [...] }` 수신 확인.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/sim/stream/route.ts
git commit -m "feat(sim): add SSE stream endpoint (/api/sim/stream)"
```

---

### Task 6: PO + 이벤트 API

**Files:**
- Create: `src/app/api/sim/pos/route.ts`
- Create: `src/app/api/sim/pos/[id]/delay/route.ts`
- Create: `src/app/api/sim/pos/[id]/partial/route.ts`
- Create: `src/app/api/sim/events/route.ts`

**Interfaces:**
- Consumes: `SimPurchaseOrderDoc`, `SimEventDoc` (Task 1), `collections()` (Task 1)
- Produces:
  - `GET /api/sim/pos` → `SimPurchaseOrderDoc[]` (PENDING+IN_TRANSIT)
  - `POST /api/sim/pos` body `{materialId, qty}` → `{id}` (긴급 발주)
  - `POST /api/sim/pos/[id]/delay` body `{days}` → `{ok}`
  - `POST /api/sim/pos/[id]/partial` body `{ratio}` (0~1) → `{ok}`
  - `GET /api/sim/events?limit=50` → `SimEventDoc[]`

- [ ] **Step 1: `src/app/api/sim/pos/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { getOrInitSimState } from "@/lib/sim-runner";
import { getBaseLeadTime } from "@/lib/sim-engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const { simPurchaseOrders } = await collections();
  const pos = await simPurchaseOrders
    .find({ status: { $in: ["PENDING", "IN_TRANSIT"] } })
    .sort({ createdSimDate: -1 })
    .toArray();
  return NextResponse.json(pos);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { materialId, qty } = body as { materialId: string; qty: number };
  if (!materialId || !qty || qty <= 0)
    return NextResponse.json({ error: "materialId, qty 필수" }, { status: 400 });

  const { simPurchaseOrders, simEvents, materials } = await collections();
  const state = await getOrInitSimState();
  const mat = await materials.findOne({ _id: materialId });
  const leadDays = getBaseLeadTime(mat?.category ?? "");
  const expectedArrival = new Date(state.simDate);
  expectedArrival.setDate(expectedArrival.getDate() + leadDays);

  const poId = `PO-MANUAL-${Date.now()}-${materialId}`;
  await simPurchaseOrders.insertOne({
    _id: poId, materialId, qty, status: "IN_TRANSIT",
    createdSimDate: state.simDate, expectedArrival,
    leadTimeDays: leadDays, delayDays: 0, simulated: true,
  });
  await simEvents.insertOne({
    _id: poId + "-ev", simDate: state.simDate, type: "MANUAL",
    materialId, qty, poId,
    note: `긴급 발주 ${qty} → D+${leadDays}`, simulated: true,
  });

  return NextResponse.json({ id: poId });
}
```

- [ ] **Step 2: `src/app/api/sim/pos/[id]/delay/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { getOrInitSimState } from "@/lib/sim-runner";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const days = Math.max(1, parseInt(body.days ?? "3"));
  const { simPurchaseOrders, simEvents } = await collections();
  const po = await simPurchaseOrders.findOne({ _id: id });
  if (!po) return NextResponse.json({ error: "PO 없음" }, { status: 404 });

  await simPurchaseOrders.updateOne({ _id: id }, { $inc: { delayDays: days } });
  const state = await getOrInitSimState();
  await simEvents.insertOne({
    _id: `ev-delay-${Date.now()}`, simDate: state.simDate, type: "DELAY",
    materialId: po.materialId, poId: id,
    note: `수동 지연 +${days}일 (${id})`, simulated: true,
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: `src/app/api/sim/pos/[id]/partial/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { getOrInitSimState } from "@/lib/sim-runner";
import { getBaseLeadTime } from "@/lib/sim-engine";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const ratio = Math.min(Math.max(parseFloat(body.ratio ?? "0.7"), 0.1), 0.9);
  const { simPurchaseOrders, simEvents, inventoryLots, inventoryMovements, materials } = await collections();
  const po = await simPurchaseOrders.findOne({ _id: id });
  if (!po || po.status !== "IN_TRANSIT")
    return NextResponse.json({ error: "PO 없음 또는 이미 처리됨" }, { status: 404 });

  const state = await getOrInitSimState();
  const partQty = Math.round(po.qty * ratio);
  const remQty = po.qty - partQty;
  const now = new Date();
  const lotId = randomUUID();

  await inventoryLots.insertOne({
    _id: lotId, materialId: po.materialId, lotNo: `SIM-PARTIAL-MANUAL-${Date.now()}`,
    quantity: partQty, availableQuantity: partQty, receivedAt: state.simDate,
    qualityStatus: "AVAILABLE", updatedAt: now, simulated: true,
  });
  await inventoryMovements.insertOne({
    _id: randomUUID(), materialId: po.materialId, type: "RECEIPT", quantity: partQty,
    lotId, reason: `수동 부분 GR: ${id}`, userId: "manual", createdAt: now, simulated: true,
  });
  await simPurchaseOrders.updateOne({ _id: id }, { $set: { status: "RECEIVED", actualArrival: state.simDate } });

  if (remQty > 0) {
    const mat = await materials.findOne({ _id: po.materialId });
    const leadDays = getBaseLeadTime(mat?.category ?? "");
    const expectedArrival = new Date(state.simDate);
    expectedArrival.setDate(expectedArrival.getDate() + leadDays);
    const remId = `PO-REM-MANUAL-${Date.now()}-${po.materialId}`;
    await simPurchaseOrders.insertOne({
      _id: remId, materialId: po.materialId, qty: remQty, status: "IN_TRANSIT",
      createdSimDate: state.simDate, expectedArrival, leadTimeDays: leadDays, delayDays: 0, simulated: true,
    });
  }

  await simEvents.insertOne({
    _id: `ev-partial-${Date.now()}`, simDate: state.simDate, type: "PARTIAL_GR",
    materialId: po.materialId, qty: partQty, poId: id,
    note: `수동 부분 입고 ${partQty}/${po.qty}`, simulated: true,
  });

  return NextResponse.json({ ok: true, partQty, remQty });
}
```

- [ ] **Step 4: `src/app/api/sim/events/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const { simEvents } = await collections();
  const events = await simEvents.find({}).sort({ simDate: -1 }).limit(limit).toArray();
  return NextResponse.json(events);
}
```

- [ ] **Step 5: TypeScript 컴파일 확인**

```bash
cd /Users/hwangjihun/Fab/fab-system && npx tsc --noEmit
```

- [ ] **Step 6: 커밋**

```bash
git add "src/app/api/sim/pos/route.ts" "src/app/api/sim/pos/[id]/delay/route.ts" "src/app/api/sim/pos/[id]/partial/route.ts" src/app/api/sim/events/route.ts
git commit -m "feat(sim): add PO manual trigger and event log APIs"
```

---

### Task 7: 시뮬레이션 컨트롤 패널 UI

**Files:**
- Create: `src/app/(dashboard)/simulation/SimControlPanel.tsx`
- Modify: `src/app/(dashboard)/simulation/page.tsx`

**Interfaces:**
- Consumes: `GET /api/sim/state`, `POST /api/sim/start`, `POST /api/sim/pause`, `POST /api/sim/reset`, `POST /api/sim/jump`, `GET /api/sim/stream`, `GET /api/sim/pos`, `POST /api/sim/pos`, `POST /api/sim/pos/[id]/delay`, `POST /api/sim/pos/[id]/partial`, `GET /api/sim/events` (Tasks 3-6)
- Produces: `<SimControlPanel />` — client 컴포넌트

- [ ] **Step 1: `src/app/(dashboard)/simulation/SimControlPanel.tsx` 작성**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { SimStateDoc, SimPurchaseOrderDoc, SimEventDoc } from "@/lib/db";

const EVENT_ICON: Record<string, string> = {
  CONSUMPTION: "⚙️",
  PO_CREATED: "📦",
  GR_ARRIVED: "🟢",
  STOCKOUT_RISK: "🔴",
  DELAY: "🟡",
  PARTIAL_GR: "🟡",
  PO_CANCELLED: "🔴",
  MANUAL: "🔵",
};

const SPEED_OPTIONS = [1, 5, 10, 30, 100];

function fmtDate(d: Date | string | undefined) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR");
}

function daysDiff(a: Date | string | undefined, b: Date | string | undefined) {
  if (!a || !b) return 0;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

export default function SimControlPanel() {
  const [state, setState] = useState<SimStateDoc | null>(null);
  const [events, setEvents] = useState<SimEventDoc[]>([]);
  const [pos, setPos] = useState<SimPurchaseOrderDoc[]>([]);
  const [jumping, setJumping] = useState(false);
  const [manualMat, setManualMat] = useState("");
  const [manualQty, setManualQty] = useState("");
  const esRef = useRef<EventSource | null>(null);

  const fetchState = async () => {
    const r = await fetch("/api/sim/state");
    if (r.ok) setState(await r.json());
  };
  const fetchEvents = async () => {
    const r = await fetch("/api/sim/events?limit=50");
    if (r.ok) setEvents(await r.json());
  };
  const fetchPos = async () => {
    const r = await fetch("/api/sim/pos");
    if (r.ok) setPos(await r.json());
  };

  useEffect(() => {
    fetchState();
    fetchEvents();
    fetchPos();
  }, []);

  // SSE 연결
  useEffect(() => {
    const connect = () => {
      if (esRef.current) esRef.current.close();
      const es = new EventSource("/api/sim/stream");
      esRef.current = es;
      es.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.simDate) {
          setState(prev => prev ? { ...prev, simDate: data.simDate, status: data.status ?? prev.status } : null);
        }
        if (data.type === "status") {
          setState(prev => prev ? { ...prev, status: data.status } : null);
        }
        if (data.newEvents?.length) {
          setEvents(prev => [...data.newEvents.reverse(), ...prev].slice(0, 50));
          fetchPos();
        }
      };
      es.onerror = () => {
        setTimeout(connect, 3000);
      };
    };
    connect();
    return () => esRef.current?.close();
  }, []);

  const handleStart = async (speed?: number) => {
    const r = await fetch("/api/sim/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speedMultiplier: speed ?? state?.speedMultiplier ?? 10 }),
    });
    if (r.ok) { const s = await r.json(); setState(s); }
  };

  const handlePause = async () => {
    await fetch("/api/sim/pause", { method: "POST" });
    await fetchState();
  };

  const handleReset = async () => {
    if (!confirm("시뮬레이션 데이터를 전부 삭제하고 초기화할까요?")) return;
    await fetch("/api/sim/reset", { method: "POST" });
    await Promise.all([fetchState(), fetchEvents(), fetchPos()]);
  };

  const handleJump = async (days: number) => {
    setJumping(true);
    try {
      await fetch(`/api/sim/jump?days=${days}`, { method: "POST" });
      await Promise.all([fetchState(), fetchEvents(), fetchPos()]);
    } finally {
      setJumping(false);
    }
  };

  const handleDelay = async (id: string, days = 3) => {
    await fetch(`/api/sim/pos/${id}/delay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    });
    await fetchPos();
    await fetchEvents();
  };

  const handlePartial = async (id: string, ratio = 0.7) => {
    await fetch(`/api/sim/pos/${id}/partial`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ratio }),
    });
    await Promise.all([fetchPos(), fetchEvents()]);
  };

  const handleEmergencyPO = async () => {
    if (!manualMat || !manualQty) return;
    await fetch("/api/sim/pos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialId: manualMat, qty: Number(manualQty) }),
    });
    setManualMat(""); setManualQty("");
    await fetchPos();
  };

  const isRunning = state?.status === "RUNNING";
  const elapsed = daysDiff(state?.simStartDate, state?.simDate);

  return (
    <div className="space-y-4">
      {/* 상태 배지 */}
      {state && (
        <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium w-fit ${
          isRunning ? "bg-blue-50 text-blue-700" : state.status === "PAUSED" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"
        }`}>
          <span className={`w-2 h-2 rounded-full ${isRunning ? "bg-blue-500 animate-pulse" : "bg-gray-400"}`} />
          {isRunning ? "RUNNING" : state.status} · {fmtDate(state.simDate)} ({elapsed}일 경과)
        </div>
      )}

      {/* 컨트롤 바 */}
      <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-wrap gap-3 items-center">
        <div className="flex gap-2">
          {!isRunning ? (
            <button onClick={() => handleStart()} className="px-4 py-2 bg-[#0078D4] text-white rounded-lg text-sm font-medium hover:bg-blue-700">▶ 시작</button>
          ) : (
            <button onClick={handlePause} className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600">⏸ 멈춤</button>
          )}
          <button onClick={handleReset} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">⏮ 리셋</button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">속도:</span>
          {SPEED_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => handleStart(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${state?.speedMultiplier === s && isRunning ? "bg-[#0078D4] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {s}×
            </button>
          ))}
        </div>

        <div className="flex gap-2 ml-auto">
          <button onClick={() => handleJump(30)} disabled={jumping} className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-200 disabled:opacity-50">
            {jumping ? "처리 중..." : "30일 점프"}
          </button>
          <button onClick={() => handleJump(90)} disabled={jumping} className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-200 disabled:opacity-50">
            90일 점프
          </button>
        </div>
      </div>

      {/* 이벤트 피드 + PO 패널 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 이벤트 피드 */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">실시간 이벤트 피드</h3>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {events.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">시뮬레이션을 시작하면 이벤트가 여기 표시됩니다.</p>
            )}
            {events.map(ev => (
              <div key={ev._id} className="flex gap-2 text-xs text-gray-700 py-1 border-b border-gray-50 last:border-0">
                <span className="shrink-0">{EVENT_ICON[ev.type] ?? "•"}</span>
                <span className="text-gray-400 shrink-0">{fmtDate(ev.simDate)}</span>
                <span className="truncate">{ev.note}</span>
              </div>
            ))}
          </div>
        </div>

        {/* PO 패널 */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">진행 중 PO</h3>
          <div className="space-y-2 max-h-56 overflow-y-auto mb-3">
            {pos.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">발주 없음</p>
            )}
            {pos.map(po => (
              <div key={po._id} className="flex items-center gap-2 text-xs p-2 bg-gray-50 rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-700 truncate">{po.materialId}</div>
                  <div className="text-gray-400">{po.qty}개 · 도착 {fmtDate(po.expectedArrival)} {po.delayDays > 0 && <span className="text-red-500">+{po.delayDays}일</span>}</div>
                </div>
                <button onClick={() => handleDelay(po._id, 3)} className="px-2 py-1 bg-amber-100 text-amber-700 rounded hover:bg-amber-200">지연+3</button>
                <button onClick={() => handlePartial(po._id, 0.7)} className="px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200">부분70%</button>
              </div>
            ))}
          </div>

          {/* 긴급 발주 */}
          <div className="border-t pt-3">
            <p className="text-xs font-medium text-gray-600 mb-2">+ 긴급 발주</p>
            <div className="flex gap-2">
              <input
                value={manualMat}
                onChange={e => setManualMat(e.target.value)}
                placeholder="자재 ID (예: CHM-007)"
                className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg"
              />
              <input
                value={manualQty}
                onChange={e => setManualQty(e.target.value)}
                placeholder="수량"
                type="number"
                className="w-20 px-2 py-1.5 text-xs border border-gray-200 rounded-lg"
              />
              <button onClick={handleEmergencyPO} className="px-3 py-1.5 bg-[#0078D4] text-white text-xs rounded-lg hover:bg-blue-700">발주</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `src/app/(dashboard)/simulation/page.tsx` 수정**

기존 파일 상단에 import 추가 + `<SimControlPanel />`을 `<OperationalScenarioClient />` 위에 삽입:

```tsx
// 기존 import들 유지, 아래 줄 추가
import SimControlPanel from "./SimControlPanel";

// return 내부, <OperationalScenarioClient ... /> 위에 추가:
<div className="mb-6">
  <SimControlPanel />
</div>
```

- [ ] **Step 3: 브라우저에서 전체 UI 확인**

`http://localhost:3000/simulation` 접속 후:
1. 컨트롤 바가 페이지 상단에 표시되는지 확인
2. [▶ 시작] 클릭 → 상태 배지 `RUNNING` + simDate가 매초 증가하는지 확인
3. 이벤트 피드에 `⚙️ 소비`, `📦 발주` 이벤트 표시 확인
4. [⏸ 멈춤] 클릭 → PAUSED로 변경 확인
5. [30일 점프] 클릭 → 30개 이상 이벤트 추가 확인
6. PO 패널에서 [지연+3] 클릭 → 이벤트 피드에 🟡 지연 표시 확인
7. [⏮ 리셋] → 이벤트 피드 비워짐 확인

- [ ] **Step 4: 커밋**

```bash
git add "src/app/(dashboard)/simulation/SimControlPanel.tsx" "src/app/(dashboard)/simulation/page.tsx"
git commit -m "feat(sim): add SimControlPanel UI with SSE live feed, PO panel, speed controls"
```

---

### Task 8: 기존 탭 시뮬 배지

**Files:**
- Modify: `src/app/(dashboard)/inventory/page.tsx`
- Modify: `src/app/(dashboard)/wms/page.tsx`

**Interfaces:**
- Consumes: `collections()` → `simState` (Task 1)
- Produces: 시뮬레이션 RUNNING 중 상단 배지 `🔵 시뮬레이션 진행 중 · {simDate}`

- [ ] **Step 1: `src/app/(dashboard)/inventory/page.tsx` 수정**

기존 파일에서 `collections` import 이미 있음. `getOrInitSimState` 추가 필요 없음 — `simState` 컬렉션에서 직접 쿼리.

`page.tsx` 서버 컴포넌트 최상단 데이터 패칭에 추가:
```tsx
// 기존 import에 추가:
import { collections } from "@/lib/db";

// 기존 Promise.all에 simState 추가:
const [rows, simStateDoc, ...] = await Promise.all([
  getInventoryRows(true),
  collections().then(({ simState }) => simState.findOne({ _id: "singleton" })),
  // 기존 나머지 fetch들
]);
```

그리고 return JSX 맨 위에 배지 추가:
```tsx
{simStateDoc?.status === "RUNNING" && (
  <div className="mb-4 flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-xl text-sm font-medium w-fit">
    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
    시뮬레이션 진행 중 · {new Date(simStateDoc.simDate).toLocaleDateString("ko-KR")}
  </div>
)}
```

- [ ] **Step 2: `src/app/(dashboard)/wms/page.tsx` 수정**

동일한 패턴으로 `simState` 쿼리 추가 + 배지 렌더링:
```tsx
// 기존 collections() 호출에 simState 추가
const { inventoryLots, inventoryMovements, materials, warehouses, simState: simStateColl } = await collections();
const simStateDoc = await simStateColl.findOne({ _id: "singleton" });
```

JSX 맨 위:
```tsx
{simStateDoc?.status === "RUNNING" && (
  <div className="mb-4 flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-xl text-sm font-medium w-fit">
    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
    시뮬레이션 진행 중 · {new Date(simStateDoc.simDate).toLocaleDateString("ko-KR")}
  </div>
)}
```

- [ ] **Step 3: 브라우저에서 확인**

1. `/simulation`에서 [▶ 시작] 클릭
2. `/inventory` 탭 이동 → 상단 파란 배지 `시뮬레이션 진행 중 · 2026-07-13` 표시 확인
3. `/wms` 탭 이동 → 동일 배지 확인
4. `/simulation`에서 [⏸ 멈춤] 후 다른 탭 확인 → 배지 사라짐 확인

- [ ] **Step 4: TypeScript 컴파일 최종 확인**

```bash
cd /Users/hwangjihun/Fab/fab-system && npx tsc --noEmit
```

- [ ] **Step 5: 커밋**

```bash
git add "src/app/(dashboard)/inventory/page.tsx" "src/app/(dashboard)/wms/page.tsx"
git commit -m "feat(sim): add simulation running badge to inventory and wms tabs"
```

---

## 완료 체크리스트

- [ ] Task 1: DB 타입 (SimStateDoc, SimPurchaseOrderDoc, SimEventDoc)
- [ ] Task 2: sim-engine.ts 순수 함수 + test 스크립트 통과
- [ ] Task 3: sim-runner.ts + 상태 API 4개 (state/start/pause/reset)
- [ ] Task 4: tick + jump API
- [ ] Task 5: SSE 스트림
- [ ] Task 6: PO + 이벤트 API 4개
- [ ] Task 7: SimControlPanel UI (SSE 라이브 피드, 속도 슬라이더, PO 패널, 점프)
- [ ] Task 8: 기존 탭 시뮬 배지
