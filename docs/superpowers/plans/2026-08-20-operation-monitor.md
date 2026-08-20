# FAB Operation Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 결품·발주·입고·생산·창고·출하 이상을 공통 스냅샷으로 관찰하고, 중복 없는 incident와 근거 있는 개선 proposal을 MongoDB에 누적한다.

**Architecture:** DB 접근 없는 순수 detector가 공통 관측 입력을 운영 신호로 변환하고, 서버 계층이 기존 Twin 원장을 한 번에 읽어 입력을 만든다. self-scheduling 모니터가 실제 60초마다 lease를 얻어 관측하고 fingerprint 기반 upsert로 incident를 갱신한다. 담당 역할은 `PROPOSED`까지만 자동 진행한다.

**Tech Stack:** Next.js 16.2.10 instrumentation · MongoDB native driver · TypeScript · existing Twin role engines · `node:assert/strict`

## Global Constraints

- 모니터의 실제 60초 주기는 관찰 빈도이며 Twin 모델 시간을 진행하지 않는다.
- `recordedAt`·최초/최근 관측·승인 시각은 벽시계이고, 운영 영향은 `operatingEpochMs`를 함께 기록한다.
- 모든 모델 시간 계산은 `src/lib/twin/operating-clock.ts`의 공통 24× 시계를 사용한다.
- `OBSERVED → ANALYZED → PROPOSED`까지만 자동 진행한다. 승인 없이 운영 데이터·정책을 바꾸지 않는다.
- 기존 `tick-diagnosis`, 역할 규칙 엔진, Twin 원장을 재사용하고 화면별 계산을 복제하지 않는다.
- 기존 `controlTowerAIEpisodes`, 삭제된 파일럿 `agentRuns`·`agentDecisions`를 학습 원장으로 재사용하지 않는다.
- 사용자가 명시하지 않았으므로 서브에이전트를 호출하지 않는다.

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/operations-monitor.ts` | 관측 입력·신호·incident/proposal 초안 순수 로직 |
| `src/lib/operations-monitor-server.ts` | 기존 원장 조회, lease, incident/proposal 영속화 |
| `src/lib/operations-monitor-scheduler.ts` | 겹치지 않는 실제 60초 self-scheduling |
| `src/lib/db.ts` | 세 운영 원장과 monitor lease 타입·컬렉션 등록 |
| `src/instrumentation.ts` | 운영 모니터를 다른 스케줄러와 독립 기동 |
| `src/app/api/twin/operations-monitor/route.ts` | 인증된 현재 incident/proposal/revision 조회 |
| `scripts/test-operations-monitor.ts` | detector·dedupe·회복·proposal 조건 테스트 |
| `scripts/test-operations-monitor-persistence.ts` | MongoDB upsert·lease 통합 테스트 |

---

### Task 1: 관측 신호와 proposal 순수 정책

**Files:**
- Create: `src/lib/operations-monitor.ts`
- Create: `scripts/test-operations-monitor.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: 이미 계산된 `OperationObservationInput`
- Produces: `detectOperationSignals(input)`, `proposalDraftFor(signal)`

- [ ] **Step 1: 관측·신호 타입 정의**

```ts
export const OPERATION_MONITOR_POLICY_VERSION = "OPERATION_MONITOR_V1";
export type OperationRole = "PROCUREMENT" | "MATERIALS" | "PRODUCTION" | "LOGISTICS";
export type EvidenceValue = string | number | boolean | null;

export type OperationObservationInput = {
  recordedAt: Date;
  operatingEpochMs: number;
  engine: { status: "RUNNING" | "PAUSED"; secondsSinceTick: number | null; lifeSign: "ALIVE" | "DEGRADED" | "STOPPED"; minutesSinceOutput: number | null };
  materials: Array<{ materialId: string; code: string; state: "NORMAL" | "WATCH" | "CRITICAL" | "STOCKOUT" | "DATA_GAP"; onHand: number; coverageDays: number | null; blockedLots: number }>;
  procurement: { pendingApproval: number; oldestPendingApprovalMinutes: number; openOrders: Array<{ poId: string; materialId: string; etaOperatingMs: number | null }> };
  inbound: { held: Array<{ poId: string; materialId: string; reason: string | null }> };
  production: { materialBlockedLots: number; finishedGoodsHeldLots: number };
  warehouses: Array<{ warehouseId: string; utilization: number; verdict: "NORMAL" | "WATCH" | "CAPACITY_OVER" }>;
  shipments: Array<{ product: "HBM" | "DRAM" | "NAND"; availableQuantity: number; dueRemainingQty: number; minutesSinceLastShipment: number | null }>;
  starvedMaterials: Array<{ materialId: string; code: string; avgDailyBurn: number; designDaily: number }>;
  dataGaps: Array<{ source: string; field: string }>;
};

export type OperationSignal = {
  kind: OperationSignalKind;
  targetId: string;
  fingerprint: string;
  policyVersion: typeof OPERATION_MONITOR_POLICY_VERSION;
  severity: "ATTENTION" | "CRITICAL";
  affectedRoles: OperationRole[];
  summary: string;
  evidence: Record<string, EvidenceValue>;
  releaseCondition: string;
  recordedAt: Date;
  operatingEpochMs: number;
};
```

