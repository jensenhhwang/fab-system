# WMS Agent Master — 창고·입출고 담당 에이전트

상태: `LIVE_M20_PILOT_ONLY`
버전: `WMS_AGENT_MASTER_V0` (실행 로직 자체는 레거시 `M20_AGENT_POLICY_V1` 공유)
기준일: 2026-07-26
대상: `AgentRole = "WMS"`

이 문서는 [`procurement-master.md`](./procurement-master.md)의 틀을 따르되, WMS 에이전트의 실제 상태가 PROCUREMENT와 **정반대**라는 점을 반영해 구조를 조정했다.

## 1. 문서 목적

이 문서는 WMS 에이전트가 **무엇을 이미 실제로 실행하고 있고, 어디까지만 실행하며, 왜 아직 설명 가능하지 않은지**를 정의하는 상위 기준이다.

## 2. WMS는 PROCUREMENT의 반대 극단이다

PROCUREMENT 에이전트는 "판단은 잘하는데 실행은 0건"(그림자모드)이었다. **WMS는 정확히 반대다 — 실행은 이미 실제로 하는데, 판단 과정을 설명하는 화면이 없다.**

| | PROCUREMENT (그림자) | WMS (이 문서) |
|---|---|---|
| 실제 재고·Lot·창고 데이터 변경 | ❌ 없음 (온디맨드 계산만) | ✅ 있음 — Lot 예약, Handling Unit 상태 변경, TransferOrder 상태 전이를 실제 트랜잭션으로 실행 |
| 범위 | 전체 자재(63종) 재고 스냅샷 | **M20 파일럿 1개 작업지시 흐름**(`WorkOrderDoc.scope === "M20_PILOT"`)에만 한정 |
| 판단을 사람이 읽을 수 있는 화면 | ✅ `/procurement-cockpit` (4단계 추론 사슬) | ❌ 없음. 결정 로그(`agentDecisions`)는 쌓이지만 이를 보여주는 UI가 없다 |
| 자율 등급 개념 | 자재별 L2/L4 상한 (코드 계산, §6) | ❌ 없음. `AgentRoleModeDoc`의 AGENT/HUMAN 2단 토글만 있다 (자재·창고·위험도 구분 없이 역할 전체가 하나의 스위치) |
| 트리거 | 사람이 화면 열 때 | 작업지시(WO) 생성 직후 자동 (`createM20PilotWorkOrder` → `orchestrateM20Agents`) |

**결론:** WMS 에이전트를 "다음 단계로 발전"시킨다는 건 PROCUREMENT처럼 "그림자에서 실행으로"가 아니라, **"이미 실행 중인 좁은 범위를 넓히고, 그 실행에 설명 가능성과 자율 등급을 붙이는 것"**이다.

## 3. 역할 정의

### 3.1 담당하는 것 (이미 실행 중, M20 파일럿 범위)

`reserveM20PilotMaterial()` (`src/lib/m20-agent-service.ts`)이 실제로 하는 일:

- **FEFO 기준 Lot 선정** — 유효기간(`expiryDate`) 오름차순으로 정렬해, 필요 수량 이상 가용한 Handling Unit을 가진 Lot을 순서대로 탐색한다. 이것도 하나의 판단 로직이다 — "유효기간이 가장 임박한 것부터 쓴다"는 결정론 규칙.
- **재고 예약** — 선택된 Lot의 `availableQuantity`를 차감하고, Handling Unit을 `RESERVED`로 전환한다. 부분 수량만 필요하면 잔량으로 새 Handling Unit을 분할 생성한다.
- **TransferOrder 상태 전이** — `CREATED → PICKING`으로 전환하고 출발 창고·위치를 확정한다.
- 이 모든 과정을 MongoDB 트랜잭션(`session.withTransaction`)으로 묶어 원자적으로 실행하고, `requestId` 멱등키로 중복 실행을 막는다.

### 3.2 경계

**지금(M20 파일럿 범위)만 안 하는 것 — 로드맵 따라 넓어짐:**

