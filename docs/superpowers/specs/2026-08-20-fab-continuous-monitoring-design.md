# FAB 상시 모니터링·개선 승인 흐름 — 설계

작성일: 2026-08-20  
상태: 사용자 검토 대기  
대상 브랜치: `feat/dram-nand-finished-goods`

## 1. 목적

FAB 서버가 실행되는 동안 결품·발주·입고·생산·창고·출하 상태를 계속 관찰하고,
이상이 반복되거나 악화되면 근거가 있는 개선안을 만든다. 개선안은 사용자가 승인하기 전까지
운영 정책이나 데이터를 바꾸지 않으며, 승인된 변경만 적용하고 적용 후 결과까지 검증한다.

이번 설계는 두 종류의 실패를 함께 다룬다.

1. 서버 프로세스가 종료되거나 응답 불능이 되어 모니터링 자체가 사라지는 실패
2. 서버는 살아 있지만 Twin 산출·자재·조달·물류·출하 흐름이 비정상인 실패

## 2. 확인된 운영 근거

- 2026-08-20 확인 당시 3000번 서버 프로세스는 종료되어 있었지만 `twinEngineState.status`는
  `RUNNING`으로 남아 있었다.
- 마지막 tick은 약 41시간 전이었고, DOH 5일 미만 자재는 앞선 관측의 13종에서 19종으로 늘었다.
- 미착 PO는 25건에서 29건으로 늘었으며 TEOS를 포함한 다수 자재가 재고 0이었다.
- 서버 재기동 후 `instrumentation`에서 Twin·입고 스케줄러가 각각 기동했고, 실제 Twin tick도
  다시 실행됐다. 한 tick의 실측 소요는 약 34초였다.

따라서 DB의 `RUNNING` 문자열만으로 생존을 판정할 수 없다. 프로세스 생존, HTTP 준비 상태,
tick 신선도, 실제 산출을 서로 다른 신호로 관찰해야 한다.

## 3. 채택 구조

```text
macOS launchd
  └─ 외부 watchdog 프로세스
       ├─ Next.js 서버 자식 프로세스 기동·재기동
       ├─ /api/health/live, /api/health/ready 점검
       └─ 연속 실패 시 종료 → 재기동, 벽시계 로그 기록

Next.js instrumentation
  └─ 운영 모니터(순차 self-scheduling)
       ├─ 기존 원장 읽기 및 공통 스냅샷 생성
       ├─ 이상 fingerprint 기준 incident 생성·갱신·복구
       ├─ 반복·악화 incident에서 개선 proposal 생성
       └─ 관제탑 개선함 API/UI 제공

사용자
  └─ 제안 검토 → 승인 또는 반려
       ├─ 승인 가능한 운영 조치: allowlist executor 실행
       └─ 코드·마스터 변경: 승인 기록 후 Codex가 구현·테스트·revision 기록
```

watchdog과 운영 모니터는 책임이 다르다. watchdog은 서버 밖에서 서버 생존만 책임지고,
운영 모니터는 서버 안에서 FAB 데이터의 의미를 판정한다. 운영 모니터가 자기 프로세스의 죽음을
감지할 수 없으므로 둘을 합치지 않는다.

## 4. 시간 원칙

- watchdog의 재시도, HTTP timeout, `recordedAt`, 승인 시각은 실제 벽시계다.
- 재고 커버리지, PO 도착 예정, 생산·최종테스트·출하 영향은 공통 Twin 운영시각을 사용한다.
- 모든 운영 영향 계산은 `src/lib/twin/operating-clock.ts`의 24× 시계만 참조한다.
- 모니터 주기는 실제 60초다. 이 주기는 관찰 빈도일 뿐 Twin 모델 시간을 진행하지 않는다.
- tick 장기 실행을 정상 종료로 오판하지 않도록 ready 판정은 실측 tick 소요와
  `tickIntervalMs`를 반영한 여유 구간을 사용한다.

## 5. 외부 watchdog

### 5.1 저장과 설치

- 저장소에는 watchdog 본체와 launchd plist 템플릿, 설치·상태·중지 명령을 둔다.
- 실제 plist는 사용자 승인 후 `~/Library/LaunchAgents/`에 설치한다.
- 절대 경로, Node/npm 경로, 작업 디렉터리는 설치 시 현재 환경에서 해석해 생성한다.
- 로그는 저장소 밖의 전용 로그 파일로 분리하고 비밀 환경변수 값은 출력하지 않는다.

### 5.2 동작

- watchdog이 `npm run dev`를 자식 프로세스로 실행한다.
- `launchd`는 watchdog 자체가 종료되면 `KeepAlive`로 다시 기동한다.
- watchdog은 60초마다 health endpoint를 검사한다.
- 세 번 연속 실패하면 자식 서버에 `SIGTERM`을 보내고 제한 시간 후에도 살아 있으면 `SIGKILL`한 뒤
  지수 backoff를 적용해 재기동한다.
- 동시에 두 서버가 3000번 포트를 차지하지 않도록 단일 PID/프로세스 소유권을 검증한다.
- 의도적 정지는 `launchctl bootout`을 사용하는 명시적 중지 명령으로만 수행한다.