- [ ] **Step 2: 실패 테스트 작성**

테스트 fixture는 `recordedAt=2026-08-20T12:00:00Z`, `operatingEpochMs=1_296_000_000`으로
고정한다. 다음을 각각 assert한다.

```ts
const signals = detectOperationSignals({
  recordedAt, operatingEpochMs,
  engine: { status: "RUNNING", secondsSinceTick: 240, lifeSign: "STOPPED", minutesSinceOutput: 61 },
  materials: [{ materialId: "GAS-014", code: "GAS-014", state: "STOCKOUT", onHand: 0, coverageDays: 0, blockedLots: 120 }],
  procurement: { pendingApproval: 0, oldestPendingApprovalMinutes: 0, openOrders: [{ poId: "PO-1", materialId: "GAS-014", etaOperatingMs: 2_400_000_000 }] },
  inbound: { held: [] }, production: { materialBlockedLots: 120, finishedGoodsHeldLots: 0 },
  warehouses: [], shipments: [], starvedMaterials: [], dataGaps: [],
});
assert.ok(signals.some((x) => x.kind === "ENGINE_STALE"));
assert.ok(signals.some((x) => x.kind === "OUTPUT_STOPPED"));
assert.ok(signals.some((x) => x.kind === "MATERIAL_STOCKOUT" && x.targetId === "GAS-014"));
assert.equal(new Set(signals.map((x) => x.fingerprint)).size, signals.length);
assert.equal(proposalDraftFor(signals.find((x) => x.kind === "MATERIAL_STOCKOUT")!)?.change.kind, "CODE_OR_POLICY_CHANGE");
```

정상 fixture는 신호 0개, `DATA_GAP` fixture는 0으로 오해하지 않고 `DATA_GAP` 한 건이어야 한다.

- [ ] **Step 3: 실패 확인**

Run: `npx tsx scripts/test-operations-monitor.ts`  
Expected: FAIL — 모듈을 찾을 수 없음.

- [ ] **Step 4: detector 구현**

`OperationSignalKind`는 아래 값으로 닫힌 union을 사용한다.

```ts
export type OperationSignalKind =
  | "ENGINE_STALE" | "OUTPUT_STOPPED" | "MATERIAL_STOCKOUT" | "MATERIAL_CRITICAL"
  | "EMA_STARVATION" | "PENDING_APPROVAL" | "INBOUND_HOLD" | "FG_CAPACITY_OVER"
  | "SHIPMENT_STALLED" | "DATA_GAP" | "MONITOR_FAILURE";
```

`fingerprint`는 `sha256(`${kind}:${targetId}:${policyVersion}`)`로 만들고, 신호마다
`severity`, `affectedRoles`, `summary`, `evidence`, `releaseCondition`, `recordedAt`,
`operatingEpochMs`를 채운다. 입력은 기존 `tick-diagnosis`와 역할 엔진이 이미 판정한 결과다.
`SHIPMENT_STALLED`은 `availableQuantity>0`, `dueRemainingQty>0`, 마지막 출하가 실제 60분 이상
없거나 이력이 없을 때만 만든다.

- [ ] **Step 5: proposal 초안 규칙 구현**

`proposalDraftFor()`는 `ENGINE_STALE`·`DATA_GAP`·`MONITOR_FAILURE`에는 null을 반환한다.
그 외 CRITICAL 신호에는 아래 필드를 모두 채운다.

```ts
type OperationProposalDraft = {
  kind: OperationSignalKind;
  proposedByRole: "PROCUREMENT" | "MATERIALS" | "PRODUCTION" | "LOGISTICS";
  change: { kind: "ALLOWLIST_ACTION" | "CODE_OR_POLICY_CHANGE"; actionType: string; targetId: string; before: unknown; after: unknown };
  expectedEffects: string[];
  risks: string[];
  validationPlan: string[];
  rollbackPlan: string[];
};
```

