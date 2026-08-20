# Operation Improvement Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관제탑에서 운영 incident와 개선 proposal의 근거·diff·위험을 확인하고, ADMIN이 승인한 변경만 한 번 반영한 뒤 결과와 정책 버전을 감사 원장에 남긴다.

**Architecture:** 순수 상태 머신이 허용 전이를 검증하고 서버 서비스가 optimistic update와 request hash로 결정·실행을 직렬화한다. allowlist 운영 조치는 기존 도메인 서비스의 preview hash를 재검증해 승인 직후 실행하고, 코드·마스터 개선은 승인 기록만 남겨 Codex 구현을 기다린다. 별도 Client Component가 관제탑 조회 API를 polling하고 승인·반려를 수행한다.

**Tech Stack:** Next.js 16.2.10 App Router · React 19 Client Components · MongoDB native driver · existing role auth · TypeScript · `node:assert/strict`

## Global Constraints

- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`와 `use-client.md`를 따른다.
- 승인·반려는 ADMIN만 가능하고 same-origin 요청만 허용한다.
- 미승인 proposal은 어떤 운영 데이터도 바꾸지 않는다.
- 위험물·법적 capacity·음수재고·단위 혼합·감사 이력·공통 24× 시계·승인 권한은 executor 대상이 아니다.
- allowlist 실행은 동일 preview hash, 만료 전 snapshot, request ID를 모두 검증한다.
- 앱은 자기 소스 코드를 수정하지 않는다. 코드·마스터 변경은 `AWAITING_IMPLEMENTATION`으로 남긴다.
- 사용자가 명시하지 않았으므로 서브에이전트를 호출하지 않는다.

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/operation-improvement.ts` | proposal 상태 전이와 결정 명령 순수 검증 |
| `src/lib/operation-improvement-server.ts` | 승인·반려·allowlist 실행·revision 영속화 |
| `src/app/api/twin/operations-monitor/proposals/[proposalId]/decision/route.ts` | ADMIN 결정 API |
| `src/components/OperationsImprovementInbox.tsx` | incident·proposal·revision UI와 polling |
| `src/app/(dashboard)/page.tsx` | 관제탑 개선함 배치 |
| `scripts/test-operation-improvement.ts` | 상태 전이·권한 입력·idempotency 순수 테스트 |
| `scripts/test-operation-improvement-server.ts` | 승인 전 무변경·한 번 실행 DB 통합 테스트 |

---

### Task 1: 승인 상태 머신

**Files:**
- Create: `src/lib/operation-improvement.ts`
- Create: `scripts/test-operation-improvement.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `OperationProposalStatus`, 사용자 결정 명령
- Produces: `decideProposalTransition(input): ProposalTransition`

- [ ] **Step 1: 실패 테스트 작성**

```ts
import assert from "node:assert/strict";
import { decideProposalTransition } from "../src/lib/operation-improvement";

assert.equal(decideProposalTransition({ current:"PROPOSED", decision:"APPROVE", changeKind:"ALLOWLIST_ACTION" }).next, "APPLYING");
assert.equal(decideProposalTransition({ current:"PROPOSED", decision:"APPROVE", changeKind:"CODE_OR_POLICY_CHANGE" }).next, "APPROVED");
assert.equal(decideProposalTransition({ current:"PROPOSED", decision:"REJECT", changeKind:"ALLOWLIST_ACTION" }).next, "REJECTED");
assert.throws(() => decideProposalTransition({ current:"REJECTED", decision:"APPROVE", changeKind:"ALLOWLIST_ACTION" }), /INVALID_PROPOSAL_TRANSITION/);
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx scripts/test-operation-improvement.ts`  
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 최소 상태 머신 구현**

```ts
export function decideProposalTransition(input: {
  current: OperationProposalStatus;
  decision: "APPROVE" | "REJECT";
  changeKind: "ALLOWLIST_ACTION" | "CODE_OR_POLICY_CHANGE";
}) {
  if (input.current !== "PROPOSED") throw new Error("INVALID_PROPOSAL_TRANSITION");
  if (input.decision === "REJECT") return { next: "REJECTED" as const, execute: false };
  if (input.changeKind === "ALLOWLIST_ACTION") return { next: "APPLYING" as const, execute: true };
  return { next: "APPROVED" as const, execute: false };
}
```

- [ ] **Step 4: 테스트 등록·통과**

`package.json`에 `"test:operation-improvement": "tsx scripts/test-operation-improvement.ts"` 추가.

Run: `npm run test:operation-improvement`  
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/operation-improvement.ts scripts/test-operation-improvement.ts package.json
git commit -m "feat(ops): define improvement approval transitions"
```