- **M20 외 다른 작업지시 흐름** — M21·M22, 또는 M20의 파일럿이 아닌 일반 작업지시에는 이 자동 예약 로직이 붙어 있지 않다. WO 생성 시 `scope !== "M20_PILOT"`이면 애초에 `orchestrateM20Agents`가 트리거되지 않는다.
- **재고 상태 변경(Hold/격리/해제)** — `POST /api/warehouse/status`가 존재하지만 사람이 직접 호출하는 수동 액션이다. 에이전트가 스스로 "이 Lot은 이상하니 격리한다"를 판단해 실행하지 않는다.
- **창고 간 이동 경로 최적화** — 지금은 Lot이 있는 창고에서 목적지로 직행하는 경로만 있다. 여러 창고 후보 중 비용·거리·Capacity를 비교해 선택하는 판단은 없다.
- **자재 안전성 하드가드** — PROCUREMENT처럼 "위험물이면 자동 실행 상한을 낮춘다" 같은 코드가 WMS에는 없다. HZW-01(위험물창고) 자재를 예약·이동할 때도 일반 자재와 동일한 경로를 탄다. **이건 안전 공백이다** — [§6](#6-자율-등급-미정의-상태) 참고.

**이 에이전트는 영원히 안 하는 것 — 다른 에이전트가 실제로 자동 실행함:**

- **발주 판단** — PROCUREMENT 영역이다 ([`procurement-master.md`](./procurement-master.md)).
- **생산계획·공정 실행 판단** — MES/PROCESS 영역이다 (미설계).

## 4. 트리거

| 방식 | 현재 여부 |
|---|---|
| M20 파일럿 작업지시 생성 시 자동 | ✅ `createM20PilotWorkOrder()` 마지막에 `orchestrateM20Agents()` 호출 |
| 사람이 화면에서 수동 재시도 | ✅ `POST /api/agents/m20/[workOrderId]` |
| MES 피킹 확정·소비 시 후속 전이 | ✅ `/api/mes/workorders/[id]/pick`, `/consume`이 같은 오케스트레이션 경로를 탄다 |
| 다른 작업지시(M20 파일럿 외)에서 자동 실행 | ❌ 없음 |
| 창고 재고 이상(격리·만료임박) 감지 시 자동 개입 | ❌ 없음 |

PROCUREMENT와 달리 **WMS는 이미 "누가 안 보고 있어도" 동작한다** — WO 생성이라는 이벤트가 트리거이지, 사람이 화면을 여는 게 트리거가 아니다.

## 5. 판단 로직

### 5.1 입력

- `workOrders` — 대상 WO의 BOM 첫 줄(`bomLines[0]`), scope·fabId
- `materialAllocations` — `PLANNED`/`RESERVED` 상태의 활성 Allocation
- `transferOrders` — `CREATED`/`PICKING` 상태의 전송 주문
- `inventoryLots` — `qualityStatus: "AVAILABLE"`, 필요 수량 이상, `simulated: { $ne: true }`
- `handlingUnits` — 위 Lot에 연결되고 `STORED`(또는 미설정) 상태인 용기

### 5.2 계산 — FEFO + 가용성 매칭

```text
Lot 후보 = 자재ID 일치 && AVAILABLE && availableQuantity >= 필요수량
  → expiryDate 오름차순, receivedAt 오름차순 정렬, 상위 30건
for 각 Lot 후보:
  해당 Lot에 연결된 Handling Unit 중 AVAILABLE·필요수량 이상·quantity 오름차순 1건 탐색
  찾으면 그 Lot·HU로 확정, 탐색 중단
못 찾으면: "FEFO 기준 {수량}{단위} 이상인 가용 HU가 없습니다" 에러로 BLOCKED
```

PROCUREMENT의 4단계 추론 사슬 같은 **서술화 레이어가 없다.** `agentDecisions`에 `reasonCodes`는 남지만(예: `ISSUE_PICK_TASK`), 이걸 사람이 읽는 문장으로 바꿔 보여주는 화면이 없다 — [§7 로드맵](#7-로드맵)의 최우선 과제.

### 5.3 결과 기록

레거시 `agentDecisions`에 `agentRole: "WMS"`로 기록(`AUTO_EXECUTED`/`BLOCKED`/`HUMAN_MODE_HOLD`). PROCUREMENT의 새 그림자 에이전트와 달리, WMS는 **처음부터 지금까지 계속 이 레거시 저장소를 그대로 쓰고 있다** — 신규/레거시로 나뉘지 않는다.

## 6. 자율 등급 — 사실상 미정의 상태

PROCUREMENT는 자재 위험도(위험물·단일소싱)에 따라 L2/L4 상한을 코드로 계산한다([`procurement-master.md`](./procurement-master.md) §6). **WMS에는 이런 개념이 전혀 없다.** 있는 건 `AgentRoleModeDoc`의 역할 전체 단위 AGENT/HUMAN 토글 하나뿐이고, 이건 자재·창고·수량과 무관하게 WMS 전체를 한 번에 켜고 끈다.

**이게 왜 문제인가:** 지금 자동 실행되는 예약 로직은 HZW-01(특수가스 위험물창고) 자재도, 일반 소모품도 구분 없이 똑같이 자동 실행한다. PROCUREMENT 문서가 정의한 "위험물은 자동 실행 상한을 낮춘다"는 원칙이 WMS에는 아직 적용되지 않았다.

**제안(다음 설계 시 반영해야 함):**

| WMS용 자율 등급 후보 | 기준 |
|---|---|
| L2 상당 (사람 확인 필요) | 위험물창고(HZW-01) 출고·이동, 또는 만료 임박(D-7 이내) Lot 사용 |
| L4 상당 (자동 실행 유지) | 일반 창고(MWH-01/02, MRO-01)의 정상 재고 예약·피킹 |

이 표는 초안이며, WMS-2 단계(§7)에서 실제로 코드에 반영해야 한다. "이미 실행 중인 자동화에도 위험도 기반 안전 등급이 있어야 한다"는 원칙을 그림자모드가 아닌 실행형 에이전트에 처음 적용하는 사례가 된다.

## 7. 로드맵

| 단계 | 내용 | 상태 |
|---|---|---|
| 현재 | M20 파일럿 1개 WO 흐름에서 FEFO 예약·피킹·전이 자동 실행 | ✅ 라이브 (`M20_AGENT_POLICY_V1`) |
| WMS-1 | 판단 서술화 — FEFO 선택 근거를 PROCUREMENT 추론 사슬과 같은 형태로 사람이 읽는 화면으로 노출 (`/wms` 또는 신규 패널) | ❌ 미착수 |
| WMS-2 | 위험물·만료임박 하드가드 도입 — §6 자율 등급 표를 코드로 반영, 위험물창고 이동은 자동 실행 상한을 낮춤 | ❌ 미착수 |
| WMS-3 | M20 파일럿 범위를 일반 작업지시·M21·M22로 확장 | ❌ 미착수 |
| WMS-4 | 창고 간 경로 최적화(비용·거리·Capacity 비교) | ❌ 미착수 |

PROCUREMENT·WMS·MES·PROCESS 4개 에이전트가 실제로 실행하는 자동 시스템이 최종 목표라는 원칙([`procurement-master.md`](./procurement-master.md) §7)은 WMS에도 동일하게 적용된다. 다만 WMS는 "그림자에서 실행으로"가 아니라 **"좁은 실행에서 넓고 설명 가능하고 안전한 실행으로"**가 경로다.

## 8. 관련 문서와 구현

- 자매 문서(4-에이전트 틀의 기준): [`procurement-master.md`](./procurement-master.md)
- 창고 물리 기준: [`warehouse-capacity-master.md`](../warehouse-capacity-master.md)
- 실행 로직: `src/lib/m20-agent-service.ts` (`reserveM20PilotMaterial`, `orchestrateM20Agents`)
- 정책 버전: `src/lib/m20-agent-policy.ts` (`M20_AGENT_POLICY_V1`)
- 상태 전이 API: `src/app/api/twin/transfers/[id]/transition/route.ts`, `src/app/api/agents/m20/[workOrderId]/route.ts`, `src/app/api/agents/mode/route.ts`
- 수동 재고 상태 변경(자동화 안 됨, §3.2): `src/app/api/warehouse/status/route.ts`
- 현재 WMS UI(에이전트 판단 노출 없음): `src/app/(dashboard)/wms/`
- MES 에이전트(작성됨): [`mes-master.md`](./mes-master.md)
- PROCESS 에이전트(작성됨): [`process-master.md`](./process-master.md)
