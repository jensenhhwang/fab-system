# Process Agent Master — 설비·공정 배정 담당 에이전트

상태: `LIVE_NARROW_SCOPE`
버전: `PROCESS_AGENT_MASTER_V0` (실행 로직 자체는 레거시 `M20_AGENT_POLICY_V1` 공유)
기준일: 2026-07-26
대상: `AgentRole = "PROCESS"`

이 문서는 [`procurement-master.md`](./procurement-master.md)·[`wms-master.md`](./wms-master.md)·[`mes-master.md`](./mes-master.md)의 틀을 따른다. §3.3에 이 문서 작성 중 발견해 같은 세션에서 수정한 결함을 기록한다.

## 1. 문서 목적

PROCESS 에이전트가 **실제로 무엇을 배정하는지, "공정(Process)"이라는 이름이 왜 오해를 부르는지, 그리고 HUMAN 모드 토글이 실제로는 작동하지 않는다는 것**을 정의하는 상위 기준이다.

## 2. 이름과 실제 사이의 간극 — 가장 크다

4개 에이전트 중 이름과 실제 역할의 거리가 가장 먼 게 PROCESS다. "공정 담당"이라는 이름은 Route(P01~P10)·Recipe·공정 파라미터·수율 관리를 연상시키지만, `agentRole: "PROCESS"`로 기록되는 실제 판단은 `releaseMesAndAssignEquipment()`(`src/lib/m20-agent-service.ts`) 안의 딱 하나 — **작업지시에 물리 설비 1대를 배정하는 것**뿐이다.

- Route/Recipe(`route-master.md`가 정의하는 P01~P10 공정 순서)는 정적 마스터 데이터이고, 이 에이전트가 참조하지도 관여하지도 않는다.
- 공정 파라미터·수율·품질 판정은 이 코드베이스 어디에도 에이전트로 존재하지 않는다.
- "PROCESS 에이전트"는 사실상 **"장비 배정 에이전트"**다. 다음 설계·구현에서 이 이름 격차를 그대로 둘지, 이름을 바꿀지(`EQUIPMENT`) 결정해야 한다 — 이 문서는 코드 실태를 반영해 서술하되, 명칭 변경은 범위 밖으로 둔다.

## 3. 역할 정의

### 3.1 담당하는 것 (이미 실행 중, M20 파일럿 범위)

`releaseMesAndAssignEquipment()`이 실제로 하는 일:

- 대상 작업지시의 `fabId`+`processCode`와 일치하고, 상태가 `RUN`/`IDLE`이며, 이미 다른 WO에 배정(`RESERVED`/`ACTIVE`)되지 않은 설비를 찾는다.
- **실측 우선** — `source: "MES_MASTER"`(실측 설비 데이터) 중 OEE 내림차순 1순위를 먼저 찾고, 없으면 `source: "MODELED_BASELINE"`(모델 추정치)로 대체 탐색한다.
- 찾으면 `EquipmentAssignmentDoc`을 `RESERVED`로 생성한다. 못 찾으면 `NO_AVAILABLE_EQUIPMENT`로 BLOCKED.

### 3.2 경계

**지금(M20 파일럿 범위)만 안 하는 것 — 로드맵 따라 넓어짐:**

- **여러 설비 중 진짜 최적 배정** — 지금은 OEE 하나만 기준이다. 잔여 Capacity, 다음 PM(보전) 일정, 셋업 시간 차이 같은 건 고려하지 않는다.
- **M20 파일럿 외 작업지시** — 다른 에이전트들과 동일한 제약.

**이 에이전트는 영원히 안 하는 것 — 다른 곳이 담당(하거나, 아직 아무 데도 없음):**

- **Route/Recipe 결정** — `route-master.md`가 정의하는 정적 마스터다. 에이전트 판단 대상이 아니다.
- **공정 파라미터·수율·품질 판정** — 이 코드베이스 어디에도 없다. "PROCESS 에이전트가 공정을 운영한다"는 사용자의 비전에 가장 못 미치는 지점이 여기다.

### 3.3 발견한 결함(수정됨) — HUMAN 모드 토글이 작동하지 않았다

`M20PilotFlowCard.tsx`는 PROCUREMENT·WMS·MES·PROCESS 4개 역할 전부에 대해 "공정 담당"(`AGENT_LABEL.PROCESS`) AGENT/HUMAN 토글 버튼을 사용자에게 보여준다. 그런데 `orchestrateM20Agents()`(`src/lib/m20-agent-service.ts`)를 끝까지 확인한 결과, `roleModes.PROCUREMENT`·`roleModes.WMS`·`roleModes.MES`는 각각 코드에서 `=== "HUMAN"`으로 실제 체크되지만 **`roleModes.PROCESS`는 단 한 번도 체크되지 않았다.**

