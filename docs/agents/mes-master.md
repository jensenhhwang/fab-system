# MES Agent Master — 작업지시 실행 담당 에이전트

상태: `LIVE_NARROW_GATE_ONLY`
버전: `MES_AGENT_MASTER_V0` (실행 로직 자체는 레거시 `M20_AGENT_POLICY_V1` 공유)
기준일: 2026-07-26
대상: `AgentRole = "MES"`

이 문서는 [`procurement-master.md`](./procurement-master.md)·[`wms-master.md`](./wms-master.md)의 틀을 따른다. 솔직한 결론부터: **MES 에이전트가 지금 실제로 "판단"하는 것은 단 하나뿐이다** — 나머지는 전부 사람이 버튼을 눌러야 진행되는 물리적 확인 단계다.

## 1. 문서 목적

MES 에이전트가 **정확히 무엇을 자동 판단하고, 그 앞뒤로 얼마나 많은 단계가 여전히 사람 클릭에 의존하는지**를 정의하는 상위 기준이다. 이름이 주는 인상("MES를 자동화한다")과 실제 자동화 범위 사이의 간극을 숨기지 않는 게 이 문서의 목적이다.

## 2. 이름과 실제 사이의 간극

"MES"라는 이름은 공정 실적·수율·설비 텔레메트리 전체를 다룰 것처럼 들리지만, `agentRole: "MES"`로 기록되는 실제 판단은 `orchestrateM20Agents()`(`src/lib/m20-agent-service.ts`) 안에서 딱 한 지점뿐이다:

> **자재가 라인사이드에 도착(`TransferOrder.status === "DELIVERED"`)했고, 자재 배정이 해제(`MaterialAllocation.status === "RELEASED"`)됐으면, 작업지시를 `MATERIAL_WAIT → QUEUED`로 승격한다.**

그 외 모든 것 — 피킹 확인, 스테이징 확인, 출발 확인, 도착 확인, 인도 확인, 소비 확인(`PICK_CONFIRM`~`CONSUME_CONFIRM` 6단계) — 은 `nextHumanAction`으로 기록만 되고, **사람이 화면의 "다음 단계로" 버튼을 눌러야만 진행된다** (`M20PilotFlowCard.tsx`의 단일 `advance()` 함수가 매번 사람 클릭으로 `/api/twin/transfers/[id]/transition` 또는 `/api/mes/workorders/[id]/consume`을 호출).

또한 이 문서가 다루는 MES는 `daily-control`의 "오늘 실적 확정"(`production-actuals.ts`, `/api/production/actuals`)과 **완전히 별개**다. 그쪽은 `agentRole`·`orchestrateM20Agents`를 전혀 참조하지 않는 순수 수동 입력 화면이다. 사용자가 원하는 "생산계획 조정"에 가장 가까운 실제 데이터는 이 MES 에이전트가 아니라 그 화면에 있다 — 이 구분을 다음 설계(PROCESS 문서, §8)에서도 유지해야 한다.

## 3. 역할 정의

### 3.1 담당하는 것 (이미 실행 중, M20 파일럿 범위)

- **라인사이드 준비도 판정 1건** — 위 게이트. `releaseMesAndAssignEquipment()`를 호출해 설비 배정(PROCESS 역할, [`process-master.md`](./process-master.md))이 성공하면 WO를 `QUEUED`로 전환한다.
- **상태 서술** — `orchestrateM20Agents()` 끝의 `next` 매핑(줄 494~509)이 TransferOrder·WO 상태 조합을 보고 `nextHumanAction`(어떤 물리적 확인이 다음에 필요한지)을 계산해 사람에게 알려준다. 이것도 "판단"이라면 판단이지만, 실행이 아니라 **다음에 사람이 뭘 눌러야 하는지 알려주는 안내**에 가깝다.

### 3.2 경계

**지금(M20 파일럿 범위)만 안 하는 것 — 로드맵 따라 넓어짐:**

- **물리 확인 단계 자동화** — 피킹·스테이징·출발·도착·인도·소비 6단계는 전부 사람 클릭이 필수다. 실물 확인이 필요한 단계라 자동화하려면 실제 센서/스캐너 신호(바코드 스캔, RFID 등)가 있어야 한다 — `vision.md`가 말하는 "MES_TELEMETRY 트리거"가 붙기 전까지는 구조적으로 사람 확인이 맞다.
- **M20 파일럿 외 작업지시** — WMS와 동일한 제약. `scope !== "M20_PILOT"`이면 이 게이트 자체가 안 돈다.

**이 에이전트는 영원히 안 하는 것 — 다른 에이전트/화면이 담당:**

