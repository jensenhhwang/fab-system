# Material Consumption Master — M20 wafer당 자재 원단위

상태: `APPROVED_CALIBRATION_BASELINE`  
버전: `MATERIAL_CONSUMPTION_M20_V3`
기준일: 2026-07-19  
생산 기준: [`FAB_MASTER_M20_V1`](./fab-master.md)

## 1. 문서 목적

이 문서는 M20의 생산량과 각 자재의 소요량을 다음 계산 계약으로 연결한다.

```text
M20 시나리오 WSPM
  × 자재별 wafer 1장당 환산 소요량(equivalentPerWafer)
  × 공정 도달률
  × 재작업·손실 보정
  = 시나리오별 월 자재 소요량
```

기존 `processUsage.monthlyQty`는 더 이상 독립적인 기준값이 아니다. 월사용량은 이 문서의 wafer당 원단위와 `fab-master.md`의 생산량에서 만들어지는 **파생값**이다.

## 2. 적용 범위와 제품

| 항목 | M20 V3 기준 | M21 V1 기준 | M22 V1 기준 |
|---|---|---|---|
| Fab | M20 | M21 | M22 |
| 기준 제품 | `M20-HBM4-12H-V2` | `M21-DDR5-16Gb-V1` | `M22-NAND321L-1Tb-TLC-V1` |
| 생산 기준 | NORMAL 117,000 wafer starts/month | NORMAL 184,000 wafer starts/month | NORMAL 108,000 wafer starts/month |
| 웨이퍼 | 300 mm | 300 mm | 300 mm |
| Route | `M20:HBM:V3` | `M21:DRAM:V1` | `M22:NAND:V1` |
| 활성 자재 | 기존 HBM 공정사용량 43종 + Base Die 1종 + utility 2종 | M20 프런트엔드 공유 자재 + conventional 패키징 신규 자재 | M20 프런트엔드 공유 자재(스케일 조정) + NAND 스택 전용 신규 자재 |

V3 마이그레이션은 기존 마스터에 Base Die와 P08/P10 후공정 자재 5종을 추가한다. Base Die는 활성 수요를 계산하고, blade·tape·tray 4종은 원단위 검증 전 `RATE_TBD`로 등록한다. M21·M22는 이 문서 §M21·§M22에서 최초로 정의하며, M20 §5의 값을 그대로 복사하지 않고 각 Fab의 route pass count로 재도출하거나(P02·P03·P04 등 방문수가 다른 자재) 물리 공정이 동일한 항목만 재사용한다(P01·P05·P06 등 방문수가 같은 자재).

## 3. 원단위 필드 계약

각 자재·공정 행은 다음 필드를 가진다.

| 필드 | 설명 |
|---|---|
| `fabId` | `M20` |
| `modelProduct` | `M20-HBM4-12H-V2` |
| `materialId` | 자재 마스터 코드 |
| `routeKey` | Fab/product route family. M20은 `M20:HBM` |
| `routeVersion` | 적용 Route 버전. M20 신규 행은 `ROUTE_MASTER_M20_HBM_V3` |
| `processCode` | P01~P10 또는 `UTIL` |
| `operationCode` | 실제 소비점. 예: `DICING`, `BASE_DIE_ATTACH`, `MUF_MOLDING_CURE` |
| `nativeBasis` | 실제 소비 드라이버: wafer visit, tool-hour, run, touch, stack 등 |
| `nativeQuantity` | 원래 드라이버 1단위당 사용량 |
| `nativeUom` | 원래 드라이버의 단위 |
| `equivalentPerWafer` | wafer start 1장당 재고단위 환산 소요량 |
| `equivalentUom` | `inventory unit / wafer-start` |
| `conversionFormula` | native basis에서 wafer당 값으로 바꾸는 식 |
| `conversionConditions` | 방문수, 제품, 수율, 수명 등 적용 조건 |
| `lossFactor` | 폐기·공급 손실 보정. 기본 1.0 |
| `reworkFactor` | 재작업 보정. 기본 1.0 |
| `source` | `PUBLIC_ANCHOR`, `MODELED_BASELINE`, `LEGACY_DERIVED`, `MES_ACTUAL` |
| `confidence` | `HIGH`, `MEDIUM`, `LOW`, `CALIBRATION_REQUIRED` |
| `version` | `MATERIAL_CONSUMPTION_M20_V3` |

### 3.1 DRAM·NAND와 충돌하지 않는 사용처 키

자재 사용처를 `processCode` 하나로 식별하지 않는다. 동일한 P10이라도 제품과 Route에 따라 recipe와 원단위가 다르므로 활성 소비 규칙의 식별자는 다음 조합이다.

```text
fabId + product + routeVersion + processCode + operationCode + materialId
```

예를 들어 `M20/HBM/V3/P10.DICING/CSM-017`과 향후 `M22/NAND/V1/P10.DICING/CSM-017`은 서로 다른 행이다. P10은 Packaging 대공정이고, 실제 Singulation·Assembly BOM과 원단위는 제품 Route와 operation별로 승인한다. `BASE_DIE_ATTACH`와 `DRAM_BOND_12H`는 M20 HBM Route에만 적용한다.

### 원본 원단위와 wafer 환산값을 함께 두는 이유