`MATERIAL_STOCKOUT`에 미착 PO가 있으면 `CODE_OR_POLICY_CHANGE/REVIEW_REPLENISHMENT_GAP`, 없으면
`ALLOWLIST_ACTION/CREATE_INBOUND_PLAN_DRAFT`; `PENDING_APPROVAL`은
`ALLOWLIST_ACTION/APPROVE_PURCHASE_ORDER`; `INBOUND_HOLD`는
`ALLOWLIST_ACTION/RELEASE_INBOUND_HOLD`; 나머지는 `CODE_OR_POLICY_CHANGE`로 만든다.

- [ ] **Step 6: 테스트 등록·통과**

`package.json`에 `"test:operations-monitor": "tsx scripts/test-operations-monitor.ts"` 추가.

Run: `npm run test:operations-monitor`  
Expected: `✅ 운영 모니터 detector 테스트 통과`.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/operations-monitor.ts scripts/test-operations-monitor.ts package.json
git commit -m "feat(ops): detect fab operation incidents"
```

---

### Task 2: 운영 원장 DB 타입과 인덱스

**Files:**
- Modify: `src/lib/db.ts`
- Create: `src/lib/operations-monitor-server.ts`
- Test: `scripts/test-operations-monitor-persistence.ts` (create)

**Interfaces:**
- Consumes: Task 1의 `OperationSignal`, `OperationProposalDraft`
- Produces: `operationIncidents`, `operationLearningProposals`, `operationPolicyRevisions`, `operationMonitorState`

- [ ] **Step 1: DB 문서 타입 추가**

`src/lib/db.ts`에 다음 상태 union을 정확히 정의한다.

```ts
export type OperationIncidentStatus = "OBSERVED" | "ANALYZED" | "PROPOSED" | "RECOVERED";
export type OperationProposalStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "APPLYING" | "ACTIVE" | "FAILED" | "ROLLED_BACK" | "VERIFIED";
export type OperationRevisionDecision = "APPROVED" | "REJECTED";
```

다음 문서 계약을 추가한다. MongoDB `_id`는 각 공개 ID와 같은 문자열이다.

```ts
export interface OperationIncidentDoc {
  _id: string; fingerprint: string; kind: OperationSignalKind; severity: "ATTENTION" | "CRITICAL";
  status: OperationIncidentStatus; summary: string; affectedRoles: OperationRole[];
  policyVersions: string[]; firstObservedAt: Date; lastObservedAt: Date; recordedAt: Date;
  operatingEpochMs: number; observationCount: number; normalObservationCount: number;
  latestEvidence: Record<string, EvidenceValue>; worstEvidence: Record<string, EvidenceValue>;
  releaseCondition: string; proposalId: string | null; recoveredAt: Date | null;
}
export interface OperationLearningProposalDoc {
  _id: string; incidentIds: string[]; kind: OperationSignalKind; status: OperationProposalStatus;
  proposedByRole: OperationRole; change: OperationProposalDraft["change"];
  expectedEffects: string[]; risks: string[]; evidenceRefs: string[];
  validationPlan: string[]; rollbackPlan: string[]; previewHash: string;
  policyVersion: string; createdAt: Date; updatedAt: Date;
  decidedAt: Date | null; decidedBy: string | null; decisionReason: string | null;
  applyResult: Record<string, EvidenceValue> | null; requestId: string | null;
}
export interface OperationPolicyRevisionDoc {
  _id: string; proposalId: string; decision: OperationRevisionDecision;
  decidedBy: string; decidedAt: Date; recordedAt: Date; reason: string;
  previousVersion: string; newVersion: string | null;
  applyResult: Record<string, EvidenceValue> | null;
  verificationResult: Record<string, EvidenceValue> | null;
}
export interface OperationMonitorStateDoc {
  _id: "singleton"; leaseOwner: string | null; leaseUntil: Date | null;
  lastScanAt: Date | null; lastSuccessAt: Date | null; lastError: string | null;
}
```

- [ ] **Step 2: collections 접근자 등록**

`collections()` 반환 타입과 객체에 아래 네 컬렉션을 추가한다.

```ts
operationIncidents: Collection<OperationIncidentDoc>;
operationLearningProposals: Collection<OperationLearningProposalDoc>;
operationPolicyRevisions: Collection<OperationPolicyRevisionDoc>;
operationMonitorState: Collection<OperationMonitorStateDoc>;
```

- [ ] **Step 3: 인덱스 설치 구현**

`src/lib/operations-monitor-server.ts`의 `ensureOperationMonitorIndexes()`가 다음 인덱스를 만든다.

```ts
operationIncidents.createIndex({ fingerprint: 1 }, { unique: true });
operationIncidents.createIndex({ status: 1, severity: 1, lastObservedAt: -1 });
operationLearningProposals.createIndex({ incidentIds: 1, status: 1 });
operationLearningProposals.createIndex({ status: 1, createdAt: -1 });
operationPolicyRevisions.createIndex({ proposalId: 1, recordedAt: -1 });
```

- [ ] **Step 4: 타입·index 통합 테스트 작성**

고유 fingerprint 두 번 insert가 duplicate key로 실패하고, 서로 다른 fingerprint는 성공하는지
테스트한다. 테스트가 만든 문서는 `TEST-OPMON-` prefix만 삭제한다.

Run: `npx dotenv-cli -e .env -- npx tsx scripts/test-operations-monitor-persistence.ts`  
Expected: `✅ 운영 모니터 원장 인덱스 테스트 통과`.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/db.ts src/lib/operations-monitor-server.ts scripts/test-operations-monitor-persistence.ts
git commit -m "feat(ops): add operation learning ledgers"
```

