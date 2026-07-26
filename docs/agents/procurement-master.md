# Procurement Agent Master — 입고(발주) 담당 에이전트

상태: `SHADOW_MODE_ACTIVE`
버전: `PROCUREMENT_SHADOW_V0`
기준일: 2026-07-26
대상: `AgentRole = "PROCUREMENT"` 중 재고·계획 기반 발주 판단 에이전트

이 문서는 4개 자재관리 에이전트(PROCUREMENT·WMS·MES·PROCESS) 중 첫 번째의 정식 설계이자, 나머지 3개를 문서화할 때 따를 틀이다. WMS·MES·PROCESS는 아직 이 수준의 설계를 거치지 않았다 — 코드는 있지만 "이 에이전트가 무엇을 담당해야 하는가"를 재정의하지 않았다([§8](#8-관련-문서와-구현) 참고).

## 1. 문서 목적

이 문서는 PROCUREMENT 에이전트가 **무엇을 판단하고, 무엇을 실행하지 않으며, 어디까지 자동으로 넘어갈 수 있는지**를 정의하는 상위 기준이다. 구현 세부(함수 시그니처)를 정의하는 문서가 아니라, 역할·경계·안전장치를 정의하는 문서다.

```text
docs/agents/procurement-master.md
  └─ 역할 정의 + 트리거 + 자율 등급 + 안전장치
       └─ src/lib/procurement-agent.ts (판단 로직)
            └─ src/lib/procurement-agent-server.ts (데이터 연결)
                 └─ /api/agents/procurement/preview (API)
                      └─ /procurement-cockpit (UI)
```

## 2. 두 개의 "PROCUREMENT" — 반드시 구분

이 코드베이스에는 **PROCUREMENT라는 이름의 에이전트가 두 벌** 있다. 서로 다른 시점에, 다른 목적으로 만들어졌고 **아직 상태를 공유하지 않는다.** 혼동하면 안 된다.

| | 레거시 (M20 파일럿) | 신규 (그림자 조종석, 이 문서) |
|---|---|---|
| 코드 | `src/lib/m20-agent-service.ts` `decidePurchaseOrder` | `src/lib/procurement-agent.ts` |
| 트리거 | 작업지시(WO) 실행 (`orchestrateM20Agents`) | 사람이 `/procurement-cockpit` 화면을 열 때 |
| 데이터 저장 | `agentRuns` / `agentDecisions` / `agentPolicies` (MongoDB, 영속) | 없음 — 매 요청 온디맨드 계산, 저장 안 함 |
| 자율 개념 | `AgentRoleModeDoc` (역할 전체 AGENT/HUMAN 2단) | 자재별 L2/L4 상한 (코드 내 계산, 미영속) |
| 범위 | M20 파일럿 1개 자재(PKG-001)·1개 작업지시 흐름 | 재고 스냅샷 전체 자재 (63종) |
| 실행 여부 | 승인 시 `integrationOutbox`에 적재(스텁, 실전송 아님) | **절대 실행 안 함** (그림자모드) |

**현재 관계: 없음.** 둘은 서로를 호출하지 않는다. 장기적으로는 신규 쪽이 레거시의 `agentDecisions`/`agentPolicies` 저장소를 흡수해야 하지만, 그건 [§7 로드맵](#7-로드맵) MVP-3 이후 과제다. 이 문서가 정의하는 범위는 **신규(그림자 조종석)** 에이전트다.

## 3. 역할 정의

### 3.1 담당하는 것

- 재고 스냅샷(가용재고·예약·품질보류·확정입고)과 리드타임을 근거로 **자재별 부족을 예측**한다.
- 부족이 예측되면 **얼마를, 언제까지 발주해야 하는지** 결정론적으로 계산한다.
- 계산 근거를 사람이 읽을 수 있는 **4단계 추론 사슬**로 서술한다.
- 자재 위험도(위험물 여부·공급사 단일화 여부)에 따라 **자동입고 가능 여부를 판정**한다.

### 3.2 경계

**최종 목표는 그림자모드가 아니다.** PROCUREMENT·WMS·MES·PROCESS 4개 에이전트가 각자 판단하고 실제로 실행하는 자동 시스템이 목표다. 아래 항목은 두 종류로 나뉜다 — 하나는 지금(MVP-0) 단계라서 아직 안 하는 것(로드맵 따라 곧 풀림), 다른 하나는 이 에이전트가 영원히 안 하는 것(다른 에이전트가 실제로 자동 실행함, 시스템 전체는 자동화됨).

**지금(MVP-0)만 안 하는 것 — 로드맵 따라 실행으로 전환됨:**

- **실제 발주 생성** — `purchaseOrderDrafts`를 아직 안 만든다. L3(자동승인)에서 자동 생성·승인으로 전환 예정([§7 MVP-2](#7-로드맵)).
- **실제 발주 전송** — 승인된 발주도 실제 공급사로 안 나간다. 단 이건 자율 등급과 별개로 **외부 ERP/EDI 연동이 없어서 생기는 인프라 제약**이다(`integrationOutbox`가 스텁). 연동이 붙기 전까지는 L4여도 "OUTBOXED·미전송"에서 멈춘다 — 자동화를 안 하는 게 아니라 나갈 통로가 아직 없는 것.
- **실제 입고 등록** — `inventoryLots`/`inventoryMovements`에 아직 안 쓴다. L4(자동입고) 자재는 QUARANTINE 로트로 자동 등록하도록 전환 예정([§7 MVP-2](#7-로드맵)).
- **What-if 시나리오 자동 반영** — 지금은 이벤트가 없는 "현재 재고 기준 위험 점검"만 돈다. What-if 화면에서 세운 시나리오를 자동으로 읽어와 판단에 반영하도록 전환 예정([§7 MVP-1](#7-로드맵)).

**이 에이전트는 영원히 안 하는 것 — 다른 에이전트가 실제로 자동 실행함:**

- **재고 이동·피킹** — WMS 에이전트 영역이다 (미설계, [§8](#8-관련-문서와-구현)). PROCUREMENT가 대신 하지 않을 뿐, 시스템 전체로는 WMS 에이전트가 자동 실행해야 한다.
- **생산계획 자동 수립** — MES/PROCESS 영역이다. 마찬가지로 시스템 전체로는 자동화 대상이다.

## 4. 트리거

| 방식 | 현재 여부 |
|---|---|
| 사람이 `/procurement-cockpit` 화면 진입 | ✅ 즉시 1회 계산 |
| 화면이 열려 있는 동안 60초 폴링 | ✅ `GET /api/agents/procurement/preview` |
| 백그라운드 스케줄러(사람 개입 없이 상시) | ❌ 없음 |
| 생산계획/What-if 변경 시 자동 재계산 | ❌ 없음 |
| daily-control 관제탑 요약 배지 | ❌ 없음 (엑스 설계안, 미구현) |

즉 **이 에이전트는 누가 보고 있을 때만 생각한다.** 사람이 화면을 안 열면 아무 판단도 일어나지 않는다.

## 5. 판단 로직

### 5.1 입력

`loadLiveScenarioMaterials()` (`src/lib/material-scenario-server.ts`)가 실시간으로 읽는다:

- 재고(`inventory` 포지션), Lot(`inventoryLots`)
- 공정 사용량(`processUsage`) → 자재별 일일 소요
- 승인 공급사·리드타임(`materialSuppliers`)
- 확정 입고계획(`inboundPlans`, status=`CONFIRMED`)
- 발주 정책(`agentPolicies` — MOQ·발주배수. 레거시 프레임워크와 컬렉션을 공유하지만 이 값만 읽는다)

### 5.2 계산

`recommendMaterialOrders()` (`src/lib/scenario-engine.ts`, 결정론 함수, AI 아님)가 자재별로:

- 기준 계획 대비 시나리오 반영 시 추가 소요(`additionalRequirement`)
- 순부족량 → MOQ·발주배수 반영 발주량(`incrementalOrderQuantity` → `policyAdjustedOrderQuantity`)
- 첫 필요일·정상 발주 마감일·안전 발주 마감일(`needByDay`/`normalOrderByDay`/`safeOrderByDay`)

### 5.3 서술화 — 4단계 추론 사슬

`buildProcurementShadow()` (`src/lib/procurement-agent.ts`)가 위 계산을 사람이 읽는 4단계로 변환한다. reasonCode(예: `LEAD_TIME_COVERAGE_SHORTAGE`)를 그대로 노출하지 않고 `REASON_NARRATIVE` 테이블로 서술화한다 — 원문 코드는 "근거 원문 보기" 토글에만 노출.

1. **생산계획 신호** — 왜 소요가 생겼는가 (시나리오 반영 여부)
2. **부족 예측** — 가용재고·확정입고 대비 추가 소요
3. **리드타임 커버리지** — 리드타임과 발주 마감일, 지남 여부
4. **발주 판단** — 발주 권장량, 공급사, 그림자 판정

각 스텝은 `OK`/`WARN`/`BLOCKED` 상태를 갖는다. 리드타임 또는 공급사가 미등록이면 스텝 3에서 `BLOCKED`로 사슬이 멈추고, 최종 판정도 `BLOCKED`가 된다.

## 6. 자율 등급 (Autonomy)

레거시 프레임워크의 `AgentRoleMode`(역할 전체 2단 토글)와 다르게, **자재 단위로 상한을 계산**한다. 지금은 저장하지 않고 매 요청 코드로 재계산한다(`autonomyCeiling()`).

| 등급 | 의미 | 지금 조건 |
|---|---|---|
| L1 관측 | 판단만, 표시 안 함 | 미사용 (모든 대상 자재는 L2 이상으로 표시) |
| **L2 제안** | 발주까지만, 사람 승인 필요 | `category ∈ {GAS, CHM}` (위험물) **또는** 승인 공급사 1개 이하(단일소싱) |
| L3 자동승인 | 발주안 자동 승인, 전송은 대기 | 미구현 (레거시에도 없음) |
| **L4 자동입고** | 잠정입고까지 자동 (구현되면) | 위 두 조건에 해당하지 않는 자재 |

**하드가드:** 위험물·단일소싱 자재는 코드에서 L2로 상한이 고정된다. 화면 UI에서 L3/L4 선택을 막는 것(엑스 설계)과 서버가 L2로 클램프하는 것, 두 겹으로 막는다 — 아직 UI 잠금은 미구현이나 서버 계산은 이미 이렇게 동작한다.

**의도적으로 안 하는 것:** 자율 등급의 자동 승급·강등. 예측이 맞았는지 판정하려면 발주→실제 입고를 잇는 실측 리드타임 원장이 필요한데, 지금은 그 원장이 없다(레거시 발주도 `integrationOutbox` 스텁에서 끊긴다). 데이터 없이 승급 로직을 만들면 근거 없는 자동화가 된다. [§7 MVP-3](#7-로드맵) 전까지 보류.

## 7. 로드맵

| 단계 | 내용 | 상태 |
|---|---|---|
| MVP-0 | 그림자모드 read-only. 실제 발주·입고 없음. `agentDecisions` 저장도 안 함(온디맨드 계산만) | ✅ 구현 (`PROCUREMENT_SHADOW_V0`) |
| MVP-1 | 생산계획·What-if 시나리오를 입력으로 연결. 자율 등급을 `agentPolicies`에 영속화하고 사람이 수동 지정하는 UI | ❌ 미착수 |
| MVP-2 | L3 자재는 `purchaseOrderDrafts` 자동 생성·승인. L4 자재는 잠정입고(QUARANTINE 로트)까지 자동 실행 + 원클릭 롤백. 위험물/단일소싱은 계속 L2 고정 | ❌ 미착수 |
| MVP-3 | 발주↔실입고 링크·실측 리드타임 원장 적재 → 자동 승급/강등 | ❌ 미착수 |
| MVP-4 (별도 트랙) | 외부 ERP/EDI 연동 — `integrationOutbox` 스텁을 실제 공급사 전송으로 교체. 자율 등급과 무관하게 이 연동 전까지는 L4여도 발주가 "OUTBOXED"에서 멈춘다 | ❌ 미착수, 연동 주체 미정 |

4명의 에이전트(PROCUREMENT·WMS·MES·PROCESS)가 실제로 실행하는 자동 시스템이 최종 목표다. MVP-0~3은 이 에이전트 하나의 자율성을 단계적으로 넓히는 경로이고, WMS·MES·PROCESS 문서가 나오면 각자의 MVP 경로도 여기 준하는 형태로 정의한다.

## 8. 관련 문서와 구현

- 자재 사용처 상위 기준: [`material-master.md`](../material-master.md)
- 원단위: [`material-consumption-master.md`](../material-consumption-master.md)
- 판단 로직: `src/lib/procurement-agent.ts`
- 데이터 연결: `src/lib/procurement-agent-server.ts`, `src/lib/material-scenario-server.ts`, `src/lib/scenario-engine.ts`
- API: `src/app/api/agents/procurement/preview/route.ts`
- UI: `src/app/(dashboard)/procurement-cockpit/`
- 유닛테스트: `scripts/test-procurement-agent.ts` (`npm run test:procurement-agent`)
- 레거시 M20 파일럿 에이전트(§2 비교 대상): `src/lib/m20-agent-service.ts`, `src/lib/m20-agent-policy.ts`
- **미작성 — 다음 문서 후보:** `docs/agents/wms-master.md`, `docs/agents/mes-master.md`, `docs/agents/process-master.md`. 셋 다 레거시 코드(`m20-agent-service.ts`의 WMS 예약·피킹 오케스트레이션)는 있으나 이 문서와 같은 수준의 역할 재정의는 없다.
