# Fab Equipment Master — Fab별 표준 설비 대수

| Fab | 상태 | 버전 |
|---|---|---|
| M20 | `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE` | `FAB_EQUIPMENT_MASTER_M20_V4` |
| M21 | `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE` | `FAB_EQUIPMENT_MASTER_M21_V2` |
| M22 | `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE` | `FAB_EQUIPMENT_MASTER_M22_V2` |

기준일: 2026-07-22

## 1. Fab별 설비 정의

이 문서는 M20·M21·M22의 **표준 설비 대수**를 정의하는 단일 기준 문서다. 설비 대수는 실제 구매·설치 완료 수량이 아니라 시스템이 생산계획과 장비 밀도를 계산할 때 사용하는 `modeled tool-equivalent`다.

| Fab | 기준 제품 | 기준 생산량 | NORMAL 목표 여유 | 표준 설비 대수 | 상태 |
|---|---|---:|---:|---:|---|
| M20 | HBM4 12-Hi 36GB | 117,000 WSPM | 병목 ≥15% · 비병목 ≥25% | **329대** | `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE` |
| M21 | DDR5 16Gb | 184,000 WSPM | 병목 ≥15% · 비병목 ≥25% | **872대** | `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE` |
| M22 | NAND 321단 1Tb TLC | 108,000 WSPM | 병목 ≥15% · 비병목 ≥25% | **639대** | `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE` |

M21·M22는 M20의 대수나 비율을 복사하지 않고, [`route-master.md`](./route-master.md)가 확정한 각자의 공정 방문수(pass count)와 [`fab-master.md`](./fab-master.md)가 확정한 각자의 NORMAL WSPM으로 M20과 **동일한 WPH_PROXY 계산 방법론**(`src/lib/m20-equipment-capacity-plan.ts`의 `modeledOeeForSequence`/`supportedWspm` 공식, `src/lib/equipment-wph-model.ts`의 `minimumDefinedCount`/`resolveTargetLoad`)을 독립 적용해 도출했다.

**V4부터는 3팹 모두 같은 대수 산정 기준을 쓴다.** 이전에는 M20만 기존 설치 대수(`previousCount`)를 하한으로 두고 부족분만 올림해서, 병목이 아닌 공정 중 일부(P09 7.3%, P08 15.8%, P06 18.9%)가 변동성 완충이 아니라 사실상 놀리는 수준까지 대수가 남았다. M21·M22는 반대로 하한이 없어 전 공정이 85% 근처에 몰렸다 — `minimumDefinedCount`가 상한까지 채우는 최소 대수를 구하는 함수라, 상한을 하나만 쓰면 병목이든 아니든 전부 그 상한에 붙기 때문이다. V4는 `previousCount` 하한을 완전히 없애고, 3팹 공통으로 **공정별 wafer당 방문수(`capacityPassesPerWafer`)가 그 Fab에서 가장 많은 공정만 병목으로 보고 85%까지, 나머지는 25% 이상 여유(≤75%)를 갖도록** 다시 계산한다(`resolveTargetLoad`). PM·돌발 다운·수율 재작업을 흡수하는 protective capacity를 병목이 아닌 공정에도 남기는 표준 fab capacity planning 관행(TOC 병목 관리)을 따른 것이다.

## 2. 설비 여유 계약