---

### Task 3: 공통 관측 스냅샷 빌더

**Files:**
- Create: `src/lib/operations-observation-server.ts`
- Modify: `src/app/api/twin/tick-health/route.ts`
- Test: `scripts/test-operations-observation.ts` (create)
- Modify: `package.json`

**Interfaces:**
- Consumes: 기존 Twin·재고·PO·WIP·완제품·고객·출하 원장
- Produces: `buildOperationObservation(now?: Date): Promise<OperationObservationInput>`

- [ ] **Step 1: 현재 tick-health 계산 이동 테스트 작성**

`scripts/test-operations-observation.ts`는 DB fixture를 만들지 않고 반환 shape를 검증한다.

```ts
const observed = await buildOperationObservation(new Date());
assert.ok(Number.isFinite(observed.operatingEpochMs));
assert.ok(["RUNNING", "PAUSED"].includes(observed.engine.status));
assert.ok(Array.isArray(observed.materials));
assert.ok(Array.isArray(observed.warehouses));
assert.ok(Array.isArray(observed.shipments));
assert.ok(observed.materials.every((m) => m.coverageDays === null || Number.isFinite(m.coverageDays)));
```

- [ ] **Step 2: 단일 배치 조회 구현**

`buildOperationObservation()`는 필요한 컬렉션을 `Promise.all`로 읽고 다음을 반환한다.

```ts
{
  recordedAt, operatingEpochMs,
  engine: { status, secondsSinceTick, lifeSign, minutesSinceOutput },
  materials, procurement, inbound, production, warehouses, shipments, starvedMaterials, dataGaps,
}
```

자재 수요는 `burnedQty + shortfallQty`, PO 도착은 `etaOperatingMs`, 출하 계약 창은 운영시각을
사용한다. 필드가 없으면 0이 아니라 `dataGaps`에 컬렉션·필드명을 넣는다.

- [ ] **Step 3: tick-health route를 공통 빌더 사용으로 교체**

Route Handler의 인증·`force-dynamic`·`Cache-Control:no-store`는 유지한다. 응답은 기존
`diagnoseTick` view 계약을 유지해 현재 UI를 깨지 않는다.

- [ ] **Step 4: 테스트·타입 확인**

`package.json`에 `"test:operations-observation": "tsx scripts/test-operations-observation.ts"` 추가.

