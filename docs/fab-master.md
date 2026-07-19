# Fab Production Master — M20 생산능력 · WIP · 증산 경계

상태: `APPROVED_MODELED_BASELINE`  
버전: `FAB_MASTER_M20_V1`  
기준일: 2026-07-19

## 1. 문서 목적

이 문서는 M20이 **평균적으로 얼마나 생산하고, 정상 상태에서 얼마의 WIP를 유지하며, 어떤 증산 시나리오를 계획하는지**를 정의하는 생산 규모의 기준 문서다. 각 시나리오를 현재 설비가 실제로 지원하는지는 별도 Equipment Capacity Master에서 판정한다.

- [`route-master.md`](./route-master.md): 웨이퍼가 어떤 공정을 몇 번 통과하는가
- 이 문서: M20이 얼마나 투입·생산하고 어느 정도 WIP를 보유하는가
- [`foup-wip-master.md`](./foup-wip-master.md): 16,380 FOUP-equivalent를 Occupied FOUP·Physical Fleet·후공정 WIP로 분리
- [`fab-equipment-master.md`](./fab-equipment-master.md): Fab별 표준 설비 대수와 NORMAL 15% reserve
- [`material-consumption-master.md`](./material-consumption-master.md): 웨이퍼 1장에 어떤 자재가 얼마나 필요한가

이 다섯 문서의 값이 충돌하면 임의로 숫자를 맞추지 않는다. 생산 규모는 이 문서, 공정 방문수는 `route-master.md`, FOUP·Carrier 수량은 `foup-wip-master.md`, 설비 대수는 `fab-equipment-master.md`, 자재 원단위는 `material-consumption-master.md`를 각각 단일 기준으로 사용한다.

## 2. 사실과 가정의 경계

### 공개자료로 확인되는 범위

- SK hynix M16은 EUV 장비를 도입한 1a nm DRAM 생산 거점으로 공개되었다.
- HBM용 웨이퍼는 일반 DRAM의 700개 이상 공정 스텝을 공유하고 TSV, 범프, 박화, 적층 관련 공정이 추가된다.
- 업계 자료에서 웨이퍼 제조 사이클은 평균 약 12주, 첨단 공정은 약 14~20주까지로 설명된다.
- Fab 가동률 80% 초과는 높은 가동 구간이며 개별 Fab은 수요기에 90~100%까지 운전할 수 있다.

### 이 시스템이 채택한 가정

M20의 실제 설치 캐파, 제품 믹스, 수율, 사이클타임은 공개자료만으로 확정할 수 없다. 따라서 아래 값은 SK hynix의 실제 내부 생산계획을 재현한 수치가 아니라 시스템 전체 계산을 일관되게 만들기 위한 `MODELED_BASELINE`이다.

| 항목 | M20 V1 가정 | 의미 |
|---|---:|---|
| Fab | M20 | M16을 참고한 가상 HBM Fab |
| 기준 생산품 | `M20-HBM4-12H-V1` | DRAM base die + TSV + HBM4 12-Hi 36GB 계획 모델 |
| 웨이퍼 직경 | 300 mm | WSPM과 FOUP 환산 기준 |
| 명목 생산능력 | 130,000 WSPM | 생산계획상 스트레스 상한. 설비 지원은 미검증 |
| 평균 가동률 | 90% | NORMAL 운영 기준 |
| 평균 운영 투입량 | 117,000 WSPM | 평상시 월 wafer starts |
| 일평균 투입량 | 3,900 wafer/day | 30일 연속운전 기준 |
| 웨이퍼 수율 | 85% | 양품 wafer-equivalent 계산용 전역 가정 |
| 평균 유효 산출 | 99,450 good wafer-eq/month | 자재 투입량 계산에는 사용하지 않음 |
| Gross die/wafer | 765 dies | die 면적·edge loss를 단순화한 HBM4 참조값 |
| KGD/wafer | 650 known-good dies | die 수율·TSV test를 합친 완제품 환산값 |
| HBM 적층수 | 12 DRAM dies/stack | `M20-HBM4-12H-V1`; base die는 별도 미모델 |
| 적층·조립수율 | 90% | stack assembly 모델 가정 |
| FOUP 적재량 | 25 wafers/FOUP | WIP 환산 기준 |
| NORMAL 사이클타임 | 105일 | 프런트엔드부터 HBM 후공정까지의 모델 평균 |
| NORMAL 목표 WIP | 16,380 FOUP-equivalent | 평균 투입량과 105일 기준 Little's Law 결과 |

`WSPM`은 HBM 완제품 개수가 아니라 **한 달에 공정에 투입하는 300 mm 웨이퍼 수**다. `130,000 WSPM`을 HBM 13만 개로 읽으면 안 된다.

## 3. 평균 운영점과 생산량

