# FOUP & Lot Execution Master — M20·M21·M22 WIP·Carrier·실행 추적 기준

| Fab | 상태 | 버전 | 모델 원장 연결 |
|---|---|---|---|
| M20 | `APPROVED_MODELED_BASELINE` | `FOUP_WIP_MASTER_M20_V1` | `ACTIVE · FOUP_WIP_STEADY_STATE_M20_V1` |
| M21 | `APPROVED_MODELED_BASELINE` | `FOUP_WIP_MASTER_M21_V1` | 미구현 |
| M22 | `APPROVED_MODELED_BASELINE` | `FOUP_WIP_MASTER_M22_V1` | 미구현 |

기준일: 2026-07-21 (M21·M22 신규 정의 반영)  
실물 Fleet·MES 검증: `PENDING` (3팹 공통)

## 1. 목적과 적용 범위

이 문서는 M20·M21·M22의 Lot 실행 추적에서 사용하는 **논리 Wafer Lot, 공정 중 점유 FOUP, 전체 물리 FOUP Fleet, Dicing 이후 WIP**를 구분하고 수량·생애주기·표현 방법을 정의한다.

연결된 기준 문서:

- [`fab-master.md`](./fab-master.md): Fab별 NORMAL WSPM·Cycle Time·목표 WIP
- [`route-master.md`](./route-master.md): Fab별 Route와 FOUP 해제(Dicing) 경계
- [`fab-equipment-master.md`](./fab-equipment-master.md): Fab별 공정별 설비 대수와 Capacity reserve

M20 V1은 실행 모델의 승인 기준이며 14,040개 활성 Wafer Lot·15,600개 FOUP Carrier 원장과 Watched 12개 3D live view에 연결되어 있다. M21·M22 V1은 이 문서로 목표 수량이 승인됐으나 실행 원장·bootstrap은 아직 구현되지 않았다. 다만 `MODELED_BASELINE`이므로 실제 Fab의 실물 FOUP 보유량이나 MES 실적으로 해석하지 않는다.

이 문서의 §2~§13은 M20을 기준으로 서술한다. M21·M22의 fab-specific 수량·carrier 차이는 §14~§15에서 별도로 정의하며, 나머지 계약(FOUP 상태 머신, 원자적 전환, GET polling 불변식 등)은 3팹 공통이다.

## 2. 용어 정의

| 용어 | 정의 | M20 NORMAL V1 |
|---|---|---:|
| Wafer Lot | 동일 Route를 따르는 25장 단위 논리 생산 Lot | 156 lots/day |
| Occupied FOUP | 제품 wafer를 싣고 P01~P09 및 P10 Dicing 진입 전까지 사용 중인 FOUP | 14,040 |
| Physical FOUP Fleet | 공정 점유·회송·세정·정비·예비를 포함한 계획 보유량 | 15,600 |
| Non-process Pool | `AVAILABLE`, `EMPTY_RETURN`, `CLEANING`, `MAINTENANCE` 합계 | 1,560 |
| Back-end WIP equivalent | Singulation 이후 15일 WIP를 25-wafer release lot 단위로 환산한 값 | 2,340 |
| End-to-end WIP equivalent | 전체 105일 WIP의 release-lot 환산값 | 16,380 |
| Watched Lot | 전체 활성 Wafer Lot 중 3D·상세 추적 대상으로 선택된 Lot | 12 |

`14,040`, `15,600`, `16,380`은 서로 다른 수량이다. 특히 `16,380 FOUP-equivalent`는 실물 FOUP 보유량이 아니다.

## 3. V1 모델 입력

