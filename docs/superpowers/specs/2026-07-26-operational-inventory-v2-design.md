# 운영재고 V2 설계 계약

- 작성일: 2026-07-26
- 상태: 계약 기반 구현
- 범위: WMS·MES 운영재고
- 비범위: 재고평가, 원가, 회계 전기, 위탁재고 회계

## 1. 결정

현재 `inventory`, `inventoryLots`, `handlingUnits`, `fabMaterialStocks`가 각각
수량을 보유하고 `inventoryMovements`, `materialFlowEvents`가 서로 다른 흐름을
기록한다. 기존 이벤트만 재생해서 현재고를 복구할 수 없으므로 기존 컬렉션을
즉시 원본 원장으로 승격하지 않는다.

V2의 기준은 다음과 같다.

1. `inventoryMovementsV2`: 변경 불가능한 전기·감사 원장
2. `inventoryBalancesV2`: 운영 조회와 동시성 제어를 위한 Projection
3. `materialUomRulesV2`: 자재별 기준 UOM·정밀도·환산 규칙
4. 모든 V2 변경은 단일 Posting 서비스만 통과
5. 기존 원장과 V2를 병행 계산하고 대사 통과 후 조회 기준 전환

현재 첫 수직 슬라이스에는 계약·검증 규칙, 인덱스 설치기와 트랜잭션 Posting
코어가 구현되어 있다. 기존 API는 아직 Posting 코어를 호출하지 않으므로 운영
동작과 기존 데이터는 바뀌지 않는다. V2 컬렉션도 인덱스 설치 명령이나 Posting
서비스를 명시적으로 호출하기 전에는 생성·기록되지 않는다.

첫 슬라이스에서 허용하는 전기는 `RECEIPT`, `QUALITY_CHANGE`, `RESERVE`,
`RELEASE_RESERVATION`, `ALLOCATE`, `DEALLOCATE` 여섯 종류뿐이다.
피킹·스테이징·이송·소비·폐기·조정·역분개 실행은 상태 전이표가 확정될
때까지 `UNSUPPORTED_MOVEMENT_TYPE`으로 거절한다.

## 2. 재고 상태의 세 축

### 품질

| 코드 | 의미 | ATP 포함 |
|---|---|---:|
| `INSPECTION_PENDING` | 입고검사 대기 | 아니오 |
| `UNRESTRICTED` | 사용 가능 | 예 |
| `HOLD` | 임시 보류 | 아니오 |
| `QUARANTINE` | 격리 | 아니오 |
| `REJECTED` | 부적합 판정, 폐기 전 물리 보유 | 아니오 |

### 물류

`STORED → PICKING → STAGED → IN_TRANSIT → PRS → LINE_SIDE`

소비 완료 수량은 Balance에 남기지 않는다. `CONSUME` Movement가 출고 효과를
내며, `CONSUMED`를 물리 위치처럼 집계하지 않는다.

### 약정

`FREE`, `RESERVED`, `ALLOCATED`

예약은 수량 삭제가 아니라 같은 물리 위치에서 약정 bucket을 옮기는
Movement다. `UNRESTRICTED`가 아닌 품질재고는 예약·할당할 수 없다.

## 3. 재고 보존식과 ATP

동일 기준시각과 자재에서:

```text
물리 현재고
  = 검사대기 + 가용 + 보류 + 격리 + 부적합

가용 품질 현재고
  = UNRESTRICTED의 FREE + RESERVED + ALLOCATED

약정량
  = UNRESTRICTED의 RESERVED + ALLOCATED

가용 현재고
  = 가용 품질 현재고 - 약정량

ATP
  = max(0, 가용 현재고 + ATP 기간 안의 확정입고)
```

예약·피킹·이송·PRS 인계는 물리 현재고 총합을 바꾸지 않는다. 입고·조정입고는
총합을 늘리고, 소비·폐기·조정출고는 총합을 줄인다. `DRAFT` 입고계획은
확정입고에 포함하지 않는다.

## 4. 표준 재고 키

Balance 식별 차원:

```text
자재 + 사업장 + 시설 + 창고/Zone + Location + Lot + HU
     + 품질상태 + 물류상태 + 약정상태
```

Lot은 공급사 Lot, 제조·입고·유효기한, 재검사일 등 추적 속성을 맡는다.
HU는 실제 용기, 위치와 수량을 맡는다. 동일 수량을 Lot·HU·Balance에서
각각 독립적으로 수정하지 않는다.

## 5. 수량과 UOM

- 모든 V2 수량은 자재 기준 UOM의 정수 최소단위 `quantityMinor`로 저장한다.
- `uomScale=3`인 L 자재의 `1.250 L`는 `1250`으로 저장한다.
- API 입력은 JSON number가 아니라 평문 십진 문자열로 받는다.
- 구매·포장단위 환산은 부동소수점 factor 대신 `numerator/denominator`로 정의한다.
- 환산에는 유효기간, 승인자와 승인시각을 둔다.
- 정밀도는 자재별 0~6자리이며 반올림은 `HALF_UP`, `DOWN`, `UP` 중 하나다.
- Movement에는 당시의 `baseUom`, `uomScale`을 스냅샷으로 남긴다.

## 6. Movement V2 필수 계약

헤더 필수값:

- 고유 Movement ID와 멱등 `requestId`
- Movement 종류와 1개 이상의 line
- 표준 `reasonCode`
- 원문서 종류·ID
- 사용자, 발생시각, 기록시각
- 역분개라면 원 Movement ID

각 line은 동일 수량의 `from`/`to` Balance를 표현한다.

- 입고·기초·조정입고: `to`만 존재
- 소비·폐기·조정출고: `from`만 존재
- 예약·품질변경·이송: `from`과 `to`가 모두 존재
- 품질변경은 품질 축만 변경
- 예약·할당은 약정 축만 변경
- 내부 이동은 자재 ID와 수량을 변경할 수 없음