Run: `npx dotenv-cli -e .env -- npm run test:operations-observation && npm run test:tick-diagnosis && npm run typecheck`  
Expected: exit 0.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/operations-observation-server.ts src/app/api/twin/tick-health/route.ts scripts/test-operations-observation.ts package.json
git commit -m "refactor(ops): share live operation observation"
```

---

### Task 4: incident upsert·회복·proposal 생성

**Files:**
- Modify: `src/lib/operations-monitor-server.ts`
- Modify: `scripts/test-operations-monitor-persistence.ts`

**Interfaces:**
- Consumes: `buildOperationObservation()`, `detectOperationSignals()`, `proposalDraftFor()`
- Produces: `runOperationMonitorScan(options?): Promise<OperationMonitorScanResult>`

- [ ] **Step 1: 실패 통합 테스트 추가**

동일 signal을 두 번 처리했을 때 incident 1건·`observationCount=2`, active fingerprint가 다음 scan에
없을 때 `RECOVERED`, CRITICAL signal 두 번 관측 시 proposal 1건을 assert한다. 테스트 문서는
`TEST-OPMON-` prefix로 격리한다.

- [ ] **Step 2: lease 구현**

`acquireOperationMonitorLease(owner, now)`는 `_id:"singleton"`에 대해
`leaseUntil < now OR leaseOwner=owner` 조건으로 `findOneAndUpdate`하고 5분 lease를 건다. 실패하면
scan result `{ skipped:true, reason:"LEASE_HELD" }`를 반환한다.

- [ ] **Step 3: incident idempotent upsert 구현**

새 fingerprint는 `OBSERVED`, `observationCount=1`; 기존 active 문서는 `lastObservedAt`,
`observationCount`, `latestEvidence`, `worstEvidence`를 갱신한다. 신호가 없는 active incident는
두 번 연속 정상 관측 후 `RECOVERED`로 전환한다.

- [ ] **Step 4: proposal 승격 구현**

`severity=CRITICAL`이면서 `observationCount>=2`이거나 하드 임계인 신호만 proposal을 생성한다.
`proposalId=sha256(incidentId + change.actionType + policyVersion)`로 고정하고 `status=PROPOSED`로
upsert한다. 이 단계에서는 executor를 호출하지 않는다.

- [ ] **Step 5: 실패 기록·lease 해제**

예외는 `operationMonitorState.lastError`와 `MONITOR_FAILURE` incident로 기록하고 다시 throw하지
않아 Twin scheduler를 죽이지 않는다. finally에서 현재 owner의 lease만 해제한다.

- [ ] **Step 6: 테스트 통과**

Run: `npx dotenv-cli -e .env -- npm run test:operations-monitor-persistence`  
Expected: dedupe·회복·proposal·lease 전부 PASS.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/operations-monitor-server.ts scripts/test-operations-monitor-persistence.ts
git commit -m "feat(ops): persist incidents and improvement proposals"
```

---

### Task 5: scheduler와 조회 API

**Files:**
- Create: `src/lib/operations-monitor-scheduler.ts`
- Modify: `src/instrumentation.ts`
- Create: `src/app/api/twin/operations-monitor/route.ts`

**Interfaces:**
- Consumes: `ensureOperationMonitorIndexes()`, `runOperationMonitorScan()`
- Produces: `startOperationMonitorScheduler()`, authenticated monitor view API

- [ ] **Step 1: self-scheduling 모니터 구현**

```ts
const MONITOR_INTERVAL_MS = 60_000;
let started = false;

function scheduleNext(): void {
  setTimeout(() => {
    runOperationMonitorScan()
      .catch((error) => console.error("[operations-monitor] scan 실패:", error))
      .finally(scheduleNext);
  }, MONITOR_INTERVAL_MS);
}

export function startOperationMonitorScheduler(): void {
  if (started) return;
  started = true;
  void ensureOperationMonitorIndexes().then(() => runOperationMonitorScan()).finally(scheduleNext);
}
```

- [ ] **Step 2: instrumentation 독립 기동 추가**

현재 `startScheduler()`와 `Promise.all` 패턴을 보존하고 세 번째 항목만 추가한다.

```ts
startScheduler("operations-monitor", async () => (await import("@/lib/operations-monitor-scheduler")).startOperationMonitorScheduler)
```

- [ ] **Step 3: 조회 API 작성**

`GET /api/twin/operations-monitor`는 `WRITE_ROLES.collaboration` 인증 후 active incident,
`PROPOSED|APPROVED|APPLYING|ACTIVE|FAILED` proposal, 최근 revision 20건, monitor state를 병렬 조회해
ISO 문자열 view로 반환한다. `dynamic="force-dynamic"`, `Cache-Control:no-store`를 적용한다.

- [ ] **Step 4: 정적·기존 회귀 검사**

Run: `npm run test:operations-monitor && npm run test:tick-diagnosis && npm run typecheck && npx eslint src/lib/operations-monitor*.ts src/app/api/twin/operations-monitor/route.ts src/instrumentation.ts`  
Expected: exit 0.

- [ ] **Step 5: 서버 로그와 DB 실관측 확인**

서버 재기동 후 로그에 `[instrumentation] operations-monitor 기동`과 scan 성공을 확인한다.
2분 뒤 `operationIncidents`에서 동일 fingerprint 중복이 없고 `observationCount>=2`인지 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/operations-monitor-scheduler.ts src/instrumentation.ts src/app/api/twin/operations-monitor/route.ts
git commit -m "feat(ops): run continuous operation monitor"
```