| 입력 | 값 | 상태 |
|---|---:|---|
| NORMAL wafer starts | 117,000 wafers/month | `FAB_MASTER_M20_V1` |
| 모델 월 일수 | 30 days | `MODELED_BASELINE` |
| 일 wafer starts | 3,900 wafers/day | 파생값 |
| FOUP 적재량 | 25 wafers/FOUP | `MODELED_BASELINE` |
| 일 Wafer Lot release | 156 lots/day | 파생값 |
| End-to-end Cycle Time | 105 days | `FAB_MASTER_M20_V1` |
| Wafer/FOUP 구간 체류 | 90 days | `LOW · CALIBRATION_REQUIRED` |
| Singulation 이후 체류 | 15 days | `LOW · CALIBRATION_REQUIRED` |
| 목표 Fleet 점유율 | 90% | `LOW · CALIBRATION_REQUIRED` |
| KGD | 650 Memory KGD/wafer | 계획 기대값 |
| DRAM 적층수 | 12 Memory KGD/stack | HBM4 12-Hi |
| Assembly yield | 90% | 계획 기대값 |

90일/15일 분할은 Route의 모델 step 수 비율로 계산한 값이 아니다. Operation별 queue·process·transport·hold 시간이 아직 없으므로 전체 105일을 연결하기 위해 둔 저신뢰도 계획 가정이다.

## 4. Little's Law 계산 계약

```text
Daily wafer release
  = 117,000 ÷ 30
  = 3,900 wafers/day

Daily Wafer Lot release
  = 3,900 ÷ 25
  = 156 lots/day

Target occupied FOUP
  = 156 × 90
  = 14,040 FOUP

Target physical FOUP fleet
  = 14,040 ÷ 0.90 target occupancy ratio
  = 15,600 FOUP

Non-process pool
  = 15,600 - 14,040
  = 1,560 FOUP

Back-end WIP equivalent
  = 156 × 15
  = 2,340 lot-equivalent

End-to-end WIP equivalent
  = 14,040 + 2,340
  = 16,380 lot-equivalent
```

Non-process Pool 1,560대는 전체 Fleet의 10%이며 Occupied FOUP 14,040대 대비 약 11.1%다. V1에서는 Pool 내부 상태별 목표 대수를 임의로 고정하지 않는다.

## 5. Target과 Actual 분리

| 지표 | Target | Actual | 연결 상태 |
|---|---:|---:|---|
| Daily Wafer Lot release | 156 | 156 modeled slots/day | `MODELED_SCHEDULE` |
| Occupied FOUP | 14,040 | 14,040 | `LEDGER_EXACT` |
| Physical FOUP Fleet | 15,600 | 15,600 | `LEDGER_EXACT` |
| Non-process Pool | 1,560 | 1,560 `AVAILABLE` | `LEDGER_EXACT` |
| Watched Lot | 12 | 12 | `LEDGER_EXACT · DYNAMIC_3D` |
| Active Lot–FOUP assignment | 14,040 | 14,040 | `LEDGER_EXACT` |
| P10 이후 활성 FOUP assignment | 0 | 0 | `BOUNDARY_DEFINED · TRANSITION_NOT_BOOTSTRAPPED` |
| Singulation 이후 WIP equivalent | 2,340 | - | `NOT_BOOTSTRAPPED` |

화면은 `targetOccupiedFoup`과 DB 활성 assignment에서 집계한 `actualOccupiedFoup`을 별도로 표시한다. 현재 12개 Watched Lot은 전체 14,040개에 포함된 상세 추적 표본이며 WIP에 중복 합산하지 않는다.

## 6. FOUP Fleet 상태 계약

```text
Physical Fleet 15,600
├─ ASSIGNED_IN_PROCESS             14,040 target
└─ Non-process Pool                 1,560 target
   ├─ AVAILABLE
   ├─ EMPTY_RETURN
   ├─ CLEANING
   └─ MAINTENANCE
```

Carrier의 점유 상태와 이동 상태는 분리한다.

```text
state:
  AVAILABLE | ASSIGNED_IN_PROCESS | CLEANING | MAINTENANCE

movementStatus:
  STATIONARY | IN_TRANSIT | EMPTY_RETURN
```

FOUP는 `ASSIGNED_IN_PROCESS + IN_TRANSIT`처럼 두 상태를 동시에 가질 수 있다.

핵심 불변식:

```text
Physical Fleet
  = ASSIGNED_IN_PROCESS
  + AVAILABLE
  + EMPTY_RETURN
  + CLEANING
  + MAINTENANCE
```