원 Movement는 수정·삭제하지 않는다. 취소는 source와 destination을 뒤집은
`REVERSAL`을 추가하고 `reversalOfMovementId`로 원문서를 연결한다.

향후 ERP 연동을 위해 `companyCode`, `ownerPartyId`,
`accountingPostingDate` 키는 선택 필드로 보존하지만 이번 단계에서 회계
의미나 평가 로직은 구현하지 않는다.

### Posting 처리 순서

1. 호출자는 `quantity` 평문 십진 문자열과 `sourceUom`만 전달한다.
2. 서버가 발생시각에 유효하고 승인된 UOM 규칙을 정확히 하나 선택한다.
3. 서버가 기준 UOM의 정수 최소단위로 환산하고 UOM 스냅샷을 Movement에 남긴다.
4. 자재의 첫 Movement에서 기준 UOM과 scale을 `materialUomLocksV2`에 고정한다.
5. 정규화한 명령과 환산 결과로 SHA-256 `requestHash`를 생성한다.
6. Balance별 총차감·총증가를 각각 합산해 부족과 overflow를 먼저 검사한다.
7. Movement 저장과 모든 Balance 갱신을 하나의 MongoDB 트랜잭션으로 처리한다.

같은 `requestId`와 같은 hash는 기존 Movement를 반환한다. 같은 ID와 다른
hash는 `IDEMPOTENCY_CONFLICT`로 거절한다. 요청당 line은 최대 100개다.

### 오류 계약

| 코드 | HTTP | 의미 |
|---|---:|---|
| `INVALID_COMMAND` | 400 | 필수값·십진수·line 수 오류 |
| `UNSUPPORTED_MOVEMENT_TYPE` | 422 | 아직 활성화하지 않은 전기 유형 |
| `TRANSITION_NOT_ALLOWED` | 422 | 상태 전이표 위반 |
| `UOM_RULE_NOT_FOUND` | 422 | 승인된 유효 규칙 없음 |
| `UOM_CONVERSION_NOT_FOUND` | 422 | 입력단위 환산 없음 |
| `UOM_RULE_AMBIGUOUS` | 409 | 유효 규칙 또는 환산 중복 |
| `UOM_PROFILE_LOCKED` | 409 | 기준 UOM·scale 변경 시도 |
| `IDEMPOTENCY_CONFLICT` | 409 | 같은 요청 ID의 다른 명령 |
| `INSUFFICIENT_BALANCE` | 409 | 차감 가능 수량 부족 |
| `BALANCE_OVERFLOW` | 409 | 안전정수 범위 초과 |
| `BALANCE_UOM_MISMATCH` | 409 | Balance와 Movement UOM 불일치 |
| `BALANCE_CONFLICT` | 409 | 동시 Balance 변경 충돌 |
| `TRANSACTION_UNAVAILABLE` | 503 | replica-set 트랜잭션 사용 불가 |

## 7. 현재 흐름의 V2 매핑

| 현재 작업 | V2 전기 |
|---|---|
| Lot 입고 | `RECEIPT` |
| 보류·격리·해제 | `QUALITY_CHANGE` |
| MES 예약 | `RESERVE`, 물리 현재고 불변 |
| 피킹 | `PICK`, 위치/물류상태 변경 |
| 스테이징 | `STAGE` |
| 창고 출발·PRS 도착 | `TRANSFER` |
| 라인사이드 인계 | `LINE_SIDE_DELIVERY` |
| MES 소비 | `CONSUME` |
| 취소 | 원 Movement별 `REVERSAL` |

기존 `availableQuantity`를 예약 시 먼저 차감한 뒤 ATP에서 예약을 다시 빼는
방식은 V2 전환 시 제거한다.

## 8. 단계별 전환

1. 자재별 UOM 규칙 승인 및 기초재고 대사
2. V2 컬렉션 인덱스와 단일 Posting 서비스 구현 — 코드 완료, replica-set 검증 필요
3. 입고·품질변경을 기존 원장과 V2에 병행 전기
4. 예약·피킹·이송·PRS·라인사이드·소비를 순차 전환
5. 최소 14일 또는 1,000건을 병행 검증
6. 설명되지 않는 차이가 0이면 조회 기준을 Balance V2로 전환
7. 이후 다중 Lot FEFO, HU 분할·병합, 순환실사와 Cockpit 확장

## 9. MVP 수용 기준

- 자재·사업장·위치·Lot·HU별 설명되지 않는 수량 차이 0
- 모든 현재고를 기초재고와 Movement V2 합으로 재현
- 예약 변화가 물리 현재고를 바꾸지 않음
- 이동 중 수량이 창고·PRS·라인사이드에 중복 집계되지 않음
- 동일 요청 ID 재호출 시 중복 전표 없음
- 동시 요청에서 음수재고·초과예약 없음
- 모든 취소가 원전표 참조 역분개로 추적됨
- 만료·보류·격리 재고가 ATP와 FEFO 후보에서 제외됨

## 10. 검증 상태

- 순수 계약 테스트: 통과
- Posting 전이·UOM·요청해시·Balance 계획 테스트: 통과
- TypeScript·ESLint: 통과
- replica-set 통합 테스트 진입점: 구현
- 실제 MongoDB 동시성·rollback 검증: 전용
  `INVENTORY_V2_TEST_DATABASE_URL`이 없어 미실행

통합 테스트는 운영 DB 오접속을 막기 위해 DB 이름이 `-test` 또는 `_test`로
끝나는 별도 replica set만 허용한다. 이 테스트가 통과하기 전에는 기존 입고
API에 V2 이중쓰기를 연결하지 않는다.