- PR·가스·케미컬은 wafer와 공정 방문수에 대체로 선형 비례한다.
- CMP Pad와 PVD Target은 wafer가 아니라 run, tool-hour, kWh 또는 교체수명이 원래 기준이다.
- Probe Card는 touch 수명에 따라 계단식으로 교체된다.
- NCF·DAF·EMC는 KGD 또는 HBM stack이 원래 기준이다.
- UPW는 utility 유량과 회수율이 원래 기준이다.

모든 자재는 계획 비교를 위해 `equivalentPerWafer`를 제공하지만, 구매·교체 실행에서는 반드시 `nativeBasis`를 사용한다.

## 4. 계산 공식

### 4.1 선형 공정 자재

```text
monthlyDemand
  = waferStartsPerMonth
  × equivalentPerWafer
  × routeReachRate
  × reworkFactor
  × lossFactor
```

V3에서도 별도 데이터가 없는 기존 행은 `routeReachRate = 1.0`, `reworkFactor = 1.0`, `lossFactor = 1.0`을 유지한다. 이 값들이 1.0이라는 것은 손실이 실제로 없다는 뜻이 아니라 아직 별도 보정하지 않았다는 뜻이다.

### 4.2 교체성 자재

```text
requiredReplacementUnits
  = ceil(totalNativeDriver ÷ ratedLife)

equivalentPerWafer
  = historicalReplacementUnits ÷ referenceWaferStarts
```

CMP Pad, Conditioner, PVD Target, Probe Card, Quartz Kit은 월소요량을 소수점 그대로 구매하지 않는다. 시나리오 계산값을 자재별 구매단위로 올림한다.

### 4.3 패키징 자재와 완제품 수

```text
knownGoodDies
  = waferStarts × 650 KGD/wafer

grossStackStarts
  = knownGoodDies ÷ 12 dies/stack

goodStacks
  = grossStackStarts × 0.90 assemblyYield

baseDieP10Input
  = grossStackStarts × 1 Base KGD

packageMaterialDemand
  = 해당 자재의 실제 소비점 기준 stack 수 × nativeQuantityPerStack
```

V3는 `gross 765 dies/wafer`, `KGD 650 dies/wafer`, `12 dies/stack`, `assembly yield 90%`를 완제품 환산 가정으로 유지한다. 이에 따라 wafer당 평균 양품은 HBM4 12-Hi 36GB 48.75개이며, NORMAL 생산량은 월 5,703,750개다.

```text
wafer 1장 → gross DRAM die 765개 → 양품 KGD 650개
          → 650 ÷ 12 = 이론 stack 약 54.167개
          → 54.167 × 90% = 양품 HBM4 12-Hi 36GB 48.75개/wafer
```

다만 EMC, NCF, DAF의 `nativeQuantityPerStack`은 아직 없다. 이 세 자재는 기존 NORMAL 월사용량을 wafer-start 기준으로 환산한 호환값을 사용하고 `STACK_EQUIVALENT / LOW`로 표시한다. stack당 실측 원단위가 들어오면 `goodStacks × nativeQuantityPerStack`으로 교체한다.

Base Die는 조립 실패 후 회수되지 않는 직접 구성품이므로 good stack 5,703,750개가 아니라 gross stack start 6,337,500개를 기준으로 소비한다. M20은 외부 Logic Fab/Foundry에서 KGD 상태로 조달한다고 가정한다.

| Base Die 조달 가정 | NORMAL 값 | 상태 |
|---|---:|---|
| P10.`BASE_DIE_ATTACH` 실투입 | 6,337,500 KGD/month | 1 KGD/gross stack |
| 입고 합격률 | 99% | `LOW · UNVALIDATED` |
| 계산상 발주 필요량 | 6,401,516 die/month | 99% 가정 파생값 |
| Tray 적재량 | 1,000 die/tray | `LOW · LOGISTICS_PLACEHOLDER` |
| Tray 단위 발주 | 6,402 tray/month | 위 가정 적용 시에만 유효 |

### 4.4 시나리오 연결

| 시나리오 | WSPM | NORMAL 대비 선형 배율 |
|---|---:|---:|
| NORMAL | 117,000 | 1.0000 |
| UPLIFT | 123,500 | 1.0556 |
| NAMEPLATE | 130,000 | 1.1111 |
| EXPANSION | 143,000 | 1.2222 |

## 5. M20 V3 wafer당 자재 원단위

아래 값은 이전 M20 기준인 명목 50K × 가동률 90% = **45,000 wafer starts/month**에서 작성된 `prisma/seed.ts` HBM 월사용량을 역산한 초기 연결값이다.

```text
equivalentPerWafer = 기존 HBM monthlyQty ÷ 45,000 legacy wafer starts
현재 NORMAL monthlyQty = equivalentPerWafer × 117,000 wafer starts
```

따라서 기존 수치 표는 V1에서 승계한 호환 기준이며 실제 M20 계측값은 아니다. 모든 승계 행의 기본 출처는 `LEGACY_DERIVED`, 신뢰도는 `LOW`이며 MES 투입 실적이나 공급설비 유량으로 보정해야 한다.

### 5.1 케미컬·포토