---

### Task 2: allowlist preview executor

**Files:**
- Create: `src/lib/operation-improvement-server.ts`
- Create: `scripts/test-operation-improvement-server.ts`

**Interfaces:**
- Consumes: proposal `change.actionType`, 기존 입고계획·PO 승인·입고보류 도메인 서비스
- Produces: `previewOperationImprovement(proposal)`, `executeApprovedOperationImprovement(input)`

- [ ] **Step 1: action allowlist를 닫힌 타입으로 정의**

```ts
type AllowlistActionType =
  | "CREATE_INBOUND_PLAN_DRAFT"
  | "APPROVE_PURCHASE_ORDER"
  | "RELEASE_INBOUND_HOLD";
```

각 action은 기존 서비스 함수를 직접 호출하고 Route Handler를 HTTP로 재호출하지 않는다.
`CREATE_INBOUND_PLAN_DRAFT`는 `previewInventoryScaleUpDraftForMaterial`,
`APPROVE_PURCHASE_ORDER`는 `decideTwinPurchaseOrder`, `RELEASE_INBOUND_HOLD`는
`releaseTwinInboundHold` 서버 함수를 사용한다. 세 함수는 각각
`inventory-scaleup-service.ts`, `twin/purchase-order-decision-server.ts`,
`twin/inbound-hold-decision-server.ts`에서 직접 import한다.

- [ ] **Step 2: preview hash 생성**

proposal 작성 시점의 대상 ID, before/after, source evidence hash, 운영시각을 안정 정렬 JSON으로
직렬화해 SHA-256 `previewHash`를 만든다. 승인 시 최신 preview를 다시 계산하고 다르면
`OPERATION_PROPOSAL_STALE`로 실패시킨다.

- [ ] **Step 3: 실행 idempotency 구현**

`executeApprovedOperationImprovement({ proposalId, userId, requestId })`는
`status=APPLYING`과 동일 requestId 조건으로만 실행한다. 이미 `ACTIVE|VERIFIED`이고 requestId가
같으면 기존 결과를 반환하고, 다른 requestId면 409를 반환한다.

- [ ] **Step 4: 통합 테스트 작성**

테스트용 `CODE_OR_POLICY_CHANGE` proposal 승인 전후 도메인 컬렉션 count가 동일한지 확인한다.
테스트용 allowlist proposal은 stub executor를 dependency injection하여 호출 1회, 동일 requestId
재시도 결과 동일, 다른 requestId 거부를 assert한다. 문서는 `TEST-OPIM-` prefix로 정리한다.

- [ ] **Step 5: 테스트 통과**

