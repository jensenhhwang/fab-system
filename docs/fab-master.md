# Fab Production Master — M20·M21·M22 생산능력 · WIP · 증산 경계

| Fab | 상태 | 버전 |
|---|---|---|
| M20 | `APPROVED_MODELED_BASELINE` | `FAB_MASTER_M20_V1` |
| M21 | `APPROVED_MODELED_BASELINE` | `FAB_MASTER_M21_V1` |
| M22 | `APPROVED_MODELED_BASELINE` | `FAB_MASTER_M22_V1` |

기준일: 2026-07-21 (M21·M22 신규 정의 반영)

## 1. 문서 목적

이 문서는 M20·M21·M22이 **평균적으로 얼마나 생산하고, 정상 상태에서 얼마의 WIP를 유지하며, 어떤 증산 시나리오를 계획하는지**를 정의하는 생산 규모의 기준 문서다. 각 시나리오를 현재 설비가 실제로 지원하는지는 별도 Equipment Capacity Master에서 판정한다.

- [`route-master.md`](./route-master.md): 웨이퍼가 어떤 공정을 몇 번 통과하는가
- 이 문서: 각 Fab이 얼마나 투입·생산하고 어느 정도 WIP를 보유하는가
- [`foup-wip-master.md`](./foup-wip-master.md): 목표 WIP를 Occupied FOUP·Physical Fleet·후공정 WIP로 분리
- [`fab-equipment-master.md`](./fab-equipment-master.md): Fab별 표준 설비 대수와 NORMAL 15% reserve
- [`material-consumption-master.md`](./material-consumption-master.md): 웨이퍼 1장에 어떤 자재가 얼마나 필요한가

이 다섯 문서의 값이 충돌하면 임의로 숫자를 맞추지 않는다. 생산 규모는 이 문서, 공정 방문수는 `route-master.md`, FOUP·Carrier 수량은 `foup-wip-master.md`, 설비 대수는 `fab-equipment-master.md`, 자재 원단위는 `material-consumption-master.md`를 각각 단일 기준으로 사용한다. **M21·M22는 M20의 WSPM·수율·cycle time·자재 원단위를 복사하지 않고 각 제품·공정 구조에서 독립적으로 도출한다.**

## 2. 사실과 가정의 경계 — 공개자료로 확인되는 범위