| 자재 | 공정 | native basis | 재고 단위 | wafer당 환산량 | NORMAL 월소요 |
|---|---|---|---|---:|---:|
| CHM-001 불산(HF) | P04 | wafer-etch visit | 병(20L) | 0.0147778 | 1,729 |
| CHM-002 과산화수소 | P01/P04 | wafer-clean visit | 드럼 | 0.0362444 | 4,240.6 |
| CHM-003 황산 | P03 | wafer-clean visit | 드럼 | 0.0294000 | 3,439.8 |
| CHM-004 암모니아수 | P03 | wafer-clean visit | 드럼 | 0.0196000 | 2,293.2 |
| CHM-005 염산 | P03 | wafer-clean visit | 드럼 | 0.0163333 | 1,911 |
| CHM-007 ArF PR | P03 | wafer-photo coat | 캔(1L) | 0.0132222 | 1,547 |
| CHM-008 KrF PR | P03 | wafer-photo coat | 캔(1L) | 0.00964444 | 1,128.4 |
| CHM-009 EUV PR | P03 | wafer-photo coat | 캔(1L) | 0.00186667 | 218.4 |
| CHM-010 TMAH 현상액 | P03 | wafer-develop visit | 드럼 | 0.00948889 | 1,110.2 |
| CHM-011 Cu ECD 도금액 | P08 | TSV wafer plate | 드럼 | 0.00591111 | 691.6 |
| CHM-013 Post-CMP 세정액 | P07 | wafer-CMP visit | 드럼 | 0.00964444 | 1,128.4 |

### 5.2 CMP·MRO·패키징 소모재

| 자재 | 공정 | native basis | 재고 단위 | wafer당 환산량 | NORMAL 월소요 |
|---|---|---|---|---:|---:|
| CSM-001 Ceria Slurry | P07 | wafer-CMP visit | 캔(20L) | 0.0443333 | 5,187 |
| CSM-002 Silica Slurry | P07 | wafer-CMP visit | 캔(20L) | 0.0303333 | 3,549 |
| CSM-003 Cu Slurry | P07 | wafer-CMP visit | 캔(20L) | 0.0261333 | 3,057.6 |
| CSM-004 CMP Pad | P07 | run / rated life | 장 | 0.00591111 | 691.6 |
| CSM-005 Conditioner Disk | P07 | pad replacement | 개 | 0.00233333 | 273 |
| CSM-006 PVD Ti Target | P06 | tool-kWh / rated life | 개 | 0.000311111 | 36.4 |
| CSM-007 PVD W Target | P06 | tool-kWh / rated life | 개 | 0.000373333 | 43.68 |
| CSM-008 PVD TiN Target | P06 | tool-kWh / rated life | 개 | 0.000311111 | 36.4 |
| CSM-009 HBM Probe Card | P09 | touch / rated life | 장 | 0.000133333 | 15.6 |
| CSM-011 PR Stripper | P03 | wafer-photo visit | 드럼 | 0.0155556 | 1,820 |
| CSM-012 SnAg μBump | P08 | TSV wafer-lot | wafer-lot | 0.00280000 | 327.6 |
| CSM-013 Backgrinding Tape | P08 | wafer / roll coverage | 롤 | 0.0113556 | 1,328.6 |
| CSM-014 TC-NCF | P10.`DRAM_BOND_12H` | HBM stack | 롤 | 0.00544444 | 637 |
| CSM-015 Quartz Kit | P04 | tool-hour / PM life | 세트 | 0.000373333 | 43.68 |
| PKG-001 EMC | P10.`MUF_MOLDING_CURE` | HBM stack | kg | 0.0653333 | 7,644 |
| PKG-002 DAF | P10.`BASE_DIE_ATTACH` | HBM stack | 롤 | 0.0280000 | 3,276 |
| PKG-LBD-001 Logic Base Die KGD | P10.`BASE_DIE_ATTACH` | gross stack | KGD_DIE | 54.7138 purchase die/wafer | 6,401,516 die |

### 5.3 P08/P10 신규 자재 마스터와 원단위 상태

| 자재 | 소비점 | 분류 | V3 원단위 상태 |
|---|---|---|---|
| CSM-016 Edge Trim Blade/Wheel | P08.`EDGE_TRIM` | 조건부 소모재 | `RATE_TBD · CALIBRATION_REQUIRED` |
| CSM-013 Backgrinding Tape | P08.`BACKGRIND_THINNING` | 기존 소모재 | Edge Trim과 Backgrind에서 중복 소비 금지 |
| CSM-017 Dicing Blade | P10.`DICING` | blade-saw 조건부 소모재 | `RATE_TBD · CALIBRATION_REQUIRED` |
| CSM-018 Dicing UV Tape | P10.`DICING` | wafer/frame 소모재 | `RATE_TBD · CALIBRATION_REQUIRED` |
| CSM-019 Memory KGD Die Tray | P10.`DIE_SORT_KGD` | 재사용 carrier | 적재량·회수율 `TBD` |

Edge Trim blade와 Dicing blade, Backgrinding tape와 Dicing tape는 수명 driver와 용도가 다르므로 별도 material ID를 사용한다. UPW는 구매 자재가 아니라 utility로 계속 분리한다.