- **설비 선택** — PROCESS 영역이다 ([`process-master.md`](./process-master.md)). MES는 PROCESS가 배정에 성공했는지만 확인한다.
- **재고 예약·피킹 로직** — WMS 영역이다 ([`wms-master.md`](./wms-master.md)).
- **생산계획 자체의 조정(증산·감산·일정 변경)** — 사용자가 실제로 원하는 "생산계획 조정"은 지금 `daily-control`의 수동 확정 화면에 있고, 이 MES 에이전트와 연결돼 있지 않다. 연결하려면 §7 로드맵 MES-2가 선행돼야 한다.

## 4. 트리거

| 방식 | 현재 여부 |
|---|---|
| WMS 예약 완료 후 같은 오케스트레이션 흐름 안에서 연쇄 실행 | ✅ `orchestrateM20Agents` 한 호출 안에서 WMS 판단 다음에 바로 이어짐 |
| 사람이 "다음 단계로" 버튼을 누를 때마다 재평가 | ✅ 물리 확인 6단계 각각이 재트리거 |
| 실제 설비·바코드 텔레메트리 신호 | ❌ 없음 |
| 생산계획 변경 시 자동 반영 | ❌ 없음 (§3.2) |

## 5. 판단 로직

### 5.1 입력

- `WorkOrderDoc.status` — 현재 `MATERIAL_WAIT`인지
- `TransferOrderDoc.status` — `DELIVERED`인지
- `MaterialAllocationDoc.status` — `RELEASED`인지
- `MaterialFlowEvents`에 `PICKED` 이벤트 존재 여부(사람 클릭 이력 확인용)

### 5.2 계산 — 이진 게이트 + 상태 매핑

```text
if 자재 DELIVERED && 배정 RELEASED && WO MATERIAL_WAIT:
  설비 배정 시도(PROCESS) → 성공 시 WO를 QUEUED로
else:
  현재 TransferOrder/WO 상태를 보고 다음 필요한 사람 확인 액션을 라벨링만 함
```

PROCUREMENT의 4단계 추론 사슬 같은 서술화 레이어는 없다. WMS와 마찬가지로 `agentDecisions`에 `reasonCodes`(`LINE_SIDE_READY`, `LINE_SIDE_NOT_READY` 등)는 남지만 사람이 읽는 문장으로 바꿔주는 화면이 없다.

## 6. 자율 등급 — 개념 자체가 성립하지 않음

PROCUREMENT·WMS는 "더 자동화할 여지"가 있어서 자율 등급을 정의할 수 있었다. MES는 다르다 — **남은 5/6 단계가 물리적 확인이라 자율 등급을 올린다고 자동화되지 않는다.** 여기서 "자동화 수준을 높인다"는 건 등급 조정이 아니라 **실제 센서·스캐너 연동을 붙이는 인프라 작업**이다. 이 구분을 §7 로드맵에 반영했다.

## 7. 로드맵

| 단계 | 내용 | 상태 |
|---|---|---|
| 현재 | 라인사이드 준비도 이진 게이트 1건 자동 판정, 나머지 6단계는 사람 클릭 | ✅ 라이브 (`M20_AGENT_POLICY_V1`) |
| MES-1 | 판단 서술화 — 지금 이 WO가 왜 대기 중인지("자재 아직 미도착" 등)를 사람이 읽는 문장으로 노출 | ❌ 미착수 |
| MES-2 | `daily-control` 생산실적 확정 화면과 연결 — 실적 확정이 이 에이전트의 판단 입력에 반영되도록 | ❌ 미착수 |
| MES-3 | 실제 센서/스캐너 신호(`MES_TELEMETRY`) 연동으로 물리 확인 6단계 중 자동화 가능한 것부터 대체 | ❌ 미착수, 하드웨어 연동 필요 |
| MES-4 | M20 파일럿 외 작업지시로 범위 확장 | ❌ 미착수 |

## 8. 관련 문서와 구현

- 자매 문서: [`procurement-master.md`](./procurement-master.md), [`wms-master.md`](./wms-master.md), [`process-master.md`](./process-master.md)
- 실행 로직: `src/lib/m20-agent-service.ts` (`orchestrateM20Agents`의 MES 분기, 줄 466~509)
- 사람 확인 UI: `src/app/(dashboard)/mes/M20PilotFlowCard.tsx` (`advance()`)
- 물리 확인 API: `src/app/api/twin/transfers/[id]/transition/route.ts`, `src/app/api/mes/workorders/[id]/pick/route.ts`, `src/app/api/mes/workorders/[id]/consume/route.ts`
- MES 에이전트와 무관한 별도 생산실적 화면: `src/lib/production-actuals.ts`, `src/app/api/production/actuals/route.ts`, `daily-control`
- 미작성: `docs/agents/process-master.md` (다음 문서)