## 7. P10 Carrier 전환 경계

FOUP 해제 시점은 Dicing 완료가 아니라 **P10.`DICING` 진입 시 wafer unload/mount 경계**다.

```text
P09 Final Wafer Test
→ P10.DICING entry
→ FOUP에서 wafer unload
→ wafer를 DICING_FRAME에 mount
→ FOUP empty return·cleaning·reuse
→ Dicing / Singulation
→ Memory KGD를 DIE_TRAY로 이동
→ Base Die KGD와 합류
→ STACK_TRAY
→ Finished HBM carrier
```

다음 세 이벤트는 하나의 원자적 전환으로 처리한다.

```text
FOUP_UNLOADED
FOUP_RELEASED
DICING_FRAME_ASSIGNED
```

일부 이벤트만 성공해 Wafer Lot이 carrier 없이 남거나 FOUP이 두 Lot에 중복 배정되는 상태를 허용하지 않는다.

## 8. Lot·Carrier 데이터 계약

### WaferLot

```text
lotId
fabId
product
waferQty
routeKey
routeVersion
currentNodeId
currentStepIndex
status
plannedEnterAt / plannedExitAt
actualEnterAt / actualExitAt
watchLevel
```

### CarrierMaster

```text
carrierId
carrierType: FOUP | DICING_FRAME | DIE_TRAY | STACK_TRAY
capacity
state
movementStatus
currentLocationId
source: MODELED_BASELINE | MES_ACTUAL
```

### LotCarrierAssignment

```text
lotId
carrierId
assignedAt
releasedAt
assignmentStatus
```

### GenealogyEdge

```text
parentLotId
childLotId
operationCode
consumedQty
uom
createdAt
```

제약 조건:

- Carrier 하나에는 활성 assignment가 최대 1개다.
- Wafer Lot 하나에는 활성 FOUP assignment가 최대 1개다.
- `waferQty`는 FOUP capacity 25장을 초과하지 않는다.
- P10 Dicing unload 이후 Wafer Lot의 활성 FOUP assignment는 0개다.
- Watched Lot 12개는 활성 14,040개 안에 포함되며 WIP에 중복 합산하지 않는다.

## 9. 실행·이벤트 처리 계약

14,040개 Lot을 5초마다 일괄 업데이트하지 않는다. Lot별 계획 시각에서 현재 상태를 투영하고 실제 전이·작업자 확인·예외가 발생할 때만 원장을 쓴다.

```text
plannedEnterAt
plannedExitAt
actualEnterAt
actualExitAt
```

허용되는 쓰기 이벤트 예시는 다음과 같다.

- Lot release와 공정 도착·출발
- Carrier assign·release
- Hold·Rework·설비 지연
- P10 carrier 전환
- 수량 genealogy 생성

GET polling과 단순 화면 조회는 DB를 변경하지 않는다.

## 10. Bootstrap 정책

| 모드 | 정의 | 사용처 |
|---|---|---|
| `COLD_START` | WIP 0에서 일평균 156 Lot을 투입해 약 90일 동안 Occupied FOUP가 증가 | 신규 Fab ramp-up 시뮬레이션 |
| `STEADY_STATE_BOOTSTRAP` | 지난 90일에 걸쳐 일 156 Lot이 투입된 것으로 분산 생성 | 현재 M20 정상운영 대시보드 |

`STEADY_STATE_BOOTSTRAP`에서 14,040개 Lot을 모두 현재 시각의 P01에 만들지 않는다. Release time과 Route node별 dwell 가중치에 따라 현재 공정·operation에 분산한다. 동일 bootstrap을 재실행해도 Lot이나 Carrier가 중복 생성되지 않아야 한다.

## 11. Die·Stack genealogy와 수량 보존

FOUP 1개에 해당하는 계획 기대값은 다음과 같다.

```text
25 wafers × 650 Memory KGD/wafer
  = 16,250 Memory KGD

16,250 ÷ 12 Memory KGD/stack
  = 1,354.1667 gross stack-equivalent

1,354.1667 × 90% assembly yield
  = 1,218.75 good HBM expected value
```