즉 사용자가 화면에서 "공정 담당"을 HUMAN으로 바꿔도, 설비 배정은 여전히 100% 자동 실행됐다. **UI가 주는 통제감과 실제 동작이 달랐다.**

**같은 세션에서 수정 완료** — WMS/MES와 동일한 `HUMAN_MODE_HOLD` 패턴을 PROCESS에도 적용(`roleModes.PROCESS === "HUMAN" && trigger === "AUTO"` 체크 추가, `nextHumanAction: "PROCESS_MANUAL_RUN"`). typecheck·lint·기존 유닛테스트 통과, 브라우저에서 토글 왕복 동작 확인. 다만 검증 시점에 M20 파일럿 WO가 업스트림 WMS 단계에서 이미 BLOCKED(`FEFO_EXACT_HU_UNAVAILABLE`, 이 결함과 무관한 별개 재고 이슈) 상태라 PROCESS 게이트까지 실제로 도달하는 hold 동작의 완전한 E2E 확인은 못 했다 — 코드는 이미 라이브로 검증된 WMS/MES 패턴을 정확히 미러링한다.

## 4. 트리거

MES와 완전히 같은 호출 경로를 공유한다 — `releaseMesAndAssignEquipment()` 자체가 MES의 게이트 통과 시 호출되는 함수이기 때문에, PROCESS는 **독립된 트리거가 없다.** MES 판단과 한 함수 호출 안에서 묶여 있다.

## 5. 판단 로직

### 5.1 입력

- `EquipmentMasterDoc` — `fabId`+`processCode` 일치, `status ∈ {RUN, IDLE}`, `source`(MES_MASTER 우선)
- `EquipmentAssignmentDoc` — 이미 점유된(`RESERVED`/`ACTIVE`) 설비 ID 목록(제외 대상)

### 5.2 계산 — 실측 우선 + OEE 정렬

```text
점유중 설비 ID = equipmentAssignments에서 RESERVED/ACTIVE 상태 distinct
후보 = equipmentMaster에서 fabId+processCode 일치 && RUN/IDLE && 점유중 아님
  1차: source=MES_MASTER 중 OEE 내림차순 1건
  없으면: source=MODELED_BASELINE 중 OEE 내림차순 1건
없으면: BLOCKED(NO_AVAILABLE_EQUIPMENT)
```

## 6. 자율 등급 — 개념 이전에 스위치부터 고쳐야 함

WMS처럼 "위험도 기반 자율 등급"을 설계하기 전에, **PROCESS는 먼저 기본적인 AGENT/HUMAN 스위치부터 실제로 작동하게 만들어야 한다**(§3.3). 등급 설계는 그 다음이다.

## 7. 로드맵

| 단계 | 내용 | 상태 |
|---|---|---|
| 현재 | 실측 우선 OEE 기반 단일 설비 배정, M20 파일럿 범위 | ✅ 라이브 (`M20_AGENT_POLICY_V1`) |
| PROCESS-0 (버그픽스) | `roleModes.PROCESS === "HUMAN"` 체크를 `orchestrateM20Agents()`에 추가 — UI 토글을 실제로 작동시킴 | ✅ 수정 완료(§3.3) |
| PROCESS-1 | 배정 판단 서술화 — 왜 이 설비를 골랐는지(OEE·실측/모델 출처) 사람이 읽는 화면으로 노출 | ❌ 미착수 |
| PROCESS-2 | 다중 조건 최적화 — 잔여 Capacity·PM 일정·셋업 시간까지 배정 기준에 반영 | ❌ 미착수 |
| PROCESS-3 (범위 재정의) | Route/Recipe·공정 파라미터 판단을 실제로 담당할지 결정 — 지금 이름과 실제 역할의 간극(§2)을 이 단계에서 좁히거나, 역할명을 재정의 | ❌ 미착수, 설계 결정 필요 |

## 8. 관련 문서와 구현

- 자매 문서: [`procurement-master.md`](./procurement-master.md), [`wms-master.md`](./wms-master.md), [`mes-master.md`](./mes-master.md)
- 실행 로직: `src/lib/m20-agent-service.ts` (`releaseMesAndAssignEquipment`)
- 공정 Route 정적 마스터(이 에이전트가 참조하지 않음): [`route-master.md`](../route-master.md)
- HUMAN 토글 UI(작동 안 함, §3.3): `src/app/(dashboard)/mes/M20PilotFlowCard.tsx`
- 역할 모드 저장소: `src/lib/db.ts`(`AgentRoleModeDoc`), `src/app/api/agents/mode/route.ts`

4개 에이전트 문서(PROCUREMENT·WMS·MES·PROCESS) 작성 완료. 다음은 이 4개를 실제로 연결하는 작업이다.