### 5.4 가스·전구체

| 자재 | 공정 | native basis | 재고 단위 | wafer당 환산량 | NORMAL 월소요 |
|---|---|---|---|---:|---:|
| GAS-001 N₂ | P01/P02/P03/P07/P08 | tool-hour / wafer visit | 봄베 | 1.06711 | 124,852 |
| GAS-002 H₂ | P07 | tool-hour / wafer visit | 봄베 | 0.0357778 | 4,186 |
| GAS-003 Ar | P06 | PVD tool-hour | 봄베 | 0.0899111 | 10,519.6 |
| GAS-004 SiH₄ | P02 | wafer-CVD visit | 봄베 | 0.0140000 | 1,638 |
| GAS-006 NF₃ | P02 | chamber-clean / tool-hour | 봄베 | 0.00575556 | 673.4 |
| GAS-008 O₂ | P01 | wafer-oxidation visit | 봄베 | 0.0622222 | 7,280 |
| GAS-009 CO₂ | P03 | wafer-clean visit | 봄베 | 0.0336000 | 3,931.2 |
| GAS-010 He | P05 | implant tool-hour | 봄베 | 0.00731111 | 855.4 |
| GAS-011 CF₄ | P04 | wafer-etch visit | 봄베 | 0.00684444 | 800.8 |
| GAS-013 Cl₂ | P04 | wafer-etch visit | 봄베 | 0.00451111 | 527.8 |
| GAS-014 TEOS | P02 | wafer-CVD visit | 드럼 | 0.0147778 | 1,729 |
| GAS-017 TiCl₄ | P06 | wafer-deposition visit | 봄베 | 0.00528889 | 618.8 |
| GAS-018 TDMAT | P07 | wafer-deposition visit | 봄베 | 0.00451111 | 527.8 |
| GAS-019 TEMAHf | P01 | wafer-ALD visit | 봄베 | 0.00124444 | 145.6 |
| GAS-020 DIPAS | P04 | wafer-ALD visit | 봄베 | 0.00202222 | 236.6 |
| GAS-024 B₂H₆ | P05 | implant tool-hour | 봄베 | 0.00280000 | 327.6 |

### 5.5 Utility 환산

| 자재 | 공정 | native basis | 재고 단위 | wafer당 환산량 | NORMAL 월소요 | 상태 |
|---|---|---|---|---:|---:|---|
| UTL-001 UPW | UTIL | line/day | 톤 | 1.2821 | 150,000 | 5,000톤/일 ÷ 3,900 wafer/일 |
| UTL-002 Scrubber NaOH | UTIL | exhaust load | 드럼 | 0.0040833 | 477.75 | Campus 사용량의 HBM 35% 임시 배분 |

UPW의 1.2821톤/wafer는 현재 시드의 `5,000톤/Line·day`를 M20 NORMAL 일투입량으로 나눈 값이다. 외부 연구의 시스템 경계는 총 취수, UPW 생산, 재이용을 서로 다르게 포함하므로 직접 대체하지 않고 M20 유틸리티 계측값으로 보정한다.

## 6. Route Master 방문수와 알려진 불일치

현재 `ROUTE_MASTER_M20_HBM_V3`를 펼치면 대표 공정 방문수는 다음과 같다.

| 공정 | 대표 방문수 | 비고 |
|---|---:|---|
| P01 | 4 | gate oxide |
| P02 | 27 | cell-array 22 + BEOL 5 |
| P03 | 27 | cell-array 22 + BEOL 5 |
| P04 | 27 | cell-array 22 + BEOL 5 |
| P05 | 0 | 현 선형 Route가 `증착 또는 이온주입` 분기를 P02로 대표해 누락 |
| P06 | 5 | BEOL 5 |
| P07 | 27 | cell-array 22 + BEOL 5 |
| P08 | 4 | TSV front + edge trim + backgrind + TSV back |
| P09 | 2 | KGD 1차 + 적층 전 2차 |
| P10 | 17 | Dicing 1 + Die Sort/KGD 1 + Base Attach 1 + DRAM Bond 12 + MUF/Molding 1 + Final Test 1 |

P05 원단위가 있는데 Route 방문수가 0인 것은 실제 소비가 0이라는 뜻이 아니다. Route Master가 선택 분기를 선형 배열로 단순화한 결과다. V3에서는 cell-array 노드에 P02/P05 조건 분기 또는 도달률을 추가해야 한다.

## 7. 공개자료와 승계값의 교차검증

### Photoresist

공개 특허에서는 300 mm wafer 한 번의 PR coating에 일반적으로 약 0.6~1.5 cc를 분배하는 범위를 제시한다. V1의 ArF+KrF+EUV 합계는 wafer당 약 24.73 mL이고 Route Master의 P03 27회로 나누면 약 0.92 mL/visit이다. 공개 범위 안에 들어오지만 mask mix별 dispense는 확인되지 않았으므로 `CALIBRATION_REQUIRED`다.

### CMP Slurry

공개 연구에서는 300 mm CMP slurry 유량이 약 250~300 mL/min 범위이고 실제 이용효율도 공정 조건에 따라 크게 달라진다고 설명한다. V1의 세 slurry 합계는 약 2.016 L/wafer이므로 P07 반복수와 polish time을 결합한 tool recipe 검증이 필요하다.