### 5.3 health endpoint

- `/api/health/live`: 프로세스가 요청을 처리할 수 있는지만 반환한다. 인증 없이 사용 가능하며
  민감한 운영 데이터는 포함하지 않는다.
- `/api/health/ready`: DB 연결, Twin 상태, 마지막 tick 신선도를 검사한다.
- `RUNNING`인데 마지막 tick이 `max(실제 180초, tickIntervalMs × 12)`보다 오래 갱신되지 않으면
  `503`을 반환한다. 현재 실측 tick 약 34초를 정상 범위로 흡수하면서 실제 정지는 빠르게 잡는다.
- `PAUSED`는 사용자가 의도한 정지일 수 있으므로 서버 준비 실패로 취급하지 않고 상태만 명시한다.

## 6. 내부 운영 모니터

### 6.1 실행 방식

- Next.js `instrumentation`에서 Twin·입고 스케줄러와 독립적으로 기동한다.
- `setInterval`이 아니라 작업 완료 후 다음 실행을 예약하는 self-scheduling 방식을 사용한다.
- 모니터 한 회가 겹치지 않도록 DB lease와 프로세스 내부 guard를 함께 사용한다.
- 한 모니터가 실패해도 Twin tick은 계속 실행되며, 오류는 incident와 서버 로그에 남긴다.

### 6.2 공통 관측 스냅샷

한 번의 관측에서 다음 사실을 같은 `recordedAt`과 `operatingEpochMs`로 묶는다.

| 영역 | 핵심 신호 |
|---|---|
| 생존 | 프로세스 시작 시각, DB 연결, 마지막 tick, 마지막 완제품 산출 |
| 자재 | 재고 0, DOH/ROP 상태, 소모+부족 수요, 자재 차단 WIP |
| 조달 | PO 상태별 건수, 승인 대기 시간, 도착 운영시각, 공급사·정책 결손 |
| 입고 | 도착 판정 후 미입고, `INBOUND_HOLD`, 목적 창고 capacity |
| 생산 | 제품별 진행 WIP, 자재 차단, 완제품 창고 차단, 실제 산출 공백 |
| 창고 | 물리·법적 점유율, capacity over, 보류 수량 |
| 출하 | 제품별 완제품, 계약 대비 운영기간 출하율, 자동출하 정체 |

관측 계산은 기존 `tick-diagnosis`, 네 역할 규칙 엔진, Twin 원장을 재사용한다. 화면별 계산을
복사하지 않고 하나의 서버 서비스가 정본 스냅샷을 만든다.

### 6.3 이상 상태 수명주기

```text
NORMAL → OBSERVED → ANALYZED → PROPOSED
                    ↘ RECOVERED

PROPOSED → APPROVED → APPLYING → ACTIVE → VERIFIED
         ↘ REJECTED
         ↘ FAILED / ROLLED_BACK
```

- 같은 원인은 `kind + 대상 ID + 정책 버전` fingerprint로 중복 생성하지 않는다.
- 이상이 계속되면 동일 incident의 관측 횟수·최악값·최근값만 갱신한다.
- 정상 구간이 연속 확인되면 `RECOVERED`로 닫되 이력을 삭제하지 않는다.
- 단발성 경고는 proposal로 올리지 않는다. 반복, 악화, 하드 임계 초과 중 하나가 확인되어야 한다.

## 7. 데이터 모델

기존 역할 계약에서 정한 세 컬렉션을 실제 정본으로 구현한다.

### `operationIncidents`

- 역할: 운영 이상, 증거 스냅샷 참조, 원인 분석, 복구 여부
- 핵심 필드: `incidentId`, `fingerprint`, `kind`, `severity`, `status`, `recordedAt`,
  `operatingEpochMs`, `firstObservedAt`, `lastObservedAt`, `observationCount`, `evidence`,
  `affectedRoles`, `policyVersions`, `recoveredAt`

### `operationLearningProposals`

- 역할: 변경 전후 값, 예상 효과, 위험, 검증·rollback 방법, 승인 상태
- 핵심 필드: `proposalId`, `incidentIds`, `kind`, `status`, `proposedByRole`, `change`,
  `expectedEffects`, `risks`, `evidenceRefs`, `validationPlan`, `rollbackPlan`, `createdAt`

### `operationPolicyRevisions`

- 역할: 승인·반려·적용·검증 감사 원장
- 핵심 필드: `revisionId`, `proposalId`, `decision`, `decidedBy`, `decidedAt`,
  `previousVersion`, `newVersion`, `applyResult`, `verificationResult`, `recordedAt`

모든 컬렉션은 fingerprint·상태·시각 조회에 필요한 인덱스를 설치한다. 기존
`controlTowerAIEpisodes`는 자문 스냅샷으로 유지하며 이 세 원장을 대체하지 않는다.

## 8. 개선 승인과 반영 경계

담당 역할과 LLM은 `PROPOSED`까지만 자동 진행할 수 있다. 승인·반려 API는 ADMIN만 호출할 수 있고,
승인 요청에는 예상 diff와 검증·rollback 계획이 반드시 있어야 한다.

