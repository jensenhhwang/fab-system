# Fab Equipment Master — Fab별 표준 설비 대수

상태: `APPROVED_MODELED_DEFINITION`  
버전: `FAB_EQUIPMENT_MASTER_M20_V3`  
기준일: 2026-07-19

## 1. Fab별 설비 정의

이 문서는 M20·M21·M22의 **표준 설비 대수**를 정의하는 단일 기준 문서다. 설비 대수는 실제 구매·설치 완료 수량이 아니라 시스템이 생산계획과 장비 밀도를 계산할 때 사용하는 `modeled tool-equivalent`다.

| Fab | 기준 제품 | 기준 생산량 | NORMAL 목표 여유 | 표준 설비 대수 | 상태 |
|---|---|---:|---:|---:|---|
| M20 | HBM4 12-Hi 36GB | 117,000 WSPM | ≥15% | **494대** | `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE` |
| M21 | `TBD` | `TBD` | `TBD` | **TBD** | `NOT_MODELED` |
| M22 | `TBD` | `TBD` | `TBD` | **TBD** | `NOT_MODELED` |

M21·M22의 `TBD`는 0대를 뜻하지 않는다. 기준 제품, Route, WSPM이 승인되기 전까지 M20의 대수나 비율을 복사하지 않는다.

## 2. 설비 여유 계약

M20의 설비 여유는 공개된 업계 운전범위를 참고한 계획 기준으로, NORMAL 운전에서 유효 Capacity의 최소 15%를 비워 두는 것으로 정의한다. 85%는 특정 Fab들의 실측 평균이라는 뜻이 아니라 장기 80% 초과·고수요기 90~100% 사이에서 선택한 모델 기준이다.

```text
최대 계획 부하율 = 1 - 0.15 = 85%
M20 최소 지원 Capacity = 117,000 ÷ 0.85 = 137,647 WSPM
```

모든 평가 대상 공정은 NORMAL 117K에서 계획 부하율 85% 이하여야 한다. 장비는 정수 단위로 올림하므로 M20 V1의 실제 모델 병목은 약 138.3K WSPM, 부하율은 약 84.6%, 남는 여유는 약 15.4%다.

## 3. M20 표준 설비 대수

| 공정 | 대표 공정 | 표준 대수 | 이전 기준 | 변경 | Capacity 상태 |
|---|---|---:|---:|---:|---|
| P01 | 산화 | **32** | 32 | - | `WPH_PROXY` |
| P02 | CVD | **58** | 48 | +10 | `WPH_PROXY` |
| P03 | 포토 | **66** | 64 | +2 | `WPH_PROXY` |
| P04 | 식각 | **72** | 72 | - | `WPH_PROXY` |
| P05 | 이온주입 | **24** | 24 | - | `WPH_PROXY · 6 PASS/WAFER` |
| P06 | 금속배선 | **48** | 48 | - | `WPH_PROXY` |
| P07 | CMP | **62** | 32 | +30 | `WPH_PROXY` |
| P08 | TSV·박막화 | **56** | 56 | - | `WPH_PROXY · 4 PASS/WAFER` |
| P09 | 웨이퍼 테스트 | **40** | 40 | - | `WPH_PROXY` |
| P10 | 패키징(Singulation·Die Prep·HBM 조립·최종검사) | **36** | 36 | - | `NATIVE_STAGE_PROXY` |
| 합계 |  | **494** | **452** | **+42** | `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE` |

공정별 대수와 총대수는 `src/lib/m20-equipment-capacity-plan.ts`의 `M20_DEFINED_EQUIPMENT_COUNTS`와 항상 일치해야 한다.

### P05 이온주입 Capacity 계약

P05는 소잉 전 300 mm wafer 상태에서 처리한다. 공개 Route로 실제 recipe를 확정할 수 없으므로 Capacity planning에서만 Well·Isolation 2회, Vt·Channel 2회, Source/Drain·Extension 2회, 합계 **6 wafer-pass/wafer**를 사용한다. 이 값은 Route 노드 수와 자재 원단위를 변경하지 않는다.

```text
NORMAL 수요 = 117,000 ÷ 30 × 6 = 23,400 wafer-pass/day
유효 Capacity = 24대 × 120 wafer-pass/hour × 24 × 평균 modeled OEE 85.5%
계획 부하 = 약 39.6%
```

### P10 Packaging Native-stage Capacity 계약