3팹 공통으로 병목 공정은 NORMAL 운전에서 유효 Capacity의 최소 15%를, 병목이 아닌 공정은 최소 25%를 비워 두는 것으로 정의한다. 85%(병목)는 특정 Fab들의 실측 평균이라는 뜻이 아니라 장기 80% 초과·고수요기 90~100% 사이에서 선택한 모델 기준이고([SIA](https://www.semiconductors.org/wp-content/uploads/2021/06/SIA-Final-submission-to-FCC-on-Impact-of-Global-Semiconductor-Shortage-on-the-U.S.-Communications-Sector-June-10-2021.pdf)), 75%(비병목)는 그 상한보다 낮춰 변동성을 흡수할 여유를 남기는 protective capacity 기준이다.

```text
병목 공정 최대 계획 부하율 = 1 - 0.15 = 85%
비병목 공정 목표 계획 부하율 = 1 - 0.25 = 75%
```

한 Fab에서 wafer당 방문수(`capacityPassesPerWafer`)가 가장 많은 공정(들)만 병목으로 분류한다 — HBM·DRAM(M20·M21)은 Photo·Etch·CVD·CMP가 같은 27회 반복 루프를 공유해 4개 공정이 함께 병목이 되고, NAND(M22)는 321단 적층 증착(162회) 하나가 압도적으로 커서 CVD(P02) 단독 병목이 된다. 장비는 정수 단위로 올림하므로 실제 부하율은 목표(85%/75%)에 근접하되 그 이하로 유지된다.

---

## M20 표준 설비 대수

V4에서 `previousCount`(V2 시절 기설치 대수 기록, 아래 "V2 기준" 열)는 더 이상 대수의 하한이 아니다 — 병목 공정(P02·P03·P04·P07, wafer당 27회 방문으로 동률 최다)은 85%까지, 나머지는 75%까지 채우는 최소 대수로 다시 계산했다.

| 공정 | 대표 공정 | 표준 대수 | V2 기준 | 변경 | 계획 부하 | Capacity 상태 |
|---|---|---:|---:|---:|---:|---|
| P01 | 산화 | **9** | 32 | -23 | 73.7% | `WPH_PROXY` |
| P02 | CVD | **58** | 48 | +10 | 84.3% | `WPH_PROXY · 병목` |
| P03 | 포토 | **66** | 64 | +2 | 84.6% | `WPH_PROXY · 병목` |
| P04 | 식각 | **56** | 72 | -16 | 84.8% | `WPH_PROXY · 병목` |
| P05 | 이온주입 | **13** | 24 | -11 | 73.3% | `WPH_PROXY · 6 PASS/WAFER` |
| P06 | 금속배선 | **13** | 48 | -35 | 69.8% | `WPH_PROXY` |
| P07 | CMP | **62** | 32 | +30 | 84.5% | `WPH_PROXY · 병목` |
| P08 | TSV·박막화 | **12** | 56 | -44 | 74.0% | `WPH_PROXY · 4 PASS/WAFER` |
| P09 | 웨이퍼 테스트 | **4** | 40 | -36 | 74.0% | `WPH_PROXY` |
| P10 | 패키징(Singulation·Die Prep·HBM 조립·최종검사) | **36** | 36 | - | 83.9% | `NATIVE_STAGE_PROXY` |
| 합계 |  | **329** | **452** | **-123** | 병목 P04 84.8% | `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE` |

공정별 대수와 총대수는 `src/lib/m20-equipment-capacity-plan.ts`의 `M20_DEFINED_EQUIPMENT_COUNTS`와 항상 일치해야 한다. P02·P03·P04·P07은 대수가 같은 27-pass 반복 루프를 공유해 넷 다 84~85%대로 붙지만, 그 중 공급 WPH가 가장 낮아 대수당 지원 WSPM이 제일 작은 P04가 대표 병목(`bottleneckProcessCode`)으로 표시된다.

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

| 시나리오 | WSPM | 병목 공정 | 병목 부하율 | 남는 Capacity | 판정 |
|---|---:|---:|---:|---:|---|
| `NORMAL` | 117,000 | P04 | 약 84.8% | 약 15.2% | 15% reserve 충족 |
| `UPLIFT` | 123,500 | P04 | 약 89.6% | 약 10.4% | 단기 증산 |
| `NAMEPLATE` | 130,000 | P04 | 약 94.3% | 약 5.7% | 스트레스 운전 |
| `EXPANSION` | 143,000 | P04 | 약 103.7% | 부족 | 별도 증설 필요 |

---

## M21 표준 설비 대수

M21은 P08(TSV) 전 공정이 없고, P09는 1회(EDS)만 필요하다([`route-master.md`](./route-master.md#m21--dram)). NORMAL 184,000 WSPM(M16급 실측 규모 근거, [`fab-master.md`](./fab-master.md#m21--dram) 참고)과 M21의 route pass count로 M20과 동일한 WPH_PROXY 공식을, V4의 병목/비병목 목표 부하 기준(§ 1·2)으로 새로 적용했다.

| 공정 | 대표 공정 | Route pass/wafer | 표준 대수 | 계획 부하 | Capacity 상태 |
|---|---|---:|---:|---:|---|
| P01 | 산화 | 4 | **14** | 74.3% | `WPH_PROXY` |
| P02 | CVD | 27 | **91** | 84.5% | `WPH_PROXY · 병목` |
| P03 | 포토 | 27 | **104** | 84.3% | `WPH_PROXY · 병목` |
| P04 | 식각 | 27 | **88** | 84.9% | `WPH_PROXY · 병목` |
| P05 | 이온주입 | 6(M20과 동일 가정) | **20** | 74.9% | `WPH_PROXY · 6 PASS/WAFER` |
| P06 | 금속배선 | 5 | **20** | 71.3% | `WPH_PROXY` |
| P07 | CMP | 27 | **97** | 84.9% | `WPH_PROXY · 병목` |
| P09 | 웨이퍼 테스트 | 1(적층 없어 재검 불필요) | **4** | 58.2% | `WPH_PROXY` |
| P10 | Conventional 단일 다이 패키징 | — | **434** | 84.7%(내부 병목 Molding) | `NATIVE_STAGE_PROXY` |
| 합계 |  |  | **872** |  | `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE` |

P01~P07·P09는 M20과 동일한 `ratedWph`(P01=115, P02=105, P03=92, P04=108, P05=120, P06=105, P07=98, P09=130 wafer/hour)를 재사용한다 — DRAM 프런트엔드가 HBM과 같은 물리 공정·장비군을 쓴다는 근거([Applied Materials](https://www.appliedmaterials.com/us/en/newsroom/blogs/hbm--materials-innovation-propels-high-bandwidth-memory-into-the.html))에 따른 것이며, 대수 자체는 M21 고유의 WSPM·pass count에서 새로 계산한 결과다. P02·P03·P04·P07(27-pass 동률)이 병목이고 나머지는 75% 목표 부하로 계산해, P09는 wafer당 방문이 1회뿐이라 정수 대수 특성상 74.9%가 아닌 58.2%까지 내려간다(4대에서 3대로만 줄여도 이미 75%를 넘어서기 때문 — 정수 올림의 불가피한 결과다).

**총 대수(872대)가 M20(329대)보다 많은 이유**: M21의 WSPM(184,000)은 M20(117,000)보다 57% 크다. P08(TSV) 공정군이 통째로 없고 P09도 절반(pass 1 vs 2)이라 P01~P09 wafer당 필요 설비는 M20보다 적지만, P10이 M20처럼 적층으로 수량을 줄이지 않고 wafer 1장당 743.8개 단일 패키지를 그대로 만들어내는 SDP라(§ P10 참고) 후공정 조립·테스트 대수가 훨씬 크다.

### P10 Conventional Packaging Capacity 계약

M21의 P10은 M20처럼 다이 적층(Bonding)이 아니라 리드프레임/기판 실장이라 설비 카테고리 자체가 다르다([SK hynix Newsroom](https://news.skhynix.com/semiconductor-back-end-process-episode-6-conventional-packages/)). Driver는 [`fab-master.md`](./fab-master.md#m21--dram) § DRAM 완제품 환산의 wafer당 759 양품 die · 743.8 양품 package를 그대로 쓴다. **Final Test만 공개 문헌으로 뒷받침되고, 나머지 6단계(Backgrind·Dicing·Die Attach·Wire Bond·Molding·Lead Finish)는 vendor spec이 아닌 반도체 조립·테스트 업계 통상 처리량 범위 추정**(`INDUSTRY_RANGE_INFORMED_MODELED_BASELINE`)이다 — 실제 vendor spec 확보 시 대수가 달라질 수 있다.

| 단계 | 처리 단위 | 정격(추정) | wafer당 driver | 대수 | 계획 부하 |
|---|---|---:|---:|---:|---:|
| Backgrind(단일-패스) | wafer/hour | 45 | 1 wafer | 8 | 83.0% |
| Dicing / Singulation | wafer/hour | 38(M20과 동일 가정) | 1 wafer | 10 | 78.7% |
| Die Attach | die/hour | 4,000 | 759 die | 67 | 84.6% |
| Wire Bond | die/hour | 6,000 | 759 die | 45 | 84.0% |
| Molding | package/hour | 2,500 | 743.8 package | 105 | 84.7% |
| Lead Finish / Ball Mount | package/hour | 5,000 | 743.8 package | 53 | 83.9% |
| Final Test | package/hour | 1,800([CS MANTECH 2018](https://csmantech.org/wp-content/acfrcwduploads/field_5e8cddf5ddd10/post_4597/011.3.pdf) Table I, 1초 test time·60% OEE 기준 practical UPH) | 743.8 package | 146 | 84.6% |
| 합계 |  |  |  | **434** | 내부 병목: Molding |

### M21 생산 시나리오 적용

| 시나리오 | WSPM | 병목 공정 | 병목 부하율(P01~P09 기준) | 판정 |
|---|---:|---:|---:|---|
| `NORMAL` | 184,000 | P04·P07 | 약 84.9% | 15% reserve 충족 |
| `UPLIFT` | 192,000 | P04·P07 | 약 88.6% | 단기 증산 |
| `NAMEPLATE` | 200,000 | P04·P07 | 약 92.3% | 스트레스 운전 |
| `EXPANSION` | 220,000 | P04·P07 | 약 101.5% | 별도 증설 필요 |

---

## M22 표준 설비 대수

M22는 321단 3-deck NAND의 route pass count(`route-master.md` 참고)가 반영되어 P02(CVD)가 압도적으로 많다. NORMAL 108,000 WSPM(NAND 단일 라인 실측 규모, [`fab-master.md`](./fab-master.md#m22--nand) 참고) 기준, V4의 병목/비병목 목표 부하 기준(§ 1·2)으로 계산했다. M22는 P02(162 pass/wafer)가 다른 공정(최대 30)과 격차가 커서, M20·M21과 달리 병목이 P02 단독이다.

| 공정 | 대표 공정 | Route pass/wafer | 표준 대수 | 계획 부하 | Capacity 상태 |
|---|---|---:|---:|---:|---|
| P01 | 산화(주변 CMOS) | 3 | **7** | 65.0% | `WPH_PROXY` |
| P02 | CVD(스택 증착 161 + ONO 1) | 162 | **319** | 84.8% | `WPH_PROXY · 병목` |
| P03 | 포토(주변 3 + Staircase 21) | 24 | **62** | 73.8% | `WPH_PROXY` |
| P04 | 식각(주변 3 + 채널홀 3 + Staircase 21 + 게이트치환 3) | 30 | **66** | 73.9% | `WPH_PROXY` |
| P05 | 이온주입(주변 CMOS) | 3 | **6** | 73.1% | `WPH_PROXY · M20 동일 가정 재사용` |
| P06 | 금속배선(주변 3 + 게이트치환 텅스텐 3) | 6 | **14** | 71.6% | `WPH_PROXY` |
| P07 | CMP(주변 3 + 평탄화 7) | 10 | **24** | 74.6% | `WPH_PROXY` |
| P09 | 웨이퍼 테스트 | 1 | **2** | 69.1% | `WPH_PROXY` |
| P10 | 16단 와이어본딩 패키징 | — | **139** | 84.9%(내부 병목 Wire Bond) | `NATIVE_STAGE_PROXY` |
| 합계 |  |  | **639** |  | `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE` |

P01~P07·P09는 M20과 동일한 `ratedWph`를 재사용하되(동일 세대 장비 기술이라는 가정), pass count는 M22의 route-master.md 표(§ M22 · NAND)에서 그대로 가져왔다. **P01~P09만 보면 M22 총 대수(500)가 M20(293)보다 많다** — M22의 NORMAL WSPM(108,000)은 M20(117,000)보다 낮지만 P02 대수는 M20 병목 공정(P04 56대)의 5배가 넘는 319대다. 이는 321단 적층으로 인한 CVD 반복 방문수(162 pass/wafer)가 다른 어떤 공정보다도 압도적으로 크기 때문이며, NAND Fab이 DRAM/HBM Fab보다 wafer당 장비 시간을 훨씬 많이 소비한다는 업계 통설과 일치한다([Lam Research](https://newsroom.lamresearch.com/learning-from-nand-3d-dram-transition-ai-era)). P10까지 합친 전체 총 대수(639)는 M21(872)보다 적은데, M22는 16단 적층으로 패키지 수가 wafer당 74.94개까지 줄어드는 반면 M21은 적층 없는 SDP라 wafer당 743.8개 패키지를 그대로 조립·테스트해야 하기 때문이다(§ P10 참고).

### P10 와이어본딩 패키징 Capacity 계약

M21과 동일한 이유로 wire bonder 등의 공개 UPH를 확보하지 못했다. Driver는 [`fab-master.md`](./fab-master.md#m22--nand) § NAND 완제품 환산의 wafer당 1,249 양품 die · 74.94 양품 16-die stack package를 그대로 쓴다. **Final Test만 공개 문헌으로 뒷받침되고, 나머지 6단계는 vendor spec이 아닌 반도체 조립·테스트 업계 통상 처리량 범위 추정**(`INDUSTRY_RANGE_INFORMED_MODELED_BASELINE`)이다 — 실제 vendor spec 확보 시 대수가 달라질 수 있다. Die Attach·Wire Bond는 16단 적층이라 다이 단위(층마다 개별 attach·bond)로, Molding·Lead Finish·Final Test는 완성 스택 단위로 계산했다.

| 단계 | 처리 단위 | 정격(추정) | wafer당 driver | 대수 | 계획 부하 |
|---|---|---:|---:|---:|---:|
| Backgrind | wafer/hour | 45 | 1 wafer | 5 | 78.0% |
| Dicing / Singulation | wafer/hour | 38(M20과 동일 가정) | 1 wafer | 6 | 76.9% |
| Die Attach | die/hour | 4,000 | 1,249 die | 65 | 84.3% |
| Wire Bond(16단 적층) | die/hour | 6,000 | 1,249 die | 43 | 84.9% |
| Molding | package/hour | 2,500 | 74.94 package | 7 | 75.1% |
| Lead Finish / Ball Mount | package/hour | 5,000 | 74.94 package | 4 | 65.7% |
| Final Test | package/hour | 1,800([CS MANTECH 2018](https://csmantech.org/wp-content/acfrcwduploads/field_5e8cddf5ddd10/post_4597/011.3.pdf) Table I, 1초 test time·60% OEE 기준 practical UPH) | 74.94 package | 9 | 81.2% |
| 합계 |  |  |  | **139** | 내부 병목: Wire Bond |

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
- P10은 Fab마다 native capacity 구성이 다르다: M20은 wafer/KGD/die-placement/stack 단위 5-stage, M21·M22는 conventional/와이어본딩 패키징 7-stage로 구성이 전혀 다르다. M21·M22의 P10은 Final Test를 제외한 6단계가 vendor spec이 아닌 업계 통상 처리량 범위 추정이라 실제 vendor 확보 시 대수가 달라질 수 있다.
- 따라서 329대(M20)·872대(M21)·639대(M22)는 모두 `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE`이며 실제 MES 정격·qualification을 반영한 `REAL_CAPACITY_VALIDATED`가 아니다.

## 4. 원장 반영 규칙

- M20 `equipmentMaster`는 공정별 표준 대수까지 부족한 deterministic ID만 추가한다.
- 기존 장비의 status, OEE, 위치, 배정 이력과 `MES_MASTER` 행은 덮어쓰지 않는다.
- 원장 대수가 표준보다 많으면 장비를 삭제하지 않고 마이그레이션을 중단해 검토한다.
- 같은 마이그레이션을 다시 실행했을 때 추가 대수는 0이어야 한다.
- **예외: V4 재계산으로 M20의 일부 공정 표준 대수가 실제로 줄었다(§ M20 표준 설비 대수의 "변경" 열이 음수인 행).** 이런 대수 축소는 통상적인 마이그레이션이 아니라 `scripts/trim-m20-equipment-master.ts`라는 일회성 스크립트로만 처리한다 — `equipmentAssignments`가 참조 중인 장비는 절대 지우지 않고, 삭제 전 전체 스냅샷을 남기며, 하나라도 참조 중이면 전체를 중단한다.

## 5. 연결 기준

- [`fab-master.md`](./fab-master.md): Fab별 WSPM·WIP·생산 시나리오
- [`route-master.md`](./route-master.md): 제품 Route와 공정 반복 정의
- [`material-consumption-master.md`](./material-consumption-master.md): wafer당 자재 원단위
- `src/lib/m20-equipment-capacity-plan.ts`: M20 329대와 병목/비병목 reserve 계산 계약
- `src/lib/equipment-wph-model.ts`: `modeledOeeForSequence`/`supportedWspm`/`minimumDefinedCount`/`resolveTargetLoad`(P01~P09 WPH_PROXY) · `nativeStageSupportedWspm`/`minimumNativeStageCount`(P10 native-stage) — 3팹이 공유하는 공식
- `scripts/migrate-m20-equipment-master.ts`: 기존 장비를 보존하는 M20 설비 원장 증설(삭제 없음)
- `scripts/trim-m20-equipment-master.ts`: V4 재계산으로 줄어든 공정의 초과분만 안전하게 삭제하는 일회성 스크립트
- `scripts/migrate-m21-equipment-master.ts`, `scripts/migrate-m22-equipment-master.ts`: M21·M22 설비 원장 증설(삭제 없음)

## 6. 변경 관리

다음 값이 바뀌면 해당 Fab의 버전을 올리고 파생값을 모두 재생성한다.

- NORMAL WSPM 또는 Route pass count
- P10 native-stage 정격(현재 Final Test 외 6단계는 INDUSTRY_RANGE_INFORMED 추정 — 실제 vendor spec 확보 시)
- 병목 15% reserve · 비병목 25% reserve 정책 또는 병목 판정 기준(`capacityPassesPerWafer` 최댓값)
- WPH 가정(`M20_MODELED_RATE_VALUES`) 자체를 Fab별로 분리할 필요가 생기는 경우