- SK hynix M16은 EUV 장비를 도입한 1a nm DRAM 생산 거점으로 공개되었고, M10·M14·M16 세 Fab이 이천 본사에서 주로 DRAM을 생산한다. ([SK hynix Newsroom](https://news.skhynix.com/semiconductor-101-sk-hynix-on-where-chips-are-used/))
- HBM용 웨이퍼는 일반 DRAM의 700개 이상 공정 스텝을 공유하고 TSV·범프·박화·적층 관련 공정 약 19개(프런트 10 + 백 9)가 추가된다. HBM 전용 다이는 TSV keep-out 영역 때문에 동일 세대 standalone DRAM보다 셀 밀도가 낮아질 수 있다. ([Applied Materials](https://www.appliedmaterials.com/us/en/newsroom/blogs/hbm--materials-innovation-propels-high-bandwidth-memory-into-the.html))
- 순수 DRAM 웨이퍼 사이클타임은 스케줄링 최적화만으로 80일에서 30일 미만까지 단축된 실측 사례가 있어, 산업 평균(12주=84일)보다 훨씬 짧게도 운영될 수 있다. ([Leachman & Kang, SLIM — Interfaces 2002](https://pubsonline.informs.org/doi/10.1287/inte.32.1.61.15))
- SK hynix 321단 4D NAND(V9, 2025년 양산)는 **3-deck 구조**(deck당 약 107층)이며, 단일 식각 장비가 한 번에 처리 가능한 층수 한계(~100층) 때문에 channel-hole plug 식각을 deck마다 별도로 3회 수행한다. ([SK hynix Newsroom](https://news.skhynix.com/how-sk-hynixs-advanced-4d-nand-technologies-are-overcoming-stacking-limitations/), [TechInsights](https://www.techinsights.com/blog/sk-hynix-h25gtd0-321-layer-v9-1-tb-tlc-3d-nand-process-flow-analysis))
- NAND는 층수가 늘수록 스텝 수·공정 강도가 뚜렷이 증가한다. SK hynix는 V8→V9 세대 전환에서 전체 공정 스텝 30% 증가, 식각 스텝 20% 증가를 공개했다. ([SemiAnalysis](https://newsletter.semianalysis.com/p/interconnects-beyond-copper-1000), [Lam Research](https://newsroom.lamresearch.com/learning-from-nand-3d-dram-transition-ai-era))
- Fab 가동률 80% 초과는 높은 가동 구간이며 개별 Fab은 수요기에 90~100%까지 운전할 수 있다. ([SIA](https://www.semiconductors.org/wp-content/uploads/2021/06/SIA-Final-submission-to-FCC-on-Impact-of-Global-Semiconductor-Shortage-on-the-U.S.-Communications-Sector-June-10-2021.pdf))

각 Fab 절의 "공개 근거"에서 더 구체적인 출처를 정리한다.

---

## M20 · HBM4 12-Hi

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
| Gross die/wafer | 765 dies | die 면적·edge loss를 단순화한 HBM4 참조값 |
| KGD/wafer | 650 known-good dies | die 수율·TSV test를 합친 완제품 환산값 |
| HBM 적층수 | 12 DRAM dies/stack | `M20-HBM4-12H-V1`; base die는 별도 미모델 |
| 적층·조립수율 | 90% | stack assembly 모델 가정 |
| FOUP 적재량 | 25 wafers/FOUP | WIP 환산 기준 |
| NORMAL 사이클타임 | 105일 | 프런트엔드부터 HBM 후공정까지의 모델 평균 |
| NORMAL 목표 WIP | 16,380 FOUP-equivalent | 평균 투입량과 105일 기준 Little's Law 결과 |

`WSPM`은 HBM 완제품 개수가 아니라 **한 달에 공정에 투입하는 300 mm 웨이퍼 수**다. `130,000 WSPM`을 HBM 13만 개로 읽으면 안 된다.

### 평균 운영점과 생산량

```text
평균 운영 WSPM = 130,000 × 0.90 = 117,000 wafer starts/month
일평균 wafer starts = 117,000 ÷ 30 = 3,900 wafers/day
일평균 FOUP starts  = 3,900 ÷ 25 = 156 FOUP/day
유효 wafer 산출     = 117,000 × 0.85 = 99,450 good wafer-equivalent/month
```

### 정상 WIP 정의

```text
목표 WIP(FOUP-equivalent) = 117,000 ÷ 30 × 105 ÷ 25 = 16,380 FOUP-equivalent
```

운영 화면에서 정상 WIP의 목표 밴드는 중심값의 ±5%로 둔다.

| 상태 | FOUP-equivalent | 판정 |
|---|---:|---|
| 하한 미만 | < 15,561 | 투입 부족 또는 과도한 공정 배출 |
| 정상 밴드 | 15,561~17,199 | NORMAL 안정 운영 |
| 상한 초과 | > 17,199 | 큐잉·병목·사이클타임 증가 점검 |

### 증산 시나리오

| 시나리오 | 월 투입 WSPM | 가동률 | NORMAL 대비 | 계획 cycle time | 계획 WIP(FOUP-eq) | HBM4 12-Hi 36GB/월 | 판정 |
|---|---:|---:|---:|---:|---:|---:|---|
| `NORMAL` | 117,000 | 90% | 기준 | 105일 | 16,380 | 5,703,750 | 평균 운영 기준 |
| `UPLIFT` | 123,500 | 95% | +5.6% | 112일 | 18,443 | 6,020,625 | 단기 증산 계획, 설비 미검증 |
| `NAMEPLATE` | 130,000 | 100% | +11.1% | 126일 | 21,840 | — | 스트레스 계획, 설비 미검증 |
| `EXPANSION` | 143,000 | 110%(명목 대비) | +22.2% | 105일 | 20,020 | 6,971,250 | 디보틀넥·설비증설 후 미래 상태 |

설비 대수는 [`fab-equipment-master.md`](./fab-equipment-master.md)를 따른다. M20은 NORMAL 기준 병목 15%·비병목 25% reserve로 **329 modeled tools**로 정의됐다.

### HBM 완제품 환산

| 단계 | 계산 | wafer 1장당 결과 |
|---|---:|---:|
| Gross DRAM die | die 면적·edge loss 모델 | 765 dies |
| 양품 DRAM die(KGD) | gross die에서 die·TSV test 손실 반영 | 650 good dies |
| 이론 HBM4 12-Hi stack | 650 ÷ 12 | 약 54.167 stacks |
| 양품 HBM4 12-Hi 36GB | 54.167 × 90% | **48.75 stacks/wafer** |

```text
NORMAL HBM4 12-Hi stacks/month = 117,000 × 650 ÷ 12 × 0.90 = 5,703,750 stacks/month
NORMAL HBM4 12-Hi 36GB capacity/month = 5,703,750 × 36 GB = 205,335,000 GB = 205.335 PB/month (decimal)
```

Route 기준: `M20:HBM:V3`, 15개 노드, 140 모델 스텝. 상세는 [`route-master.md`](./route-master.md#m20--hbm)를 따른다.

---

## M21 · DRAM

### 이 시스템이 채택한 가정

M21은 TSV·3D 적층이 없는 standalone DRAM 위주 Fab으로 모델링한다. HBM 다이 자체가 DRAM 다이라는 사실에 근거해([Applied Materials](https://www.appliedmaterials.com/us/en/newsroom/blogs/hbm--materials-innovation-propels-high-bandwidth-memory-into-the.html)) 프런트엔드 반복 구조는 M20과 동일하게 두되, TSV 관련 19스텝과 HBM 전용 P10 패키징은 제거하고 conventional 단일 다이 패키징으로 대체한다.

| 항목 | M21 V1 가정 | 의미 |
|---|---:|---|
| Fab | M21 | 이천 3FAB의 DRAM 전용 Fab |
| 기준 생산품 | `M21-DDR5-16Gb-V1` | SK hynix DDR5 16Gb 다이(H5CNAG8NM 계열) 참조 모델 |
| 웨이퍼 직경 | 300 mm | M20과 동일 |
| 명목 생산능력 | 200,000 WSPM | SK hynix 1c DRAM 실측 규모 근거: M14 conversion 135K + M15X·M16 합산 시 연말 약 190,000 WSPM 전망([X/jukan05 — SK hynix 2026 capex 보도](https://x.com/jukan05/status/2030832161092518106), 뉴스 소스 인용이라 `MEDIUM` 신뢰도). 190K 실측 전망보다 약간 높게 명목치를 잡아 NORMAL(92%)이 그 범위 안에 들어오게 설정 |
| 평균 가동률 | 92% | `fab-scenario.ts` 기존 상수 |
| 평균 운영 투입량 | 184,000 WSPM | 파생값 — 위 실측 전망(약 190K)과 근접 |
| 일평균 투입량 | 6,133.3 wafer/day | 30일 연속운전 기준 |
| 웨이퍼 수율 | 90% | `fab-scenario.ts` 기존 상수. TSV·적층 오버헤드가 없어 M20(85%)보다 높게 설정 |
| Die 면적 | 75.21 mm² | SK hynix DDR5 16Gb 다이 공개 비교값 |
| Gross die/wafer | 863 dies | 300 mm wafer, edge-loss 보정 공식 적용 |
| 양품 DRAM die/wafer | 759 dies | die-level 양품 수율 88% 가정(LOW·MODELED_BASELINE) |
| 패키지 형태 | Single-Die Package(SDP) | 적층 없음, 1 die = 1 package |
| 패키징 조립수율 | 98% | conventional wire-bond/flip-chip 패키징, 스택 정렬 리스크 없어 M20(90%)보다 높게 설정 |
| FOUP 적재량 | 25 wafers/FOUP | M20과 동일 물리 규격 |
| NORMAL 사이클타임 | 80일 | 아래 근거 참고 — Route 스텝 수 기반, WSPM 규모와 무관하게 독립적으로 유지 |
| NORMAL 목표 WIP | 19,626 FOUP-equivalent | Little's Law 결과 |

### 평균 운영점과 생산량

```text
평균 운영 WSPM = 200,000 × 0.92 = 184,000 wafer starts/month
일평균 wafer starts = 184,000 ÷ 30 = 6,133.3 wafers/day
일평균 FOUP starts  = 6,133.3 ÷ 25 = 245.3 FOUP/day
유효 wafer 산출     = 184,000 × 0.90 = 165,600 good wafer-equivalent/month
```

**사이클타임과 WSPM은 서로 독립적인 두 변수다.** NORMAL 80일은 M21 Route(120스텝, TSV·2차 재검 없음)가 M20보다 짧기 때문이지 WSPM 규모에서 유도된 값이 아니다. WSPM은 설비 투자 규모(= 몇 대를 깔 것인가)로 별도 결정하며, 위 실측 근거(M16급 190K)에 맞춰 초판(80,000)보다 상향했다.

### 사이클타임 근거

SIA 자료의 "평균 12주(84일)"는 반도체 전체 평균이며 DRAM 전용 수치가 아니다. Leachman & Kang(Samsung SLIM, Interfaces 2002)은 스케줄링 최적화만으로 DRAM 웨이퍼 사이클타임을 80일에서 30일 미만까지 단축한 실측 사례를 보고했다. M21은 이 범위의 상단 근처인 **80일**을 NORMAL 기준으로 채택한다 — 공격적 최적화(30일)를 가정하지 않되, TSV·2차 웨이퍼테스트·백그라인딩 왕복이 없는 만큼 M20의 105일보다는 명확히 짧다. `LOW · CALIBRATION_REQUIRED`.

- Wafer/FOUP 구간(P01~P09, `route-master.md` M21 1~118 스텝) : **70일**
- Back-end 구간(Dicing~Final Test, conventional 단일 다이 패키징) : **10일**

### 정상 WIP 정의

```text
Daily Wafer Lot release = 6,133.3 ÷ 25 = 245.3 lots/day

Occupied FOUP target  = 245.3 × 70 = 17,173 FOUP
Physical Fleet target = 17,173 ÷ 90% target occupancy ratio = 19,081 FOUP
Non-process pool      = 19,081 − 17,173 = 1,908 FOUP

Back-end WIP equivalent  = 245.3 × 10 = 2,453 lot-equivalent
End-to-end WIP equivalent = 17,173 + 2,453 = 19,626 FOUP-equivalent
```

목표 밴드는 M20과 동일하게 중심값의 ±5%로 둔다: 정상 밴드 **18,645~20,607 FOUP-equivalent**.

### 증산 시나리오

| 시나리오 | 월 투입 WSPM | 가동률 | NORMAL 대비 | 계획 cycle time | 계획 WIP(FOUP-eq) | 판정 |
|---|---:|---:|---:|---:|---:|---|
| `NORMAL` | 184,000 | 92% | 기준 | 80일 | 19,626 | 평균 운영 기준 |
| `UPLIFT` | 192,000 | 96% | +4.3% | 84일 | 21,504 | 단기 증산 계획, 설비 미검증 |
| `NAMEPLATE` | 200,000 | 100% | +8.7% | 90일 | 24,000 | 스트레스 계획, 설비 미검증 |
| `EXPANSION` | 220,000 | 110%(명목 대비) | +19.6% | 80일 | 23,467 | 디보틀넥 후 미래 상태 |

설비 대수는 [`fab-equipment-master.md`](./fab-equipment-master.md#m21--dram)의 **872 modeled tools**(NORMAL 기준 병목 15%·비병목 25% reserve)를 따른다. WSPM은 M20(117,000)보다 크지만(184,000) 전공정(P01~P09)은 단순해 wafer당 설비 필요량이 적다. 다만 P10이 적층 없는 SDP라 wafer당 743.8개 패키지를 그대로 조립·테스트해야 해서, 3팹 중 총 설비 대수가 가장 많다.

### DRAM 완제품 환산

`184,000 WSPM`은 DDR5 16Gb 완제품 184,000개가 아니다. wafer 1장에서 여러 다이를 만들고, 각 다이가 그대로 패키지 1개가 된다(적층 없음).

| 단계 | 계산 | wafer 1장당 결과 |
|---|---:|---:|
| Gross DRAM die | 300 mm wafer, die 75.21 mm², edge-loss 보정 | 863 dies |
| 양품 DRAM die | gross × 88% die-level 수율 | 759 dies |
| 양품 SDP 패키지 | 759 × 98% 패키징 조립수율 | **743.8 packages/wafer** |

```text
NORMAL good DDR5 16Gb packages/month = 184,000 × 759 × 0.98 = 136,862,880 packages/month
NORMAL DDR5 16Gb capacity/month = 136,862,880 × 2 GB = 273,725,760,000 GB ≈ 273,725.76 PB/month (decimal)
```

Gross die 863, 양품 die-level 수율 88%, 패키징 조립수율 98%는 모두 `MODELED_BASELINE`이며 SK hynix의 실제 M21 내부 수율이 아니다. 16Gb DDR5는 최신 세대의 64Gb SDP([Lenovo Press](https://lenovopress.lenovo.com/lp1618-introduction-to-ddr5-memory))보다 보수적인 대표 밀도이며, 더 큰 밀도 제품은 별도 `modelProduct`로 추가한다.

Route 기준: `M21:DRAM:V1`, 프런트엔드는 M20과 동일 구조, 120 모델 스텝. 상세는 [`route-master.md`](./route-master.md#m21--dram)를 따른다.

---

## M22 · NAND

### 이 시스템이 채택한 가정

M22는 SK hynix 321단(V9) 4D NAND를 대표 기준 제품으로 채택한다. 321단은 **3-deck 구조**(deck당 약 107층)이며, 단일 식각 장비의 층수 한계(~100층) 때문에 채널홀 식각·계단 패터닝·게이트 리플레이스먼트가 deck마다 독립적으로 반복된다. ([SK hynix Newsroom](https://news.skhynix.com/how-sk-hynixs-advanced-4d-nand-technologies-are-overcoming-stacking-limitations/), [TechInsights](https://www.techinsights.com/blog/sk-hynix-h25gtd0-321-layer-v9-1-tb-tlc-3d-nand-process-flow-analysis))

| 항목 | M22 V1 가정 | 의미 |
|---|---:|---|
| Fab | M22 | 이천 3FAB의 3D NAND 전용 Fab |
| 기준 생산품 | `M22-NAND321L-1Tb-TLC-V1` | SK hynix 321단(V9) 1Tb TLC 참조 모델 |
| 웨이퍼 직경 | 300 mm | M20·M21과 동일 |
| 명목 생산능력 | 120,000 WSPM | SK hynix NAND 실측 규모 근거: 회사 전체 NAND capacity는 월 30만 장([TheElec — SK hynix to reduce NAND production](https://www.thelec.net/news/articleView.html?idxno=5110)), 단일 신규 라인 기준은 월 10만~12만 장([Chosun Biz](https://www.chosun.com/english/industry-en/2026/02/18/KKWPN5FKDNC53GCGKB5KGTXJSY/)) — 단일 Fab 기준 상단을 채택 |
| 평균 가동률 | 90% | `fab-scenario.ts` 기존 상수 |
| 평균 운영 투입량 | 108,000 WSPM | 파생값 |
| 일평균 투입량 | 3,600 wafer/day | 30일 연속운전 기준 |
| 웨이퍼 수율 | 88% | `fab-scenario.ts` 기존 상수 |
| 적층 단수 | 321단, 3-deck × ~107층 | SK hynix V9 공개 구조 |
| Die 면적 | 43.54 mm² | TechInsights 1Tb TLC V9 실측 |
| Gross die/wafer | 1,523 dies | 300 mm wafer, edge-loss 보정 공식 |
| 양품 NAND die/wafer | 1,249 dies | die-level 양품 수율 82% 가정(LOW·MODELED_BASELINE) |
| 패키지 적층수 | 16단 와이어본딩 | IEEE 공개 사례 상한 |
| 패키징 조립수율 | 96% | 16-die 와이어본딩 스택, M21(98%)보다 낮게 설정(본딩 수 증가) |
| FOUP 적재량 | 25 wafers/FOUP | M20·M21과 동일 물리 규격 |
| NORMAL 사이클타임 | 150일 | 아래 근거 참고 — Route 스텝 수 기반, WSPM 규모와 무관 |
| NORMAL 목표 WIP | 21,600 FOUP-equivalent | Little's Law 결과 |

### 평균 운영점과 생산량

```text
평균 운영 WSPM = 120,000 × 0.90 = 108,000 wafer starts/month
일평균 wafer starts = 108,000 ÷ 30 = 3,600 wafers/day
일평균 FOUP starts  = 3,600 ÷ 25 = 144 FOUP/day
유효 wafer 산출     = 108,000 × 0.88 = 95,040 good wafer-equivalent/month
```

### 사이클타임 근거

3D NAND의 정확한 사이클타임 절대치는 제조사가 공개하지 않는다. 다만 SK hynix는 V8→V9(321단) 전환에서 전체 공정 스텝 30% 증가·식각 스텝 20% 증가를 공개했고([SemiAnalysis](https://newsletter.semianalysis.com/p/interconnects-beyond-copper-1000)), Lam Research는 "적층이 높아질수록 wafer당 공정 스텝이 늘어난다"는 정성적 근거를 제공한다([Lam Research](https://newsroom.lamresearch.com/learning-from-nand-3d-dram-transition-ai-era)). M22의 route 모델 스텝 수(256)가 M20(140)·M21(120)보다 훨씬 많다는 사실과 방향이 일치하므로, `MODELED_BASELINE`으로 M20보다 뚜렷이 긴 사이클타임을 채택한다. `LOW · CALIBRATION_REQUIRED`.

- Wafer/FOUP 구간(P01~P09, `route-master.md` M22 1~239 스텝) : **130일**
- Back-end 구간(Dicing~16단 와이어본딩 패키징) : **20일**

### 정상 WIP 정의

```text
Daily Wafer Lot release = 3,600 ÷ 25 = 144 lots/day

Occupied FOUP target  = 144 × 130 = 18,720 FOUP
Physical Fleet target = 18,720 ÷ 90% target occupancy ratio = 20,800 FOUP
Non-process pool      = 20,800 − 18,720 = 2,080 FOUP

Back-end WIP equivalent  = 144 × 20 = 2,880 lot-equivalent
End-to-end WIP equivalent = 18,720 + 2,880 = 21,600 FOUP-equivalent
```

목표 밴드는 M20과 동일하게 중심값의 ±5%로 둔다: 정상 밴드 **20,520~22,680 FOUP-equivalent**.

### 증산 시나리오

| 시나리오 | 월 투입 WSPM | 가동률 | NORMAL 대비 | 계획 cycle time | 계획 WIP(FOUP-eq) | 판정 |
|---|---:|---:|---:|---:|---:|---|
| `NORMAL` | 108,000 | 90% | 기준 | 150일 | 21,600 | 평균 운영 기준 |
| `UPLIFT` | 114,000 | 95% | +5.6% | 158일 | 24,016 | 단기 증산 계획, 설비 미검증 |
| `NAMEPLATE` | 120,000 | 100% | +11.1% | 168일 | 26,880 | 스트레스 계획, 설비 미검증 |
| `EXPANSION` | 132,000 | 110%(명목 대비) | +22.2% | 150일 | 26,400 | 디보틀넥 후 미래 상태 |

설비 대수는 [`fab-equipment-master.md`](./fab-equipment-master.md#m22--nand)의 **639 modeled tools**(NORMAL 기준 병목 15%·비병목 25% reserve)를 따른다. M20(329대)보다 WSPM(108,000 vs 117,000)은 비슷한 수준이지만 층수·반복 공정이 훨씬 많아 전공정(P01~P09) 총 대수가 M20보다 많다. 다만 16단 적층으로 wafer당 패키지 수가 74.94개까지 줄어들어, P10까지 합친 전체 총 대수는 M21(872대)보다는 적다.

### NAND 완제품 환산

| 단계 | 계산 | wafer 1장당 결과 |
|---|---:|---:|
| Gross NAND die | 300 mm wafer, die 43.54 mm², edge-loss 보정 | 1,523 dies |
| 양품 NAND die | gross × 82% die-level 수율 | 1,249 dies |
| 16단 와이어본딩 패키지 | 1,249 ÷ 16 × 96% 조립수율 | **74.94 packages/wafer** |

```text
NORMAL good 16-die 1Tb-stack packages/month = 108,000 × 1,249 ÷ 16 × 0.96 = 8,093,520 packages/month
NORMAL NAND capacity/month = 8,093,520 × 2,000 GB(16Tb=2TB decimal) = 16,187,040,000 GB
                            = 16,187.04 PB/month ≈ 16.19 EB/month (decimal)
```

Gross die 1,523, die-level 양품수율 82%, 패키징 조립수율 96%는 모두 `MODELED_BASELINE`이며 SK hynix의 실제 M22 내부 수율이 아니다. 375단 이후 세대에서 텅스텐이 몰리브덴으로 일부 대체될 계획이 공개되었으나([wccftech](https://wccftech.com/sk-hynix-races-samsung-to-400-layer-nand-must-abandon-tungsten-as-stacking-hits-a-wall/)) 321단(V9)은 여전히 텅스텐 워드라인을 사용하므로 이 버전에서는 반영하지 않는다.

Route 기준: `M22:NAND:V1`, 3-deck 321단, 256 모델 스텝. 상세는 [`route-master.md`](./route-master.md#m22--nand)를 따른다.

---

## 3팹 비교 요약

| 구분 | M20 · HBM4 12-Hi | M21 · DDR5 16Gb | M22 · NAND 321L 1Tb |
|---|---:|---:|---:|
| 명목 WSPM | 130,000 | 200,000 | 120,000 |
| NORMAL 가동률 | 90% | 92% | 90% |
| NORMAL WSPM | 117,000 | 184,000 | 108,000 |
| 웨이퍼 수율 | 85% | 90% | 88% |
| NORMAL 사이클타임 | 105일 | 80일 | 150일 |
| NORMAL 목표 WIP(FOUP-eq) | 16,380 | 19,626 | 21,600 |
| 적층/패키징 방식 | TSV 12단 적층 | 단일 다이(SDP) | 와이어본딩 16단 |
| Route 모델 스텝 | 140 | 120 | 256 |
| 설비 대수(NORMAL, 병목 15%·비병목 25% reserve) | 329 | 872 | 639 |
| 실측 규모 근거 | M16 참고(가상 HBM Fab) | M16급 1c DRAM(17만~19만 WSPM) | NAND 단일 라인(10만~12만 WSPM) |

M21은 WSPM이 3팹 중 가장 크고, 전공정(P01~P09)은 공정이 단순해 wafer당 필요 설비가 적지만, 적층 없는 SDP라 후공정(P10)에서 wafer당 743.8개 패키지를 그대로 조립·테스트해야 해서 총 설비 대수가 3팹 중 가장 많다. 그런데도 사이클타임은 가장 짧다 — **사이클타임(Route 복잡도)과 WSPM(설비 투자 규모)은 서로 독립적인 변수**이기 때문이다. M22는 WSPM이 가장 낮지만 321단 적층으로 전공정 증착·식각 반복 횟수가 압도적으로 많다. 다만 16단 적층이 후공정 패키지 수를 wafer당 74.94개까지 줄여줘서, 총 설비 대수는 M21보다 적다. 셋 다 오류가 아니라 "wafer당 반복 공정 수"·"적층으로 인한 후공정 단위 통합"·"설비 투자 규모"가 각 Fab마다 다른 방향으로 조합된 결과다.

## 4. 시나리오 계산 계약

모든 생산·자재 시나리오는 다음 필드를 가진다.

| 필드 | 단위 | 설명 |
|---|---|---|
| `scenarioId` | enum | `NORMAL`, `UPLIFT`, `NAMEPLATE`, `EXPANSION` |
| `waferStartsPerMonth` | wafer/month | 시나리오의 직접 입력값 |
| `utilization` | ratio | 각 Fab 명목 WSPM 대비 가동률 |
| `cycleTimeDays` | day | WIP 계산용 독립 입력값 |
| `waferYield` | ratio | 양품 wafer-equivalent 계산용 |
| `wafersPerFoup` | wafer/FOUP | 25 (3팹 공통) |
| `productMix` | ratio map | Fab별 기준 제품 100% (V1) |

## 5. 현재 구현 상태

- M20: 생산 기준 NORMAL 117K / 명목 130K / 정상 WIP 16,380 FOUP-equivalent. 코드·DB 연결 완료.
- M21·M22: 이 문서(V1)로 생산 규모가 승인됐으나, `fab-scenario.ts`의 `M20_PRODUCTION_SCENARIOS`처럼 UPLIFT/NAMEPLATE/EXPANSION 시나리오 상수와 route/equipment DB 연결은 아직 구현되지 않았다. 코드 연결 전까지 이 문서의 표를 단일 기준으로 사용한다.
- 금지: 기존 HBM 월사용량을 일괄 배율하거나, FOUP-equivalent를 실물 FOUP 보유량으로 해석하거나, M21·M22 값을 M20에서 비율로 역산하는 것.

## 6. 변경 관리

다음 값이 바뀌면 해당 Fab 문서를 V2로 올리고 파생값을 모두 재생성한다.

- 명목 WSPM 또는 평균 가동률
- NORMAL/UPLIFT/NAMEPLATE/EXPANSION 경계
- cycle time 또는 FOUP 적재량
- wafer yield 또는 기준 제품
- Route Master의 반복수와 공정 분기

실측 MES 값이 들어오면 가정보다 우선하지만 과거 시나리오 재현을 위해 V1 문서는 삭제하지 않는다.

## 7. 공개 근거

### 공통·M20
- [SK hynix — M16 Plant Construction Completion](https://news.skhynix.com/sk-hynix-announces-the-completion-of-m16-plant-construction/)
- [SK hynix — Semiconductor 101: Where Chips Are Made and Used](https://news.skhynix.com/semiconductor-101-sk-hynix-on-where-chips-are-used/) — M10·M14·M16 DRAM 위주 이천 Fab 구성
- [Applied Materials — Wafer Fab Equipment Market Briefing, HBM Materials Engineering](https://ir.appliedmaterials.com/static-files/2f334f9c-6170-42ed-98b5-24dc11d946e9)
- [SIA — Impact of Global Semiconductor Shortage](https://www.semiconductors.org/wp-content/uploads/2021/06/SIA-Final-submission-to-FCC-on-Impact-of-Global-Semiconductor-Shortage-on-the-U.S.-Communications-Sector-June-10-2021.pdf)
- [SEMI — 2026 300 mm Memory Capacity Outlook](https://www.semi.org/en/semi-press-release/semi-projects-300mm-memory-equipment-investment-to-surpass-50-billion-dollars-in-2026)
- [SK hynix — World's First 12-Layer HBM4 Samples](https://news.skhynix.com/sk-hynix-ships-world-first-12-layer-hbm4-samples-to-customers/)
- [Samsung — Commercial HBM4 Shipment](https://news.samsung.com/global/samsung-ships-industry-first-commercial-hbm4-with-ultimate-performance-for-ai-computing)
- [Micron — HBM4](https://www.micron.com/products/memory/hbm/hbm4)

### M21
- [Applied Materials — HBM Materials Innovation](https://www.appliedmaterials.com/us/en/newsroom/blogs/hbm--materials-innovation-propels-high-bandwidth-memory-into-the.html) — DRAM 700+ 스텝과 HBM 전용 추가 19스텝
- [Leachman & Kang — SLIM: Short Cycle Time and Low Inventory in Manufacturing at Samsung Electronics (Interfaces, 2002)](https://pubsonline.informs.org/doi/10.1287/inte.32.1.61.15) — DRAM 사이클타임 80일→30일 미만 실측 단축 사례
- [The Memory Guy — Why are NAND Flash Fabs so Huge?](https://thememoryguy.com/why-are-nand-flash-fabs-so-huge/) — 역사적 DRAM 팹 표준 규모 참고치
- [TechInsights / EE Times — DDR5 Micron vs Samsung vs SK hynix 다이 비교](https://www.eetimes.com/comparing-ddr5-memory-from-micron-samsung-sk-hynix/) — SK hynix 16Gb DDR5 다이 면적 75.21 mm²
- [Lenovo Press — Introduction to DDR5 Memory](https://lenovopress.lenovo.com/lp1618-introduction-to-ddr5-memory) — SDP 최대 밀도 64Gb
- [SK hynix Newsroom — Semiconductor Back-End Process Episode 6: Conventional Packages](https://news.skhynix.com/semiconductor-back-end-process-episode-6-conventional-packages/) — 8단계 conventional 패키징 흐름
- [AnySilicon — Die Per Wafer Calculator](https://anysilicon.com/die-per-wafer-formula-free-calculators/) — gross die/wafer edge-loss 보정 공식
- [X/@jukan05 — SK hynix 2026 capex ~KRW 40조 보도](https://x.com/jukan05/status/2030832161092518106) — M14 conversion 135K + M15X·M16 합산 연말 약 190,000 WSPM 1c DRAM 전망(뉴스 소스 인용, `MEDIUM` 신뢰도) — M21 명목 200,000 WSPM 산정 근거

### M22
- [SK hynix Newsroom — How SK hynix's Advanced 4D NAND Technologies Are Overcoming Stacking Limitations](https://news.skhynix.com/how-sk-hynixs-advanced-4d-nand-technologies-are-overcoming-stacking-limitations/) — 3-plug(3-deck) 구조, deck당 channel-hole 식각
- [TechInsights — SK hynix H25GTD0 321-Layer V9 1Tb TLC 3D NAND Process Flow Analysis](https://www.techinsights.com/blog/sk-hynix-h25gtd0-321-layer-v9-1-tb-tlc-3d-nand-process-flow-analysis) — die area 43.54 mm², bit density 23.52 Gb/mm²
- [Blocks & Files — SK hynix begins mass production of 321-layer 3D NAND](https://www.blocksandfiles.com/ai-ml/2024/11/21/sk-hynix-begins-mass-production-of-321-layer-3d-nand/1605947)
- [SemiEngineering — 3D NAND's Vertical Scaling Race](https://semiengineering.com/3d-nands-vertical-scaling-race/) — multi-deck 구조와 channel hole 정렬 난제
- [SemiAnalysis — Interconnects: Beyond Copper](https://newsletter.semianalysis.com/p/interconnects-beyond-copper-1000) — V8→V9 스텝 수 30% 증가
- [Lam Research — Learning From NAND](https://newsroom.lamresearch.com/learning-from-nand-3d-dram-transition-ai-era) — 적층 증가에 따른 공정 강도 증가
- [IEEE — Yauw et al., Leading Edge Die Stacking and Wire Bonding Technologies](https://ieeexplore.ieee.org/document/8277544/) — 16단 와이어본딩 스택 사례
- [AZoM — 3D NAND Fabrication and Hot Phosphoric Acid Nitride Strip](https://www.azom.com/article.aspx?ArticleID=20124) — 게이트 리플레이스먼트 공정
- [wccftech — SK Hynix 400+ Layer NAND, Tungsten to Molybdenum](https://wccftech.com/sk-hynix-races-samsung-to-400-layer-nand-must-abandon-tungsten-as-stacking-hits-a-wall/) — 텅스텐→몰리브덴 전환은 375단 이후
- [TheElec — SK Hynix to Reduce NAND Production by 10%](https://www.thelec.net/news/articleView.html?idxno=5110) — SK hynix 회사 전체 NAND capacity 월 300,000 wafer
- [Chosun Biz — Samsung and SK Hynix Advance Semiconductor Lines](https://www.chosun.com/english/industry-en/2026/02/18/KKWPN5FKDNC53GCGKB5KGTXJSY/) — 신규 라인 기준 월 100,000~120,000 wafer 전망 — M22 명목 120,000 WSPM 산정 근거