M20 V1의 기본 운영점은 명목 상한 130K가 아니라 **117K WSPM**이다.

```text
평균 운영 WSPM = 명목 WSPM × 평균 가동률
                 = 130,000 × 0.90
                 = 117,000 wafer starts/month

일평균 wafer starts = 117,000 ÷ 30 = 3,900 wafers/day
일평균 FOUP starts  = 3,900 ÷ 25 = 156 FOUP/day
유효 wafer 산출     = 117,000 × 0.85 = 99,450 good wafer-equivalent/month
```

수율은 양품 환산과 완제품 산출 계산에 적용한다. 가스, 케미컬, PR처럼 공정에 먼저 투입되는 자재는 불량이 나중에 판정되더라도 이미 소비되므로 기본 소요량은 `good wafer`가 아니라 `wafer starts`에서 계산한다.

## 4. 정상 WIP 정의

정상 WIP는 Little's Law를 FOUP 단위로 환산한다.

```text
목표 WIP(FOUP-equivalent)
  = 월 wafer starts ÷ 30일 × cycleTimeDays ÷ 25 wafers/FOUP

NORMAL
  = 117,000 ÷ 30 × 105 ÷ 25
  = 16,380 FOUP-equivalent
  = 409,500 wafers in process
```

`16,380 FOUP-equivalent`는 105일 전체 Route WIP의 25-wafer release-lot 환산값이며 실물 FOUP 보유량이 아니다. Wafer/FOUP 90일과 후공정 15일의 초안 분리, Occupied FOUP 14,040대와 계획 Physical Fleet 15,600대의 정의는 [`foup-wip-master.md`](./foup-wip-master.md)를 따른다.

운영 화면에서 정상 WIP의 목표 밴드는 중심값의 ±5%로 둔다.

| 상태 | FOUP-equivalent | 판정 |
|---|---:|---|
| 하한 미만 | < 15,561 | 투입 부족 또는 과도한 공정 배출 |
| 정상 밴드 | 15,561~17,199 | NORMAL 안정 운영 |
| 상한 초과 | > 17,199 | 큐잉·병목·사이클타임 증가 점검 |

이 밴드는 품질 규격이 아니라 운영 경보 기준이다. 공정별 WIP 분포는 향후 노드별 체류시간 마스터가 생기기 전까지 균등 분포를 가정한다.

## 5. 증산 시나리오와 커버 가능 범위

증산은 WSPM만 올리는 문제가 아니다. 가동률이 높아질수록 대기열과 재진입 공정의 간섭으로 사이클타임이 늘 수 있으므로 `waferStarts`, `utilization`, `cycleTimeDays`를 독립 변수로 관리한다.

| 시나리오 | 월 투입 WSPM | 현재 명목 대비 가동률 | NORMAL 대비 | 105일 고정 참조 WIP(FOUP-eq) | 계획 cycle time | 계획 WIP(FOUP-eq) | HBM4 12-Hi 36GB/월 | 운영 판정 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `NORMAL` | 117,000 | 90% | 기준 | 16,380 | 105일 | 16,380 | 5,703,750 | 평균 운영 기준 |
| `UPLIFT` | 123,500 | 95% | +5.6% | 17,290 | 112일 | 18,443 | 6,020,625 | 단기 증산 계획, 설비 미검증 |
| `NAMEPLATE` | 130,000 | 100% | +11.1% | 18,200 | 126일 | 21,840 | 스트레스 계획, 설비 미검증 |
| `EXPANSION` | 143,000 | 현 명목의 110% | +22.2% | 20,020 | 105일 | 20,020 | 6,971,250 | 디보틀넥·설비증설 후 미래 상태 |

### 해석 규칙

- `UPLIFT` 123.5K WSPM은 NORMAL 대비 5.6%의 **단기 증산 계획 시나리오**다. M20 494대 정의에서는 모델 병목 부하 약 89.3%다.
- 130K는 생산계획상의 이름표·스트레스 상한이다. 현 설비가 도달할 수 있다고 검증된 값이 아니며 100% 가동과 105일 사이클을 동시에 지속할 수 있다고 가정하지 않는다.
- 143K는 현재 설비로 가능한 생산량이 아니다. 병목 장비 증설, PM 전략 변경, 물류·유틸리티 증강이 완료된 뒤의 미래 비교 시나리오다.
- 105일 고정 참조 WIP는 생산량만 비교하기 위한 값이다. 자재·창고·라인사이드 검토에는 `계획 WIP`를 사용한다.
- 실제 설비 신호와 MES cycle time이 연결되면 계획 cycle time을 실측 이동평균으로 교체한다.