Run: `npx dotenv-cli -e .env -- npx tsx scripts/test-operation-improvement-server.ts`  
Expected: 승인 전 무변경·idempotency·stale preview 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/operation-improvement-server.ts scripts/test-operation-improvement-server.ts
git commit -m "feat(ops): execute only approved improvement actions"
```

---

### Task 3: ADMIN 결정 API와 revision 원장

**Files:**
- Modify: `src/lib/api-auth.ts`
- Create: `src/app/api/twin/operations-monitor/proposals/[proposalId]/decision/route.ts`
- Modify: `src/lib/operation-improvement-server.ts`

**Interfaces:**
- Consumes: `{ decision, reason, requestId }`, authenticated ADMIN
- Produces: `POST .../decision`, `OperationPolicyRevisionDoc`

- [ ] **Step 1: ADMIN 전용 role set 추가**

`WRITE_ROLES`에 `operationImprovementDecision: ["ADMIN"]`을 추가한다.

- [ ] **Step 2: Route Handler 입력 검증 작성**

Next.js 16의 async params 계약을 사용한다.

```ts
export async function POST(request: Request, { params }: { params: Promise<{ proposalId: string }> }) {
  const access = await requireRole(WRITE_ROLES.operationImprovementDecision);
  if (access.error) return access.error;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "허용되지 않은 요청 출처입니다." }, { status: 403 });
  const { proposalId } = await params;
  // proposalId 64자리 hex, decision APPROVE|REJECT, reason 1~500자, requestId UUID 검증
}
```

- [ ] **Step 3: 원자적 결정·revision 기록**

proposal을 `{_id:proposalId,status:"PROPOSED"}` 조건으로 `findOneAndUpdate`한다. 성공한 한 요청만
revision을 생성한다. `revisionId=sha256(proposalId + decision + requestId)`, `decidedAt`과
`recordedAt`은 실제 벽시계로 저장한다.

allowlist 승인 성공은 proposal `ACTIVE`, 실행 실패는 `FAILED`; 코드·정책 승인은 `APPROVED`와
`applyResult.status="AWAITING_IMPLEMENTATION"`으로 기록한다. 반려는 `REJECTED`와 이유를 보존한다.

- [ ] **Step 4: API 오류 계약 구현**

- 400: 잘못된 ID·결정·이유·requestId
- 401/403: 세션·권한
- 404: proposal 없음
- 409: 이미 결정됨, stale preview, 다른 requestId 재시도
- 500: 예상하지 못한 적용 실패

- [ ] **Step 5: 타입·통합 테스트**

Run: `npm run typecheck && npx eslint src/lib/api-auth.ts src/lib/operation-improvement-server.ts 'src/app/api/twin/operations-monitor/proposals/[proposalId]/decision/route.ts'`  
Expected: exit 0.

Run: `npx dotenv-cli -e .env -- npx tsx scripts/test-operation-improvement-server.ts`  
Expected: revision·상태 전이 assertions PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/api-auth.ts src/lib/operation-improvement-server.ts 'src/app/api/twin/operations-monitor/proposals/[proposalId]/decision/route.ts'
git commit -m "feat(ops): record admin improvement decisions"
```

---

### Task 4: 관제탑 개선함 Client Component

**Files:**
- Create: `src/components/OperationsImprovementInbox.tsx`
- Modify: `src/app/(dashboard)/page.tsx`

**Interfaces:**
- Consumes: `GET /api/twin/operations-monitor`, proposal decision POST
- Produces: 현재 이상·승인 요청·적용 결과 UI

- [ ] **Step 1: serializable view 타입 export**

`src/lib/operations-monitor.ts`에 Date가 없는 `OperationMonitorView`를 정의한다. API는 모든 Date를
ISO 문자열로 변환하고 Client Component는 이 타입만 import한다. 최상위에
`canDecide:boolean`을 넣어 ADMIN에게만 결정 버튼을 노출한다.

- [ ] **Step 2: polling·visibility 제어 구현**

`"use client"`를 파일 첫 줄에 두고, 기존 `ControlTowerLiveClient` 패턴처럼 AbortController,
`document.hidden`, 10초 polling, visibility 복귀 즉시 refresh를 사용한다. 겹치는 fetch를 막는다.

- [ ] **Step 3: 세 구역 렌더링**

- 현재 이상: severity, 종류, 요약, 최초/최근 관측, 횟수, 영향 역할, 회복 조건
- 승인 요청: before→after JSON 요약, 효과, 위험, 검증·rollback, 승인/반려
- 적용 결과: 결정자, 벽시계 결정 시각, 상태, 새 policy version, 검증 또는 실패 이유