### Probe Card

Probe Card는 wafer당 소수점 장수가 직접 투입되는 자재가 아니다. FormFactor 공개 사례처럼 한 touchdown으로 300 mm wafer 전체를 접촉할 수도 있어 제품·병렬도에 따라 touch/wafer가 크게 달라진다. V1의 `6장/month`는 계획 호환값이며 실제 계산은 `touchesPerWafer ÷ ratedTouchLife`로 교체한다.

## 8. 시나리오 계산 예시

### ArF PR

```text
NORMAL    = 0.0132222 × 117,000 = 1,547 캔/month
UPLIFT    = 0.0132222 × 123,500 ≈ 1,632.9 캔/month
NAMEPLATE = 0.0132222 × 130,000 ≈ 1,718.9 캔/month
EXPANSION = 0.0132222 × 143,000 ≈ 1,890.8 캔/month
```

### HBM Probe Card

```text
연속 환산 NORMAL    = 15.6장 → 구매·교체 계획 16장
연속 환산 UPLIFT    ≈ 16.47장 → 구매·교체 계획 17장
연속 환산 NAMEPLATE ≈ 17.33장 → 구매·교체 계획 18장
연속 환산 EXPANSION ≈ 19.07장 → 구매·교체 계획 20장
```

### EMC

```text
NORMAL wafer-start 호환값 = 0.0653333 kg/wafer × 117,000 = 7,644 kg/month
```

EMC는 향후 `goodStacks × kgPerStack`으로 교체한다. 현재 값은 HBM4 12-Hi 100% 제품 믹스로 이름을 바꿨지만, 수치 자체는 legacy HBM 환산값이므로 `CALIBRATION_REQUIRED`다. 8-Hi 값을 1.5배 하지 않고 실제 stack당 원단위로 교체한다.

## M21 wafer당 자재 원단위