설비 대수는 [`fab-equipment-master.md`](./fab-equipment-master.md)를 따른다. M20은 공개 업계 운전범위를 참고한 NORMAL 15% reserve 기준 **494 modeled tools**로 정의됐다. P10 Packaging 36대의 5개 native-stage 부하는 모델링됐지만 Base Die Attach와 실제 MES 정격 검증 전까지 `REAL_CAPACITY_VALIDATED`로 표시하지 않는다.

계획 cycle time 112일과 126일은 고가동 큐잉 위험을 보수적으로 드러내기 위한 M20 V1 가정이다. 공개된 M20 실측값이 아니며 시뮬레이션 결과로 자동 보정되기 전까지 `MODELED_BASELINE`으로 표시한다.

## 6. 시나리오 계산 계약

모든 생산·자재 시나리오는 다음 필드를 가진다.

| 필드 | 단위 | 설명 |
|---|---|---|
| `scenarioId` | enum | `NORMAL`, `UPLIFT`, `NAMEPLATE`, `EXPANSION` |
| `waferStartsPerMonth` | wafer/month | 시나리오의 직접 입력값 |
| `utilization` | ratio | 현 명목 130K 대비 가동률. EXPANSION은 비교값 1.10 |
| `cycleTimeDays` | day | WIP 계산용 독립 입력값 |
| `waferYield` | ratio | 양품 wafer-equivalent 계산용 |
| `wafersPerFoup` | wafer/FOUP | 현재 25 |
| `productMix` | ratio map | 12-Hi/16-Hi 등 제품 믹스. V1은 HBM4 12-Hi 100% |

NORMAL 대비 선형 자재의 수요 배율은 다음과 같다.

| 시나리오 | 수요 배율 `WSPM ÷ 117,000` |
|---|---:|
| NORMAL | 1.0000 |
| UPLIFT | 1.0556 |
| NAMEPLATE | 1.1111 |
| EXPANSION | 1.2222 |

이 배율은 가스·케미컬처럼 처리 wafer에 대체로 비례하는 자재에만 직접 적용한다. Probe Card, CMP Pad, PVD Target 같은 교체성 자재는 수명 임계치에 따라 정수 단위로 올림하고, 패키징 자재는 KGD·스택 수율과 제품 믹스를 추가 적용한다.

## 7. HBM 완제품 환산

`117,000 WSPM`은 HBM4 117,000개가 아니다. 한 장의 300 mm wafer에서 여러 DRAM die를 만들고, 양품 die 12개를 적층해야 HBM4 12-Hi stack 하나가 된다.

### wafer 1장 기준 환산

| 단계 | 계산 | wafer 1장당 결과 |
|---|---:|---:|
| Gross DRAM die | die 면적·edge loss 모델 | 765 dies |
| 양품 DRAM die(KGD) | gross die에서 die·TSV test 손실 반영 | 650 good dies |
| KGD 환산수율 | 650 ÷ 765 | 약 85.0% |
| 이론 HBM4 12-Hi 36GB stack | 650 ÷ 12 DRAM dies | 약 54.167 stacks |
| 양품 HBM4 12-Hi 36GB | 54.167 × 적층·조립수율 90% | **48.75 stacks/wafer** |

따라서 M20 V1은 **wafer 1장당 평균 양품 DRAM die 650개, 최종 양품 HBM4 12-Hi 36GB 48.75개**를 생산하는 것으로 가정한다. 소수점은 Fab 전체에서 평균화된 기대값이며 실제 wafer 한 장에서 HBM4 0.75개를 물리적으로 만든다는 뜻이 아니다.

```text
known-good dies/month
  = wafer starts × knownGoodDiesPerWafer

HBM stacks/month
  = known-good dies/month ÷ DRAM dies/stack × assembly yield

NORMAL HBM4 12-Hi stacks/month
  = 117,000 wafer × 48.75 good stacks/wafer
  = 117,000 × 650 ÷ 12 × 0.90
  = 5,703,750 stacks/month

NORMAL HBM4 12-Hi 36GB capacity/month
  = 5,703,750 stacks × 36 GB/stack
  = 205,335,000 GB/month
  = 205.335 PB/month (decimal)
```

따라서 M20 NORMAL 117K의 계획 월 생산량은 **HBM4 12-Hi 36GB 5,703,750개**, 총 메모리 용량은 **205.335 PB/월**이다. PB는 `1 PB = 1,000,000 GB`인 10진 단위다.

이 수량은 105일 생산 파이프라인이 이미 채워진 정상상태의 월 throughput이다. 첫 wafer start 직후 같은 달에 완제품이 나온다는 뜻이 아니다.

Gross 765 dies/wafer, KGD 650 dies/wafer, assembly yield 90%는 모두 `MODELED_BASELINE`이다. 12개는 용량을 구성하는 24Gb(3GB) DRAM die 수이며 HBM4 base die의 별도 공급·수율·Capacity는 이 산식에 포함하지 않았다. 실제 die map, edge exclusion, wafer sort, TSV test, 적층수율이 들어오면 교체한다. 그 전까지 화면에서는 `계획 HBM4 12-Hi 36GB stack 환산`이라고 표시하며 실제 출하량으로 부르지 않는다.