상태는 색뿐 아니라 한국어 텍스트와 아이콘으로 함께 표시한다.

- [ ] **Step 4: 승인·반려 상호작용 구현**

승인은 `window.confirm`으로 diff·위험을 마지막 확인하고 UUID requestId와 이유를 POST한다.
반려는 1~500자 이유를 입력받아 POST한다. 요청 중 해당 카드 버튼을 비활성화하고 성공 후 즉시
reload, 실패 시 카드 안에 서버 오류를 표시한다.

- [ ] **Step 5: 관제탑에 배치**

`src/app/(dashboard)/page.tsx`에서 `ControlTowerLiveClient` 아래, `ControlTowerAskPanel` 위에
`OperationsImprovementInbox`를 둔다. 서버 page 자체에서 monitor 데이터를 fetch하지 않는다.

- [ ] **Step 6: 정적·브라우저 검증**

Run: `npm run typecheck && npx eslint src/components/OperationsImprovementInbox.tsx 'src/app/(dashboard)/page.tsx'`  
Expected: exit 0.

브라우저에서 ADMIN은 승인·반려 버튼을 보고, 다른 역할은 incident와 proposal만 읽으며 결정
버튼이 렌더링되지 않는다. API를 직접 호출하면 403이어야 한다. 빈 상태는 “현재 승인 대기 개선안
없음”으로 표시한다.

- [ ] **Step 7: 커밋**

```bash
git add src/components/OperationsImprovementInbox.tsx 'src/app/(dashboard)/page.tsx' src/lib/operations-monitor.ts
git commit -m "feat(ops): add control tower improvement inbox"
```

---

### Task 5: 승인 후 검증과 첫 개선안 운영 확인

**Files:**
- Create: `scripts/verify-operation-monitor-live.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: 세 운영 원장, health API, monitor state
- Produces: 운영 완료 여부를 exit code로 판정하는 verifier

- [ ] **Step 1: verifier 작성**

verifier는 다음 조건이 모두 참이 아니면 exit 1로 종료한다.

```text
monitorState.lastSuccessAt이 실제 3분 이내
active incident fingerprint 중복 0
PROPOSED proposal마다 incidentIds·evidenceRefs·validationPlan·rollbackPlan 존재
APPROVED 이후 revision 없는 proposal 0
ACTIVE|VERIFIED allowlist proposal마다 applyResult와 requestId 존재
미승인 proposal의 applyResult 없음
```

- [ ] **Step 2: package 명령 등록**

`package.json`에 `"verify:operation-monitor": "tsx scripts/verify-operation-monitor-live.ts"` 추가.

- [ ] **Step 3: 전체 회귀 실행**

Run:

```bash
npm run test:server-health
npm run test:fab-watchdog
npm run test:fab-launchd
npm run test:operations-monitor
npx dotenv-cli -e .env -- npm run test:operations-observation
npx dotenv-cli -e .env -- npm run test:operations-monitor-persistence
npm run test:operation-improvement
npx dotenv-cli -e .env -- npx tsx scripts/test-operation-improvement-server.ts
npm run typecheck
npm run lint
```

Expected: 전부 exit 0.

- [ ] **Step 4: 실제 2회 관측과 verifier 실행**

watchdog 서버를 2분 이상 실행한 뒤:

Run: `npx dotenv-cli -e .env -- npm run verify:operation-monitor`  
Expected: `✅ FAB 운영 모니터 live 검증 통과`.

- [ ] **Step 5: 첫 개선안 사용자 제시**

가장 심각한 `PROPOSED` 한 건의 incident 근거, before→after, 기대 효과, 위험, 검증·rollback을
관제탑과 대화에 같은 내용으로 표시한다. 사용자가 승인하기 전에는 적용하지 않는다.

- [ ] **Step 6: 커밋**

```bash
git add scripts/verify-operation-monitor-live.ts package.json
git commit -m "test(ops): verify monitored improvement lifecycle"
```