M21 프런트엔드(P01~P07, P09)는 M20과 동일한 물리 공정이므로([Applied Materials](https://www.appliedmaterials.com/us/en/newsroom/blogs/hbm--materials-innovation-propels-high-bandwidth-memory-into-the.html)), route pass count가 같은 자재(P01 4회, P02/P03/P04/P07 27회, P06 5회)는 M20 §5의 `equivalentPerWafer`를 그대로 재사용하고 M21 NORMAL WSPM(184,000 — M16급 실측 규모, [`fab-master.md`](./fab-master.md#m21--dram) 참고)으로 월소요량만 다시 계산한다. P09는 M20이 2회(1차+2차)인데 M21은 1회(EDS만)라 관련 자재는 절반으로 재산정한다.

### M21.1 M20과 공유하는 프런트엔드 자재 (대표 항목, `equivalentPerWafer` 동일 재사용)

| 자재 | 공정 | wafer당 환산량(M20과 동일) | M21 NORMAL 월소요 |
|---|---|---:|---:|
| CHM-007 ArF PR | P03 | 0.0132222 | 2,432.9 캔 |
| CHM-013 Post-CMP 세정액 | P07 | 0.00964444 | 1,774.6 드럼 |
| CSM-001 Ceria Slurry | P07 | 0.0443333 | 8,157.3 캔 |
| GAS-001 N₂ | P01/P02/P03/P07 | 1.06711(TSV 관련 P08 몫 제외 전 M20값 — 재계산 필요, `CALIBRATION_REQUIRED`) | — |
| GAS-004 SiH₄ | P02 | 0.0140000 | 2,576.0 봄베 |
| GAS-008 O₂ | P01 | 0.0622222 | 11,448.9 봄베 |

전체 목록은 M20 §5.1·5.2·5.4의 P01/P02/P03/P04/P06/P07 관련 행을 동일하게 적용하되, GAS-001(N₂)처럼 M20에서 P08 공정도 함께 태그된 항목은 P08 몫을 제외한 재계산이 필요하다(`CALIBRATION_REQUIRED`). 이 표는 대표 항목만 예시했고, 나머지 항목은 같은 방식으로 마이그레이션 시 전개한다.

### M21.2 제거되는 TSV 전용 자재

M21에는 P08(TSV)이 없으므로 아래는 `0 / NOT_MODELED`다.

| 자재 | 사유 |
|---|---|
| CHM-011 Cu ECD 도금액 | TSV wafer plate 전용 |
| CSM-012 SnAg μBump | TSV wafer-lot 전용 |
| CSM-016 Edge Trim Blade/Wheel | P08.`EDGE_TRIM` 전용 |
| PKG-LBD-001 Logic Base Die KGD | M20 HBM 스택 전용 외부 조달 자재, M21에 대응 개념 없음 |
| CSM-014 TC-NCF, PKG-002 DAF(스택 배합) | HBM 스택 본딩 배합. M21은 §M21.3의 단일 다이 DAF로 대체 |

### M21.3 신규 — Conventional 단일 다이 패키징 자재

M21 P10은 리드프레임/기판 실장이라 M20의 스택 조립 자재 대신 새 자재군이 필요하다([SK hynix Newsroom](https://news.skhynix.com/semiconductor-back-end-process-episode-6-conventional-packages/); [TI SNOA286](https://www.ti.com/lit/pdf/SNOA286)).

| 자재 | 소비점 | native basis | 재고 단위 | 상태 |
|---|---|---|---|---|
| PKG-LF-001 리드프레임(Cu/Ag/NiPd 도금) | P10.`DIE_ATTACH` | die당 1개 | 개 | `RATE_TBD` |
| PKG-DA-001 Die Attach 접착제(에폭시/시아네이트 에스터) 또는 단일-다이 DAF | P10.`DIE_ATTACH` | die당 native quantity | roll 또는 캔 | `RATE_TBD` |
| PKG-WB-001 Au 본딩 와이어 | P10.`WIRE_BOND` | die당 wire 수 × pitch | spool | `RATE_TBD` |
| PKG-EMC-LF-001 리드프레임용 EMC | P10.`MOLDING` | package당 kg | kg | `RATE_TBD` |
| PKG-SOL-001 솔더볼(BGA) 또는 리드 도금액 | P10.`LEAD_FINISH` | package당 native quantity | kg 또는 리터 | `RATE_TBD` |
| CSM-010 DRAM Probe Card | P09 | touchdown / rated touch life | 장 | `RATE_TBD` — FormFactor 공개 사례는 1~6 touchdown/wafer([FormFactor](https://www.formfactor.com/applications/high-volume-test-on-wafer/memory-test/), [FormFactor PH150](https://www.formfactor.com/press-release/formfactor-first-to-introduce-six-touchdown-probe-card-to-test-300mm-dram-wafers/)). M20의 CSM-009(6장/월 legacy 호환값)를 그대로 쓰지 않고 `touchesPerWafer(1~6) ÷ ratedTouchLife`로 별도 산정한다 |

이 6개 자재는 정확한 vendor 원단위가 아직 없어 `RATE_TBD`다. 실제 조달 계산에 쓰려면 리드프레임/기판 vendor spec과 wire bonder 레시피가 먼저 확정되어야 한다.

---

## M22 wafer당 자재 원단위

M22는 route pass count가 M20과 크게 다르다(P02 162 vs 27, P03 24 vs 27, P04 30 vs 27 등, [`route-master.md`](./route-master.md#m22--nand) 참고). 같은 native basis(예: wafer-CVD visit)를 쓰는 자재는 **pass count 비율로 `equivalentPerWafer`를 재스케일**하고, 3D NAND 고유 자재는 새로 추가한다. M22 NORMAL WSPM은 108,000(NAND 단일 라인 실측 규모, [`fab-master.md`](./fab-master.md#m22--nand) 참고)이다.

### M22.1 M20 대비 재스케일 자재 (대표 항목)

P02(CVD) 계열은 M20 27회 → M22 162회, 배율 ×6.0 — 321단 스택 증착 반복이 원인이며 오류가 아니다.

| 자재 | 공정 | M20 equivalentPerWafer | 재스케일 배율 | M22 equivalentPerWafer | M22 NORMAL 월소요 |
|---|---|---:|---:|---:|---:|
| GAS-004 SiH₄ | P02 | 0.0140000 | ×6.0(162/27) | 0.084000 | 9,072 봄베 |
| GAS-014 TEOS | P02 | 0.0147778 | ×6.0 | 0.088667 | 9,576 드럼 |
| CHM-007 ArF PR | P03 | 0.0132222 | ×0.889(24/27) | 0.011753 | 1,269.3 캔 |
| CHM-002 과산화수소 | P01/P04 | 0.0362444 | ×1.111(30/27, P04 기준) | 0.040272 | 4,349.4 드럼 |
| GAS-011 CF₄ | P04 | 0.00684444 | ×1.111 | 0.007605 | 821.3 봄베 |
| CSM-001 Ceria Slurry | P07 | 0.0443333 | ×0.370(10/27) | 0.016407 | 1,772.0 캔 |

이 표는 대표 항목만 예시했다. 나머지 P01/P02/P03/P04/P06/P07 관련 자재도 같은 pass-count 비율 재스케일 방법을 적용해 전개한다. 이 재스케일은 "동일 native quantity per visit"를 가정한 1차 근사이며, 실제 NAND 증착 레시피(막 두께·시간)가 DRAM 증착과 다를 수 있으므로 전 항목 `CALIBRATION_REQUIRED`다.

### M22.2 제거·비활성 자재

P08(TSV), P05(이온주입 — 주변 CMOS에만 소량 필요하나 셀 어레이 자체엔 불필요), HBM 스택 조립 자재(CHM-011, CSM-012, CSM-014, PKG-001/002, PKG-LBD-001)는 M22에 적용하지 않는다.

### M22.3 신규 — 3D NAND 스택·게이트 리플레이스먼트 자재

| 자재 | 소비점 | 분류 | 근거 |
|---|---|---|---|
| GAS-016 BDEAS | P02(스택 증착) | 산화막/질화막 ALD Si 전구체 | BDEAS는 SiO₂·SiₓNᵧ ALD에 널리 쓰이는 대표 전구체([ScienceDirect](https://www.sciencedirect.com/science/article/pii/S1369800125009205)) — `equivalentPerWafer`는 D_pair(161) 기준 신규 도출 필요, `RATE_TBD` |
| CHM-006 H₃PO₄(인산) | P04(게이트 치환, deck당 1) | 희생 질화막 습식 제거(hot phosphoric acid strip) | 3D NAND 게이트 리플레이스먼트의 표준 습식 공정([AZoM](https://www.azom.com/article.aspx?ArticleID=20124)) — deck 수(3) 기준 신규 도출 필요, `RATE_TBD` |
| GAS-007 WF₆ | P06(게이트 치환, deck당 1) | 텅스텐 워드라인 충진 | 321단(V9)은 텅스텐 워드라인 유지, 375단 이후에야 몰리브덴 일부 전환 예정([wccftech](https://wccftech.com/sk-hynix-races-samsung-to-400-layer-nand-must-abandon-tungsten-as-stacking-hits-a-wall/)) — deck 수(3) 기준 신규 도출 필요, `RATE_TBD` |
| PKG-WB-002 Au 본딩 와이어(16단) | P10.`NAND_PACKAGE` | 16-die 와이어본딩 적층 | die당 wire, 16단이라 M21(단일 다이)의 16배 규모. `RATE_TBD` |
| PKG-DA-002 다이 어태치 필름(DAF, 박형) | P10.`NAND_PACKAGE` | 16단 적층용 초박형 DAF(5~10μm급) | IEEE 공개 사례의 얇은 다이(15~25μm) 적층용 DAF 두께 기준([IEEE](https://ieeexplore.ieee.org/document/8277544/)) — `RATE_TBD` |
| PKG-EMC-002 스택 몰딩 컴파운드 | P10.`NAND_PACKAGE` | 16단 스택 몰딩 | M20 PKG-001(EMC)과 별도 배합, `RATE_TBD` |

이 6개 자재는 D_pair·deck 수 기반 정량 원단위가 아직 없어 전부 `RATE_TBD`다. BDEAS·H₃PO₄·WF₆ 활성화가 M22 자재 마스터의 다음 우선순위다.

---

## 9. M20 비활성 자재

아래 자재는 현재 M20 계산에서 `0 / NOT_MODELED`로 처리한다. 이는 물리적으로 소비량이 0이라는 뜻이 아니라 Route·recipe와 연결되지 않아 조달 계산에서 제외한다는 뜻이다.

| 자재 | 현재 분류 | 후속 조치 |
|---|---|---|
| GAS-005 NH₃ | M20 적용 후보 | P02 recipe 확인 |
| GAS-007 WF₆ | M20 적용 후보, **M22는 §M22.3에서 활성화**(게이트 리플레이스먼트 텅스텐 충진, `RATE_TBD`) | M20 DRAM contact/W plug 적용 여부는 별도 확인 |
| GAS-012 SF₆ | M20 적용 후보 | P04 etch recipe 확인 |
| GAS-015 DCS | M20 적용 후보 | P02 DRAM base-die recipe 확인 |
| GAS-021 BF₃ | M20 적용 후보 | P05 implant mix 확인 |
| GAS-022 PH₃ | M20 적용 후보 | P05 implant mix 확인 |
| GAS-023 AsH₃ | M20 적용 후보 | P05 implant mix 확인 |
| GAS-025 HBr | M20 적용 후보 | P04 high-aspect etch 적용 확인 |
| GAS-026 C₄F₈ | M20 적용 후보 | P04 oxide etch 적용 확인 |
| CHM-012 EBR | M20 적용 후보 | P03 coat recipe 확인 |
| GAS-016 BDEAS | **M22에서 §M22.3으로 활성화**(스택 ALD Si 전구체, `RATE_TBD`) | M20 recipe 근거는 여전히 없어 M20은 계속 제외 |
| CHM-006 H₃PO₄ | **M22에서 §M22.3으로 활성화**(게이트 리플레이스먼트 습식 스트립, `RATE_TBD`) | M20 recipe 근거는 여전히 없어 M20은 계속 제외 |
| CSM-010 DRAM Probe Card | **M21에서 §M21.3으로 활성화**(`RATE_TBD`) | M20은 계속 CSM-009 사용 |

비활성 후보를 다른 자재의 비율로 임의 보간하지 않는다. 활성화할 때 `equivalentPerWafer`, 변환식, 조건, 출처와 신뢰도를 함께 추가한다.

## 10. 구현 연결 규칙

1. Fab별 NORMAL `monthlyQty`는 `equivalentPerWafer × 해당 Fab NORMAL WSPM`(M20 117,000 / M21 184,000 / M22 108,000)으로 생성한다.
2. 일일 생산실적이 있으면 `equivalentPerWafer × actual wafer starts`로 당일 소요량을 계산한다.
3. 실적이 없으면 `equivalentPerWafer × 해당 Fab 일평균 wafer starts`(M20 3,900 / M21 6,133.3 / M22 3,600)를 계획값으로 사용한다.
4. UPLIFT/NAMEPLATE/EXPANSION은 같은 원단위에 해당 시나리오 WSPM을 적용한다.
5. 교체성 자재는 연속 환산값과 정수 구매·교체 필요량을 함께 반환한다.
6. DB `processUsage.monthlyQty`는 화면 호환을 위한 materialized value이며 원단위보다 우선하지 않는다.
7. MES `CONSUMED` 원장이 충분히 쌓이면 30/90일 실적 ePW를 별도로 계산하고 계획값과 차이를 표시한다.
8. M21·M22의 `equivalentPerWafer`는 M20 값을 pass-count 비율로 재스케일하거나(§M21.1, §M22.1) 새로 도출한(§M21.3, §M22.3) 값이며, 두 경우 모두 마이그레이션 전 `CALIBRATION_REQUIRED`·`RATE_TBD` 표시를 유지한다.

## 11. 보정 우선순위

1. PR coat별 dispense와 P03 mask mix
2. CMP recipe별 slurry flow·polish time·P07 방문수
3. 가스별 cylinder 용량을 Nm³ 또는 kg으로 표준화
4. Probe Card의 touchdowns/wafer와 rated touch life (M20 CSM-009, M21 CSM-010 공통)
5. CMP Pad·PVD Target·Quartz Kit의 tool driver와 교체수명
6. KGD/wafer, HBM4 12-Hi 적층수율, NCF·DAF·EMC stack 원단위 (M20)
7. UPW 공급·회수 유량과 wafer pass별 사용량
8. M21 conventional 패키징 자재(리드프레임·Au wire·EMC·솔더) vendor spec 확보
9. M22 NAND 스택 자재(BDEAS·H₃PO₄·WF₆) deck 수 기반 원단위 도출과 wire bonder/molding UPH 확보

## 12. 공개 근거

### M20
- [Applied Materials — HBM Materials Engineering Steps](https://ir.appliedmaterials.com/static-files/2f334f9c-6170-42ed-98b5-24dc11d946e9) — DRAM 700+ 스텝, TSV·CVD·PVD·Cu plating·CMP·bump 공정
- [300 mm photoresist coating patent](https://patents.google.com/patent/KR20210134208A/en) — 일반 PR dispense 약 0.6~1.5 cc/300 mm wafer와 저감 예시
- [Slurry Injection Schemes in CMP](https://pmc.ncbi.nlm.nih.gov/articles/PMC6189973/) — 300 mm CMP slurry의 대표 유량 범위와 낮은 slurry 이용효율
- [FormFactor — One-touchdown 300 mm Probe Solution](https://www.formfactor.com/press-release/formfactor-ships-industrys-first-one-touchdown-300-mm-wafer-probe-solution-for-burn-in-test-applications/) — 300 mm wafer 전체 one-touchdown DRAM test 사례
- [Strategic Optimization of Water Reuse in Wafer Fabs](https://doi.org/10.1016/j.wen.2018.07.004) — Fab water mass-balance와 회수·재이용 경계
- [SK hynix — World's First 12-Layer HBM4 Samples](https://news.skhynix.com/sk-hynix-ships-world-first-12-layer-hbm4-samples-to-customers/) — M20 기준 제품의 HBM4 12단·36GB 공개 근거

### M21
- [SK hynix Newsroom — Semiconductor Back-End Process Episode 6: Conventional Packages](https://news.skhynix.com/semiconductor-back-end-process-episode-6-conventional-packages/) — conventional 8단계 패키징 자재 흐름
- [TI — Semiconductor Packaging Assembly Technology (SNOA286)](https://www.ti.com/lit/pdf/SNOA286) — Die Attach·Wire Bond·Mold Compound·Lead Finish 물성·공정 파라미터
- [Caplinq — Leadframes](https://www.caplinq.com/leadframes.html) — 리드프레임 도금 종류(Bare Cu/Ag/NiPd/PPF)
- [Kyocera — Epoxy Molding Compounds for Semiconductors](https://global.kyocera.com/prdct/chem/list/emc/) — 리드프레임 패키지 전용 EMC 라인업
- [FormFactor — High Volume Memory Test](https://www.formfactor.com/applications/high-volume-test-on-wafer/memory-test/) / [FormFactor — Six-Touchdown Probe Card for 300mm DRAM (PH150)](https://www.formfactor.com/press-release/formfactor-first-to-introduce-six-touchdown-probe-card-to-test-300mm-dram-wafers/) — DRAM probe card touchdown 범위(1~6)

### M22
- [ScienceDirect — BDEAS ALD Precursor](https://www.sciencedirect.com/science/article/pii/S1369800125009205) — SiO₂·SiₓNᵧ ALD Si 전구체로서의 BDEAS
- [AZoM — 3D NAND Fabrication and Hot Phosphoric Acid Nitride Strip](https://www.azom.com/article.aspx?ArticleID=20124) — H₃PO₄ 습식 스트립·텅스텐 게이트 충진 공정
- [wccftech — SK Hynix 400+ Layer NAND, Tungsten to Molybdenum](https://wccftech.com/sk-hynix-races-samsung-to-400-layer-nand-must-abandon-tungsten-as-stacking-hits-a-wall/) — 텅스텐 유지 시점(321단)과 몰리브덴 전환(375단 이후) 경계
- [IEEE — Yauw et al., Leading Edge Die Stacking and Wire Bonding Technologies](https://ieeexplore.ieee.org/document/8277544/) — 16단 와이어본딩 DAF 두께·다이 두께 사례