P10 내부 `DICING`에서 wafer가 Memory KGD로 바뀌고 `BASE_DIE_ATTACH`에서 외부 Base Die KGD와 합류한다. 서로 다른 native capacity를 합산하지 않고 **공정 내부 단계별 부하의 최댓값**을 P10 대표 부하로 사용한다.

| 공정 | 단계 | 대수 | 정격 | Capacity 단위 | NORMAL 일 수요 | 계획 부하 |
|---|---|---:|---:|---|---:|---:|
| P10 | Dicing / Singulation | 6 | 38 | wafer/hour | 3,900 wafer | **약 83.4%** |
| P10 | Die Sort / KGD | 6 | 25,000 | KGD/hour | 2,535,000 KGD | 약 82.4% |
| P10 | 12-Hi DRAM Bonding | 16 | 9,200 | die-placement/hour | 2,535,000 placement | **약 83.9%** |
| P10 | MUF / Molding / Cure | 4 | 3,100 | stack/hour | 211,250 gross stack | 약 83.0% |
| P10 | Final Test | 4 | 3,100 | stack/hour | 211,250 gross stack | 약 83.0% |
| 합계 |  | **36** |  |  |  | P10 내부 병목: Bonding |

`650 KGD/wafer`에는 die yield가 이미 반영되어 있으므로 wafer yield를 다시 곱하지 않는다. 12개 DRAM die 기준 gross stack은 211,250개/day이며 Final Test 이후 assembly yield 90%를 한 번 적용해 **190,125 good stacks/day, 5,703,750 good stacks/month**로 산출한다. Base Die는 gross stack당 1개 소비하지만 Base Die Attach 설비 방식은 미검증이므로 `CAPACITY_PENDING`이다.

## 4. M20 생산 시나리오 적용

494대 정의에서 WPH 프록시 평가 대상 공정의 병목은 P03이다.

| 시나리오 | WSPM | 병목 부하율 | 남는 Capacity | 판정 |
|---|---:|---:|---:|---|
| `NORMAL` | 117,000 | 약 84.6% | 약 15.4% | 15% reserve 충족 |
| `UPLIFT` | 123,500 | 약 89.3% | 약 10.7% | 단기 증산 |
| `NAMEPLATE` | 130,000 | 약 94.0% | 약 6.0% | 스트레스 운전 |
| `EXPANSION` | 143,000 | 약 103.4% | 부족 | 별도 증설 필요 |

15% reserve는 평균 운영점인 NORMAL을 기준으로 적용한다. UPLIFT와 NAMEPLATE에 동일한 15% 여유를 요구하려면 새 Equipment Master 버전으로 대수를 다시 승인한다.

## 5. Capacity 단위와 범위

- P01~P09의 대수는 `WAFER_PASS_HOUR` 프록시, 24시간 운전, 장비별 모델 OEE, capacity planning pass를 사용한다.
- P05의 6 pass는 Capacity 전용 가정이며 Route Master 반복이나 자재 소모를 6배로 만들지 않는다.
- P10 내부 Dicing은 `WAFER_HOUR`, Die Sort는 `KGD_HOUR`, Bonding은 `DIE_PLACEMENT_HOUR`, Molding·Final Test는 `STACK_HOUR`로 각각 검증한다.
- 따라서 494대는 `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE`이며 실제 MES 정격·qualification을 반영한 `REAL_CAPACITY_VALIDATED`가 아니다.

## 6. 원장 반영 규칙

- M20 `equipmentMaster`는 공정별 표준 대수까지 부족한 deterministic ID만 추가한다.
- 기존 장비의 status, OEE, 위치, 배정 이력과 `MES_MASTER` 행은 덮어쓰지 않는다.
- 원장 대수가 표준보다 많으면 장비를 삭제하지 않고 마이그레이션을 중단해 검토한다.
- 같은 마이그레이션을 다시 실행했을 때 추가 대수는 0이어야 한다.
- M21·M22는 Equipment Master가 승인되기 전까지 원장을 자동 생성하지 않는다.

## 7. 연결 기준

- [`fab-master.md`](./fab-master.md): Fab별 WSPM·WIP·생산 시나리오
- [`route-master.md`](./route-master.md): 제품 Route와 공정 반복 정의
- [`material-consumption-master.md`](./material-consumption-master.md): wafer당 자재 원단위
- `src/lib/m20-equipment-capacity-plan.ts`: M20 494대와 15% reserve 계산 계약
- `scripts/migrate-m20-equipment-master.ts`: 기존 장비를 보존하는 M20 설비 원장 보정