16-Hi 또는 다른 용량 제품은 별도 `modelProduct`로 추가하며 12-Hi의 생산량이나 패키징 소재 원단위를 단순 비례시키지 않는다. die 면적, KGD/wafer, TSV 수율, 적층수율, NCF·EMC 구조를 별도로 가진다.

## 8. M21·M22 처리

| Fab | 상태 | 규칙 |
|---|---|---|
| M20 | `MODELED_BASELINE` | 이 문서의 V1 값을 사용 |
| M21 | `TBD / NOT_MODELED` | 현재 코드 숫자를 실제 생산능력으로 해석하지 않음 |
| M22 | `TBD / NOT_MODELED` | 현재 코드 숫자를 실제 생산능력으로 해석하지 않음 |

M21·M22가 추가될 때 같은 필드와 공식은 재사용하되 M20의 WSPM, 수율, cycle time 또는 자재 원단위를 복사하지 않는다.

## 9. 현재 구현 상태

이 문서는 M20 생산 정의의 최신 기준이며 코드와 DB 연결도 같은 버전을 사용한다.

- 생산 기준: M20 NORMAL 117K / 명목 130K / 정상 WIP 16,380 FOUP-equivalent
- 설비 기준: M20 494대 `FAB_EQUIPMENT_MASTER_M20_V3`; NORMAL 15% reserve, `INDUSTRY_RANGE_INFORMED_MODELED_BASELINE`
- Route 기준: `M20:HBM:V3` / P10 Packaging 내부 Singulation 2 operation·Base Attach·DRAM Bond 12회·MUF·Final Test / 총 140 모델 스텝
- 실행 모델: 12개 VISUAL 로트는 전체 WIP 안의 추적 표본이며, AGGREGATE 로트와 합쳐 목표 FOUP-equivalent를 표현
- 조회 API: 읽기 전용이며, WIP 보정·진행은 명시적인 POST 작업으로 분리
- 자재 기준: wafer당 원단위 마스터에서 시나리오 월소요량을 파생
- 금지: 기존 HBM 월사용량을 일괄 2.6배 하거나 FOUP-equivalent를 실물 FOUP 보유량으로 해석하는 것

## 10. 변경 관리

다음 값이 바뀌면 `FAB_MASTER_M20_V2`로 올리고 파생값을 모두 재생성한다.

- 명목 WSPM 또는 평균 가동률
- NORMAL/UPLIFT/NAMEPLATE/EXPANSION 경계
- cycle time 또는 FOUP 적재량
- wafer yield 또는 기준 HBM 제품
- Route Master의 반복수와 공정 분기

실측 MES 값이 들어오면 가정보다 우선하지만 과거 시나리오 재현을 위해 V1 문서는 삭제하지 않는다.

## 11. 공개 근거

- [SK hynix — M16 Plant Construction Completion](https://news.skhynix.com/sk-hynix-announces-the-completion-of-m16-plant-construction/) — M16의 EUV 도입과 1a nm DRAM 생산 역할
- [Applied Materials — Wafer Fab Equipment Market Briefing, HBM Materials Engineering](https://ir.appliedmaterials.com/static-files/2f334f9c-6170-42ed-98b5-24dc11d946e9) — DRAM 700+ 스텝과 HBM TSV·범프 추가 공정
- [SIA — Impact of Global Semiconductor Shortage](https://www.semiconductors.org/wp-content/uploads/2021/06/SIA-Final-submission-to-FCC-on-Impact-of-Global-Semiconductor-Shortage-on-the-U.S.-Communications-Sector-June-10-2021.pdf) — 80% 초과 고가동, 90~100% 사례, 평균 12주·첨단 14~20주 cycle time
- [SEMI — 2026 300 mm Memory Capacity Outlook](https://www.semi.org/en/semi-press-release/semi-projects-300mm-memory-equipment-investment-to-surpass-50-billion-dollars-in-2026) — 2026년 전 세계 300 mm 메모리 4.1M WPM 전망
- [SK hynix — World's First 12-Layer HBM4 Samples](https://news.skhynix.com/sk-hynix-ships-world-first-12-layer-hbm4-samples-to-customers/) — HBM4 12단, 36GB, Advanced MR-MUF
- [Samsung — Commercial HBM4 Shipment](https://news.samsung.com/global/samsung-ships-industry-first-commercial-hbm4-with-ultimate-performance-for-ai-computing) — HBM4 12단 상용 출하와 24~36GB 제품 구성
- [Micron — HBM4](https://www.micron.com/products/memory/hbm/hbm4) — HBM4 36GB 12-Hi 양산 제품