소수 stack은 계획 기대값일 뿐 실제 Lot 객체가 아니다. 실행 원장에서는 다음처럼 정수 수량과 잔여 KGD를 보존한다.

```text
assemblableStacks = floor(availableMemoryKgd ÷ 12)
remainingMemoryKgd = availableMemoryKgd % 12

FOUP-equivalent 1개 기준:
assemblableStacks = 1,354
remainingMemoryKgd = 2
```

잔여 KGD는 폐기하지 않고 quantity genealogy로 다음 조립 batch와 합칠 수 있어야 한다. 월 계획값은 다음과 같다.

```text
117,000 wafers × 650 KGD ÷ 12
  = 6,337,500 gross stack starts/month

6,337,500 × 90%
  = 5,703,750 good HBM4 12-Hi 36GB/month
```

실제 Lot에서는 650 KGD/wafer 기대값 대신 Wafer Test와 Die Sort 실적 수량을 사용한다. Stack genealogy는 `12 Memory KGD + 1 Base Die KGD → 1 gross Stack`의 수량 관계를 기록한다.

## 12. Lot 추적 화면과 3D 표현

Lot 실행 추적 화면은 다음 수량을 동시에 보여준다.

```text
Target Occupied FOUP  14,040
Actual Occupied FOUP  14,040 (DB 활성 assignment 집계)
Physical Fleet        15,600
Reserve               1,560
Watched Lot           12 (Occupied 안에 포함)
```

표현 원칙:

- 전체 Lot·Carrier 수량과 공정별 분포는 실행 원장·검색·수량판에서 표시한다.
- Watched 12개와 현재 선택·이송 중인 Lot만 상세 경로 애니메이션을 적용한다.
- 실행 추적 화면은 전체 활성 Lot 14,040개를 Lot ID·FOUP ID·Route node로 검색하고 10개씩 페이지 조회한다.
- Watched 12개는 같은 전체 원장 안에서 `WATCHED`로 구분하며 별도의 3D 이동·이벤트 이력을 제공한다.
- 렌더링 객체 수가 아니라 DB 원장 집계를 화면의 실제 수량으로 사용한다.

현재 3D는 이동 의미가 있는 Watched 12개만 개별 객체로 표현한다. 나머지 15,588개를 좁은 장면에 압축 배치하면 실제 설비와 겹쳐 물리 배치로 오해될 수 있으므로 3D density 객체는 표시하지 않는다. Physical Fleet 15,600개와 Occupied 14,040개의 기준은 DB 원장 `LEDGER_EXACT`이며, 전체 Lot은 실행 추적 화면에서 10개씩 페이지 조회한다.

## M21 FOUP·Lot 수량

