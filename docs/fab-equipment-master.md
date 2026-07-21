# Fab Equipment Master — Fab별 표준 설비 대수

| Fab | 상태 | 버전 |
|---|---|---|
| M20 | `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE` | `FAB_EQUIPMENT_MASTER_M20_V3` |
| M21 | `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE` | `FAB_EQUIPMENT_MASTER_M21_V1` |
| M22 | `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE` | `FAB_EQUIPMENT_MASTER_M22_V1` |

기준일: 2026-07-21

## 1. Fab별 설비 정의

이 문서는 M20·M21·M22의 **표준 설비 대수**를 정의하는 단일 기준 문서다. 설비 대수는 실제 구매·설치 완료 수량이 아니라 시스템이 생산계획과 장비 밀도를 계산할 때 사용하는 `modeled tool-equivalent`다.

| Fab | 기준 제품 | 기준 생산량 | NORMAL 목표 여유 | 표준 설비 대수 | 상태 |
|---|---|---:|---:|---:|---|
| M20 | HBM4 12-Hi 36GB | 117,000 WSPM | ≥15% | **494대** | `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE` |
| M21 | DDR5 16Gb | 184,000 WSPM | ≥15% | **488대** | `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE` |
| M22 | NAND 321단 1Tb TLC | 108,000 WSPM | ≥15% | **512대** | `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE` |

M21·M22는 M20의 대수나 비율을 복사하지 않고, [`route-master.md`](./route-master.md)가 확정한 각자의 공정 방문수(pass count)와 [`fab-master.md`](./fab-master.md)가 확정한 각자의 NORMAL WSPM으로 M20과 **동일한 WPH_PROXY 계산 방법론**(`src/lib/m20-equipment-capacity-plan.ts`의 `modeledOeeForSequence`/`supportedWspm` 공식)을 독립 적용해 도출했다. M20은 기존 설치 대수(`previousCount`)를 하한으로 두고 부족한 만큼만 올림하는 반면, M21·M22는 신규 정의라 하한이 없어 **NORMAL 계획 부하 85% 이하를 만족하는 최소 대수**를 그대로 표준 대수로 채택한다.

## 2. 설비 여유 계약