승인 후 반영은 두 종류로 나눈다.

1. **Allowlist 운영 조치**: 이미 preview/execute 계약이 있는 발주 승인, 입고 보류 해제 같은 조치는
   동일 입력 hash와 사용자 승인을 확인한 뒤 실행한다.
2. **코드·마스터·정책 변경**: 앱이 자기 소스나 하드 안전규칙을 자동 수정하지 않는다. 승인 기록을
   남긴 뒤 Codex가 변경하고 테스트하며, 결과와 새 정책 버전을 revision에 기록한다.

위험물·법적 capacity·음수재고·단위 혼합·감사 이력·공통 24× 시계·사용자 승인 권한은 자동 변경
대상에서 제외한다.

## 9. 관제탑 개선함

기존 관제탑에 다음 세 구역을 추가한다.

- **현재 이상**: 심각도, 최초/최근 관측, 영향 역할, 핵심 근거, 회복 조건
- **승인 요청**: 이전값→제안값, 예상 효과, 위험, 검증·rollback, 승인·반려 버튼
- **적용 결과**: 적용 상태, 새 정책 버전, 검증 지표, 실패 또는 rollback 이유

대화형 알림은 앱이 임의로 Codex 대화를 생성하는 방식이 아니다. 이 작업 목표가 활성화된 동안
Codex가 미결 proposal을 읽어 사용자에게 알려주며, 영속 정본과 승인 UI는 관제탑 개선함이다.

## 10. 초기 탐지 정책

첫 버전은 이미 운영 근거와 판정 코드가 있는 항목만 사용한다.

- `ENGINE_STALE`: DB는 RUNNING이나 마지막 tick이 신선도 임계 초과
- `OUTPUT_STOPPED`: 엔진은 돌지만 실제 벽시계 60분 이상 완제품 산출이 없음
- `MATERIAL_STOCKOUT` / `MATERIAL_CRITICAL`: 재고 0 또는 ROP 기반 임계
- `EMA_STARVATION`: 소모 EMA가 설계수요의 50% 미만
- `PENDING_APPROVAL`: 승인 대기가 자율처리 시간 60분 초과
- `INBOUND_HOLD`: 도착했지만 capacity 때문에 입고 보류
- `FG_CAPACITY_OVER`: 완제품 창고 초과로 마지막 공정 차단
- `SHIPMENT_STALLED`: 출하 가능 재고·도래 계약이 있는데 자동출하 없음

새 임계값을 임의로 늘리지 않고 기존 `tick-diagnosis`와 역할 정책 상수를 재사용한다.

## 11. 오류 처리와 안전성

- MongoDB 일시 장애는 데이터 이상과 구분해 `MONITOR_FAILURE`로 기록하고 모델 데이터를 수정하지 않는다.
- snapshot 일부가 없으면 `DATA_GAP`으로 표시하며 0으로 가정하지 않는다.
- incident/proposal/revision 쓰기는 idempotent upsert와 optimistic 상태 조건을 사용한다.
- 승인 API 재전송으로 같은 변경이 두 번 실행되지 않도록 request hash를 저장한다.
- 적용 실패 시 상태를 `FAILED`로 남기고, 자동 rollback이 안전한 allowlist 조치만 되돌린다.
- watchdog은 비밀값, 세션, 원재고 전체를 로그에 출력하지 않는다.

## 12. 검증 기준

### watchdog

- 서버가 없을 때 자동 기동된다.
- 서버 프로세스를 종료하면 backoff 후 새 PID로 복구된다.
- HTTP가 연속 세 번 실패하면 hung 프로세스를 교체한다.
- 의도적 `stop` 후에는 다시 뜨지 않고, `start` 후에는 다시 감시한다.

### 운영 모니터

- 동일 이상을 여러 번 관찰해도 incident는 한 건이고 관측 횟수만 증가한다.
- 이상이 해소되면 `RECOVERED`가 된다.
- 반복·악화 조건 전에는 proposal이 생성되지 않는다.
- 벽시계와 운영시각 필드가 섞이지 않는다.

### 승인·반영

- 미승인 proposal은 어떤 운영 데이터도 바꾸지 않는다.
- ADMIN 이외 승인 요청은 거부된다.
- 승인된 allowlist 조치만 한 번 실행된다.
- 코드·정책 개선은 적용 전후 테스트와 정책 버전이 revision에 남는다.

### 실제 운영 회귀

- Twin tick, 입고 scheduler, 자동출하가 모니터 추가 전과 동일하게 계속 돈다.
- watchdog 재기동 후 ready endpoint와 새 tick을 확인한다.
- 첫 관측으로 현재 결품·미착 PO·생산 산출·창고·출하 상태를 기록하고, 가장 심각한 개선안 한 건을
  관제탑과 이 대화에서 사용자에게 제시한다.

## 13. 범위 밖

- 승인 없는 정책 자동 학습·자동 승격
- 앱이 저장소 소스 코드를 스스로 수정하는 기능
- 외부 메신저·이메일 알림
- 클라우드 배포용 원격 watchdog
- 과거 운영 데이터의 임의 백필