M21은 [`fab-master.md`](./fab-master.md#m21--dram)이 확정한 NORMAL 184,000 WSPM(M16급 실측 규모 근거), 80일 cycle time(Wafer/FOUP 구간 70일 + Back-end 10일)에서 동일한 Little's Law 계약을 적용한다. FOUP 해제 경계는 M20과 동일하게 **P10.`DICING` 진입 시점**이다([`route-master.md`](./route-master.md#m21--dram) 문서 스텝 119).

```text
Daily Wafer Lot release   = 184,000 ÷ 30 ÷ 25 = 245.3 lots/day

Target Occupied FOUP      = 245.3 × 70 = 17,173 FOUP
Target Physical Fleet     = 17,173 ÷ 90% target occupancy ratio = 19,081 FOUP
Non-process Pool          = 19,081 − 17,173 = 1,908 FOUP

Back-end WIP equivalent   = 245.3 × 10 = 2,453 lot-equivalent
End-to-end WIP equivalent = 17,173 + 2,453 = 19,626 FOUP-equivalent
```

| 지표 | M21 Target |
|---|---:|
| Occupied FOUP | 17,173 |
| Physical FOUP Fleet | 19,081 |
| Non-process Pool | 1,908 |
| End-to-end WIP equivalent | 19,626 |

### M21 Carrier 전환 경계

M21은 스택 조립이 없으므로 M20의 `DICING_FRAME → DIE_TRAY → STACK_TRAY` 체인 대신 **`DICING_FRAME → DIE_TRAY → LEADFRAME_OR_SUBSTRATE`**로 끝난다.

```text
P09 Final Wafer Test (EDS)
→ P10.DICING entry
→ FOUP에서 wafer unload, DICING_FRAME에 mount
→ FOUP empty return·cleaning·reuse
→ Dicing / Singulation
→ 양품 die를 DIE_TRAY로 이동
→ LEADFRAME 또는 SUBSTRATE에 Die Attach
→ Finished conventional package carrier(strip)
```

`CarrierMaster.carrierType`에 `LEADFRAME`·`SUBSTRATE`를 M21 전용으로 추가한다. M20의 `STACK_TRAY`, Base Die 합류 이벤트는 M21에 존재하지 않는다.

### M21 수량 보존

적층이 없으므로 M20의 "12 Memory KGD + 1 Base Die → 1 gross Stack" 같은 배수 관계가 없다. **1 양품 die = 1 package**로 수량이 그대로 보존되며, genealogy는 `parentLotId(wafer lot) → childLotId(die/package batch)` 단일 엣지로 충분하다.

```text
FOUP 1개(25 wafers) 기준 계획 기대값
  = 25 × 759 양품 die/wafer × 98% 패키징 조립수율
  = 18,595.5 양품 package 기대값
```

---

## M22 FOUP·Lot 수량

M22는 [`fab-master.md`](./fab-master.md#m22--nand)가 확정한 NORMAL 108,000 WSPM(NAND 단일 라인 실측 규모 근거), 150일 cycle time(Wafer/FOUP 구간 130일 + Back-end 20일)에서 동일한 Little's Law 계약을 적용한다. FOUP 해제 경계는 M20·M21과 동일하게 **P10.`DICING` 진입 시점**이다([`route-master.md`](./route-master.md#m22--nand) 문서 스텝 240).

```text
Daily Wafer Lot release   = 108,000 ÷ 30 ÷ 25 = 144 lots/day

Target Occupied FOUP      = 144 × 130 = 18,720 FOUP
Target Physical Fleet     = 18,720 ÷ 90% target occupancy ratio = 20,800 FOUP
Non-process Pool          = 20,800 − 18,720 = 2,080 FOUP

Back-end WIP equivalent   = 144 × 20 = 2,880 lot-equivalent
End-to-end WIP equivalent = 18,720 + 2,880 = 21,600 FOUP-equivalent
```

| 지표 | M22 Target |
|---|---:|
| Occupied FOUP | 18,720 |
| Physical FOUP Fleet | 20,800 |
| Non-process Pool | 2,080 |
| End-to-end WIP equivalent | 21,600 |

Wafer/FOUP 구간이 M20(90일)·M21(70일)보다 훨씬 긴 130일인 것은 321단 적층의 반복 공정 스텝 수(239스텝, `route-master.md` 참고)가 두 Fab보다 훨씬 많기 때문이며, Occupied FOUP·Physical Fleet가 M20보다 큰 것도 같은 이유다 — M22의 NORMAL WSPM(108,000)은 M20(117,000)과 비슷한 수준인데도 WIP는 더 크다.

### M22 Carrier 전환 경계

M22는 M20처럼 다이 적층이 있지만 TSV가 아니라 와이어본딩 기반이다. `DICING_FRAME → DIE_TRAY → WIREBOND_STACK_CARRIER`로 전환한다.

```text
P09 Final Wafer Test (EDS)
→ P10.DICING entry
→ FOUP에서 wafer unload, DICING_FRAME에 mount
→ FOUP empty return·cleaning·reuse
→ Dicing / Singulation
→ 양품 die를 DIE_TRAY로 이동
→ 16개 양품 die를 WIREBOND_STACK_CARRIER에 순차 Die Attach·Wire Bond
→ Finished 16-die package carrier
```

`CarrierMaster.carrierType`에 `WIREBOND_STACK_CARRIER`를 M22 전용으로 추가한다. M20의 Base Die 외부조달·합류 이벤트는 M22에 없다 — 16개 die는 모두 동일 wafer 계열의 양품 die다.

### M22 수량 보존

```text
assemblablePackages = floor(availableGoodDie ÷ 16)
remainingGoodDie     = availableGoodDie % 16

FOUP 1개(25 wafers) 기준 계획 기대값
  = 25 × 1,249 양품 die/wafer = 31,225 양품 die
  assemblablePackages = floor(31,225 ÷ 16) = 1,951
  remainingGoodDie     = 31,225 % 16 = 9
  양품 package(96% 조립수율 적용) = 1,951 × 0.96 ≈ 1,873
```

잔여 die는 M20의 잔여 KGD와 동일하게 폐기하지 않고 다음 조립 batch로 genealogy를 이어간다.

---

## 13. 검증 기준

### M20

- 일평균 신규 Wafer Lot은 156개, 월 release는 4,680개다.
- 정상상태 Target Occupied FOUP는 14,040개다.
- Modeled Physical Fleet 상태 합계는 15,600개다.
- Watched 12개는 활성 Lot 14,040개에 포함된다.
- 12 Memory KGD와 1 Base Die KGD가 1 gross Stack으로 수량 보존된다.
- 90일 Wafer 구간과 15일 Back-end 구간의 합은 105일이다.

### M21

- 일평균 신규 Wafer Lot은 245.3개다.
- 정상상태 Target Occupied FOUP는 17,173개, Physical Fleet는 19,081개다.
- 1 양품 die = 1 package로 수량이 보존된다(적층 없음).
- 70일 Wafer 구간과 10일 Back-end 구간의 합은 80일이다.

### M22

- 일평균 신규 Wafer Lot은 144개다.
- 정상상태 Target Occupied FOUP는 18,720개, Physical Fleet는 20,800개다.
- 16개 양품 die가 1 package로 수량 보존되며 잔여 die는 폐기하지 않는다.
- 130일 Wafer 구간과 20일 Back-end 구간의 합은 150일이다.

### 3팹 공통

- Carrier별 활성 assignment는 최대 1개다.
- Wafer Lot 하나에는 활성 FOUP assignment가 최대 1개다.
- P10 Dicing unload 이후 활성 FOUP assignment는 0개다.
- FOUP은 empty return·cleaning 이후 다시 `AVAILABLE`이 될 수 있다.
- GET polling은 Lot·Carrier·Event 원장을 변경하지 않는다.
- Steady-state bootstrap 재실행 시 중복 생성은 0개다(구현 시).

## 14. 변경 관리

다음 값이나 경계가 바뀌면 해당 Fab의 버전(`FOUP_WIP_MASTER_M20_V2`/`_M21_V2`/`_M22_V2`)으로 올리고 Target·bootstrap·3D 집계를 함께 재생성한다.

- NORMAL WSPM 또는 모델 월 일수 30일
- FOUP 적재량 25장
- Wafer/FOUP 체류일수 또는 Back-end 체류일수
- Target Fleet 점유율 90%
- P10 Dicing carrier 해제 operation
- 완제품 환산 가정(M20: 650 KGD/wafer·12 dies/stack·조립수율 90% / M21: 759 양품 die/wafer·조립수율 98% / M22: 1,249 양품 die/wafer·16 dies/package·조립수율 96%)
- 실제 FOUP inventory·scan·MES Cycle Time 연결
- Lot·Carrier·Genealogy 스키마 또는 bootstrap 정책

실측값이 연결되면 `MES_ACTUAL`을 Target 가정보다 우선하되 과거 시나리오 재현을 위해 V1 문서와 계산 계약은 보존한다. M21·M22는 이 문서로 목표 수량이 승인됐으나, §9(실행·이벤트 처리 계약)·§10(Bootstrap 정책)에 해당하는 실행 원장·`waferLots`/`lotCarrierAssignments` 컬렉션 연결은 별도 마이그레이션 구현이 필요하다.