3팹 공통으로 NORMAL 운전에서 유효 Capacity의 최소 15%를 비워 두는 것으로 정의한다. 85%는 특정 Fab들의 실측 평균이라는 뜻이 아니라 장기 80% 초과·고수요기 90~100% 사이에서 선택한 모델 기준이다([SIA](https://www.semiconductors.org/wp-content/uploads/2021/06/SIA-Final-submission-to-FCC-on-Impact-of-Global-Semiconductor-Shortage-on-the-U.S.-Communications-Sector-June-10-2021.pdf)).

```text
최대 계획 부하율 = 1 - 0.15 = 85%
```

모든 WPH_PROXY 평가 대상 공정은 각 Fab NORMAL WSPM에서 계획 부하율 85% 이하여야 한다. 장비는 정수 단위로 올림하므로 실제 병목 공정의 부하율은 85%에 근접하되 그 이하로 유지된다.

---

## M20 표준 설비 대수

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

P05는 소잉 전 300 mm wafer 상태에서 처리한다. Well·Isolation 2회, Vt·Channel 2회, Source/Drain·Extension 2회, 합계 **6 wafer-pass/wafer**를 사용한다. 이 값은 Route 노드 수와 자재 원단위를 변경하지 않는다.

### P10 Packaging Native-stage Capacity 계약

| 공정 | 단계 | 대수 | 정격 | Capacity 단위 | NORMAL 일 수요 | 계획 부하 |
|---|---|---:|---:|---|---:|---:|
| P10 | Dicing / Singulation | 6 | 38 | wafer/hour | 3,900 wafer | 약 83.4% |
| P10 | Die Sort / KGD | 6 | 25,000 | KGD/hour | 2,535,000 KGD | 약 82.4% |
| P10 | 12-Hi DRAM Bonding | 16 | 9,200 | die-placement/hour | 2,535,000 placement | **약 83.9%** |
| P10 | MUF / Molding / Cure | 4 | 3,100 | stack/hour | 211,250 gross stack | 약 83.0% |
| P10 | Final Test | 4 | 3,100 | stack/hour | 211,250 gross stack | 약 83.0% |
| 합계 |  | **36** |  |  |  | P10 내부 병목: Bonding |

### M20 생산 시나리오 적용

| 시나리오 | WSPM | 병목 부하율 | 남는 Capacity | 판정 |
|---|---:|---:|---:|---|
| `NORMAL` | 117,000 | 약 84.6% | 약 15.4% | 15% reserve 충족 |
| `UPLIFT` | 123,500 | 약 89.3% | 약 10.7% | 단기 증산 |
| `NAMEPLATE` | 130,000 | 약 94.0% | 약 6.0% | 스트레스 운전 |
| `EXPANSION` | 143,000 | 약 103.4% | 부족 | 별도 증설 필요 |

---

## M21 표준 설비 대수

M21은 P08(TSV) 전 공정이 없고, P09는 1회(EDS)만 필요하다([`route-master.md`](./route-master.md#m21--dram)). NORMAL 184,000 WSPM(M16급 실측 규모 근거, [`fab-master.md`](./fab-master.md#m21--dram) 참고)과 M21의 route pass count로 M20과 동일한 WPH_PROXY 공식을 새로 적용했다.

| 공정 | 대표 공정 | Route pass/wafer | 표준 대수 | 계획 부하 | Capacity 상태 |
|---|---|---:|---:|---:|---|
| P01 | 산화 | 4 | **13** | 80.2% | `WPH_PROXY` |
| P02 | CVD | 27 | **91** | 84.5% | `WPH_PROXY` |
| P03 | 포토 | 27 | **104** | 84.3% | `WPH_PROXY` |
| P04 | 식각 | 27 | **88** | 84.9% | `WPH_PROXY` |
| P05 | 이온주입 | 6(M20과 동일 가정) | **18** | 83.2% | `WPH_PROXY · 6 PASS/WAFER` |
| P06 | 금속배선 | 5 | **17** | 83.9% | `WPH_PROXY` |
| P07 | CMP | 27 | **97** | 84.9% | `WPH_PROXY` |
| P09 | 웨이퍼 테스트 | 1(적층 없어 재검 불필요) | **3** | 78.0% | `WPH_PROXY` |
| P10 | Conventional 단일 다이 패키징 | — | **57** | `RATE_TBD` | `NATIVE_STAGE_PROXY · RATE_TBD` |
| 합계 |  |  | **488** |  | `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE` |

P01~P07·P09는 M20과 동일한 `ratedWph`(P01=115, P02=105, P03=92, P04=108, P05=120, P06=105, P07=98, P09=130 wafer/hour)를 재사용한다 — DRAM 프런트엔드가 HBM과 같은 물리 공정·장비군을 쓴다는 근거([Applied Materials](https://www.appliedmaterials.com/us/en/newsroom/blogs/hbm--materials-innovation-propels-high-bandwidth-memory-into-the.html))에 따른 것이며, 대수 자체는 M21 고유의 WSPM·pass count에서 새로 계산한 결과다. P09는 M20의 절반(pass 1 vs 2)이라 WSPM이 더 큰데도 대수는 M20(40대)보다 적다.

**총 대수(488대)가 M20(494대)과 거의 같은 이유**: M21의 WSPM(184,000)은 M20(117,000)보다 57% 크지만, P08(TSV) 공정군이 통째로 없고 P09도 절반이라 wafer당 필요 설비가 그만큼 적다. 두 효과가 상쇄되면서 총 대수가 우연히 비슷해졌다 — 의도한 결과가 아니라 계산 결과다.

### P10 Conventional Packaging Capacity 계약 — `RATE_TBD`

M21의 P10은 M20처럼 다이 적층(Bonding)이 아니라 리드프레임/기판 실장이라 설비 카테고리 자체가 다르다([SK hynix Newsroom](https://news.skhynix.com/semiconductor-back-end-process-episode-6-conventional-packages/)). Wire bonder·molding press·trim-form/ball-mount 장비의 공개 UPH(시간당 처리량) 데이터를 확보하지 못해, 아래 대수는 M20 P10(36대 / 117,000 WSPM)과 동일한 대수-대-WSPM 비율을 M21 WSPM(184,000)에 적용한 **자릿수 placeholder**다. 실제 vendor spec이 들어오기 전까지 정격(`ratedRate`)은 `RATE_TBD`로 두고 계획 부하율을 계산하지 않는다.

| 단계 | 대수(placeholder) | 상태 |
|---|---:|---|
| Backgrind(단일-패스) | 5 | `RATE_TBD` |
| Dicing / Singulation | 8 | `RATE_TBD` |
| Die Attach | 7 | `RATE_TBD` |
| Wire Bond | 17 | `RATE_TBD` |
| Molding | 7 | `RATE_TBD` |
| Lead Finish / Ball Mount | 5 | `RATE_TBD` |
| Final Test | 8 | `RATE_TBD` |
| 합계 | **57** | `RATE_TBD` |

### M21 생산 시나리오 적용

| 시나리오 | WSPM | 병목 공정 | 병목 부하율(P01~P09 기준) | 판정 |
|---|---:|---:|---:|---|
| `NORMAL` | 184,000 | P04·P07 | 약 84.9% | 15% reserve 충족 |
| `UPLIFT` | 192,000 | P04·P07 | 약 88.6% | 단기 증산 |
| `NAMEPLATE` | 200,000 | P04·P07 | 약 92.3% | 스트레스 운전 |
| `EXPANSION` | 220,000 | P04·P07 | 약 101.5% | 별도 증설 필요 |

---

## M22 표준 설비 대수

M22는 321단 3-deck NAND의 route pass count(`route-master.md` 참고)가 반영되어 P02(CVD)가 압도적으로 많다. NORMAL 108,000 WSPM(NAND 단일 라인 실측 규모, [`fab-master.md`](./fab-master.md#m22--nand) 참고) 기준으로 계산했다.

| 공정 | 대표 공정 | Route pass/wafer | 표준 대수 | 계획 부하 | Capacity 상태 |
|---|---|---:|---:|---:|---|
| P01 | 산화(주변 CMOS) | 3 | **6** | 76.3% | `WPH_PROXY` |
| P02 | CVD(스택 증착 161 + ONO 1) | 162 | **319** | 84.8% | `WPH_PROXY` |
| P03 | 포토(주변 3 + Staircase 21) | 24 | **54** | 84.8% | `WPH_PROXY` |
| P04 | 식각(주변 3 + 채널홀 3 + Staircase 21 + 게이트치환 3) | 30 | **58** | 84.1% | `WPH_PROXY` |
| P05 | 이온주입(주변 CMOS) | 3 | **6** | 73.1% | `WPH_PROXY · M20 동일 가정 재사용` |
| P06 | 금속배선(주변 3 + 게이트치환 텅스텐 3) | 6 | **12** | 83.9% | `WPH_PROXY` |
| P07 | CMP(주변 3 + 평탄화 7) | 10 | **22** | 81.4% | `WPH_PROXY` |
| P09 | 웨이퍼 테스트 | 1 | **2** | 69.1% | `WPH_PROXY` |
| P10 | 16단 와이어본딩 패키징 | — | **33** | `RATE_TBD` | `NATIVE_STAGE_PROXY · RATE_TBD` |
| 합계 |  |  | **512** |  | `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE` |

P01~P07·P09는 M20과 동일한 `ratedWph`를 재사용하되(동일 세대 장비 기술이라는 가정), pass count는 M22의 route-master.md 표(§ M22 · NAND)에서 그대로 가져왔다. **M22 총 대수(512)가 M20(494)보다 많고 M21(488)보다도 많다** — M22의 NORMAL WSPM(108,000)은 M20(117,000)보다 낮지만 P02·P03·P04 개별 대수는 M20보다 훨씬 많다(P02 319 vs 58). 이는 321단 적층으로 인한 증착·식각 반복 방문수 증가(162 vs 27, 30 vs 27) 때문이며, NAND Fab이 DRAM/HBM Fab보다 wafer당 장비 시간을 훨씬 많이 소비한다는 업계 통설과 일치한다([Lam Research](https://newsroom.lamresearch.com/learning-from-nand-3d-dram-transition-ai-era)).

### P10 와이어본딩 패키징 Capacity 계약 — `RATE_TBD`

M21과 동일한 이유로 wire bonder 등의 공개 UPH를 확보하지 못했다. M20 P10 비율(36대/117,000 WSPM)을 M22 WSPM(108,000)에 적용한 placeholder이며, 16단 적층 특성상 Wire Bond 단계 비중을 M21보다 높게 배분했다.

| 단계 | 대수(placeholder) | 상태 |
|---|---:|---|
| Backgrind | 2 | `RATE_TBD` |
| Dicing / Singulation | 4 | `RATE_TBD` |
| Die Attach | 5 | `RATE_TBD` |
| Wire Bond(16단 적층) | 12 | `RATE_TBD` |
| Molding | 4 | `RATE_TBD` |
| Lead Finish / Ball Mount | 2 | `RATE_TBD` |
| Final Test | 4 | `RATE_TBD` |
| 합계 | **33** | `RATE_TBD` |

### M22 생산 시나리오 적용

| 시나리오 | WSPM | 병목 공정 | 병목 부하율(P01~P09 기준) | 판정 |
|---|---:|---:|---:|---|
| `NORMAL` | 108,000 | P02 | 약 84.8% | 15% reserve 충족 |
| `UPLIFT` | 114,000 | P02 | 약 89.6% | 단기 증산 |
| `NAMEPLATE` | 120,000 | P02 | 약 94.3% | 스트레스 운전 |
| `EXPANSION` | 132,000 | P02 | 약 103.7% | 별도 증설 필요 |

---

## 3. Capacity 단위와 범위

- P01~P07·P09의 대수는 `WAFER_PASS_HOUR` 프록시, 24시간 운전, 장비별 모델 OEE(`modeledOeeForSequence`, 시퀀스별 0.82~0.89 순환), capacity planning pass를 사용한다. 3팹 공통 방법론이다.
- P05의 6 pass는 3팹 공통 Capacity 전용 가정이며 Route Master 반복이나 자재 소모를 늘리지 않는다.
- P10은 Fab마다 native capacity 구성이 다르다: M20은 wafer/KGD/die-placement/stack 단위 5-stage, M21·M22는 conventional/와이어본딩 패키징 stage로 구성이 전혀 다르며 현재 `RATE_TBD`다.
- 따라서 494대(M20)·488대(M21)·512대(M22)는 모두 `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE`이며 실제 MES 정격·qualification을 반영한 `REAL_CAPACITY_VALIDATED`가 아니다.

## 4. 원장 반영 규칙

- M20 `equipmentMaster`는 공정별 표준 대수까지 부족한 deterministic ID만 추가한다.
- 기존 장비의 status, OEE, 위치, 배정 이력과 `MES_MASTER` 행은 덮어쓰지 않는다.
- 원장 대수가 표준보다 많으면 장비를 삭제하지 않고 마이그레이션을 중단해 검토한다.
- 같은 마이그레이션을 다시 실행했을 때 추가 대수는 0이어야 한다.
- **M21·M22는 이 문서로 표준 대수가 승인됐지만, 마이그레이션 스크립트(`scripts/migrate-m21-equipment-master.ts` 등)가 아직 없어 원장을 자동 생성하지 않는다.** P10 native-stage 정격이 `RATE_TBD`인 상태에서 원장을 만들면 계획 부하율 계산이 부정확해지므로, 최소한 P10 vendor spec을 `RATE_TBD`에서 벗어나게 한 뒤 마이그레이션을 구현한다.

## 5. 연결 기준

- [`fab-master.md`](./fab-master.md): Fab별 WSPM·WIP·생산 시나리오
- [`route-master.md`](./route-master.md): 제품 Route와 공정 반복 정의
- [`material-consumption-master.md`](./material-consumption-master.md): wafer당 자재 원단위
- `src/lib/m20-equipment-capacity-plan.ts`: M20 494대와 15% reserve 계산 계약 — `modeledOeeForSequence`/`supportedWspm` 공식은 M21·M22 문서 계산에도 동일하게 재사용됨
- `scripts/migrate-m20-equipment-master.ts`: 기존 장비를 보존하는 M20 설비 원장 보정
- M21·M22 마이그레이션 스크립트: 미구현 — 4번 항목 참고

## 6. 변경 관리

다음 값이 바뀌면 해당 Fab의 버전을 올리고 파생값을 모두 재생성한다.

- NORMAL WSPM 또는 Route pass count
- P10 native-stage 정격(`RATE_TBD` 해제 시)
- 15% reserve 정책
- WPH 가정(`M20_MODELED_RATE_VALUES`) 자체를 Fab별로 분리할 필요가 생기는 경우
