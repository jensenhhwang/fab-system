# Material Master — M20·M21·M22 자재 사용처 정의

상태: `DRAFT_FOR_FAB_REVIEW`  
버전: `MATERIAL_MASTER_V1`  
기준일: 2026-07-22  
대상: 현재 `materials`에 등록된 63종

## 1. 문서 목적

이 문서는 각 자재가 **어느 FAB의 어느 제품·공정에서 왜 사용되는지**를 정의하는 상위 기준이다. 수량을 정의하는 문서가 아니다.

```text
material-master.md
  └─ 자재 정체성 + FAB/제품/Route/공정 사용처 + 사용 상태
       └─ material-consumption-master.md
            └─ 사용처별 원단위와 월소요량
                 └─ DB processUsage
```

- 이 문서에서 사용처가 확정되지 않은 자재는 Consumption에 임의의 수량을 만들지 않는다.
- 사용처가 맞더라도 `TBD`·`REVIEW` 상태이면 AI 발주 추천의 확정 근거로 쓰지 않는다.
- 공개자료와 기존 시스템 데이터를 바탕으로 한 초안이며, 실제 FAB Recipe·SOP·MES 투입 이력으로 승인해야 한다.

## 2. 기준 키와 상태

자재 사용처의 최소 식별자는 다음 조합이다.

```text
materialId + fabId + product + routeVersion + processCode + operationCode
```

같은 자재·공정 코드라도 FAB와 제품이 다르면 별도 사용처다. 예를 들어 M20의 `P10.MUF_MOLDING_CURE`와 M22의 `P10.NAND_PACKAGE`는 같은 P10이라도 같은 사용처로 보지 않는다.

| 표시 | 상태 | 의미 | AI 발주 판단 |
|---|---|---|---|
| `A` | `ACTIVE_BASELINE` | 현재 `material-consumption.ts`에 정량 연결됨 | 사용 가능. 단, 현재 대부분 `LOW`·보정 필요 |
| `T` | `RATE_TBD` | 물리적 사용처는 정의했지만 원단위 미확정 | 발주량 계산 금지, 기준정보 보완 알림 |
| `R` | `REVIEW_REQUIRED` | 자재 설명·Legacy 시드에는 있으나 최신 Route와 승인되지 않음 | 후보로만 표시 |
| `U` | `UTILITY` | FAB 공통 유틸리티. 공정 BOM이 아닌 공급설비 기준 | 별도 Utility 모델 필요 |
| `—` | `NOT_APPLICABLE` | 해당 FAB·제품에는 적용하지 않음 | 제외 |

`A`는 실제 FAB 승인 완료를 뜻하지 않는다. 현재 시스템에서 계산행이 활성화되어 있다는 뜻이다.

## 3. FAB·공정 기준

| FAB | 제품 | Route | 현재 정량 연결 자재 |
|---|---|---|---:|
| M20 | HBM4 12-Hi | `M20:HBM:V3` | 44종 |
| M21 | DDR5 DRAM | `M21:DRAM:V1` | 36종 |
| M22 | 321L NAND | `M22:NAND:V1` | 36종 |

| 공정 | 정의 |
|---|---|
| P01 | 산화막·게이트 절연막 형성 |
| P02 | CVD·ALD 박막 및 NAND 스택 증착 |
| P03 | 포토 도포·노광·현상·PR 제거 |
| P04 | 건식·습식 식각, NAND 채널홀·게이트 치환 |
| P05 | 이온주입·도핑 |
| P06 | 금속막·배리어·워드라인 형성 |
| P07 | CMP 및 Post-CMP 세정 |
| P08 | M20 전용 TSV·Cu 도금·Edge Trim·Backgrind·Reveal |
| P09 | 웨이퍼 테스트·KGD 선별 |
| P10 | Dicing·Die Attach·Bonding·Molding·Final Test |
| UTIL | UPW·배기 처리 등 FAB 공통 공급설비 |

## 4. 63종 자재 사용처 매트릭스

### 4.1 GAS — 26종

| ID | 자재 | M20 HBM | M21 DRAM | M22 NAND | 주 사용 목적 |
|---|---|---|---|---|---|
| GAS-001 | 질소 N₂ | `A P01/P02/P03/P07/P08` | `A P01/P02/P03/P07` | `A P01/P02/P03/P07` | 퍼지·블랭킷·운반 |
| GAS-002 | 수소 H₂ | `A P07` | `A P07` | `A P07` | 어닐·금속 환원 계열 |
| GAS-003 | 아르곤 Ar | `A P06` | `A P06` | `A P06` | PVD 스퍼터·희석 |
| GAS-004 | 실란 SiH₄ | `A P02` | `A P02` | `A P02` | Si계 박막 전구체 |
| GAS-005 | 암모니아 NH₃ | `R P02` | `R P02` | `R P02` | SiN CVD 후보. Legacy M21/M22 행과 최신 기준 미연결 |
| GAS-006 | NF₃ | `A P02` | `A P02` | `A P02` | CVD 챔버 세정 |
| GAS-007 | WF₆ | `R P02/P06` | `R P02/P06` | `T P06` | W 충진. M22 게이트 치환용 원단위 필요 |
| GAS-008 | 산소 O₂ | `A P01` | `A P01` | `A P01` | 산화막 성장·애싱 |
| GAS-009 | CO₂ | `A P03` | `A P03` | `A P03` | 세정·Dry clean 계열 |
| GAS-010 | 헬륨 He | `A P05` | `A P05` | `A P05*` | Implant 냉각·리크 검사 |
| GAS-011 | CF₄ | `A P04` | `A P04` | `A P04` | 산화막·질화막 건식 식각 |
| GAS-012 | SF₆ | `R P04` | `R P04` | `R P04` | Si 식각 후보. Recipe 확인 필요 |
| GAS-013 | 염소 Cl₂ | `A P04` | `A P04` | `A P04` | 금속 이방성 식각 |
| GAS-014 | TEOS | `A P02` | `A P02` | `A P02` | PECVD SiO₂ 전구체 |
| GAS-015 | DCS | `R P02` | `R P02` | `R P02` | LPCVD SiN·Poly-Si 후보 |
| GAS-016 | BDEAS | `—` | `R P02` | `T P02` | NAND 스택 ALD Si 전구체 |
| GAS-017 | TiCl₄ | `A P06` | `A P06` | `A P06` | Ti/TiN 배리어 전구체 |
| GAS-018 | TDMAT | `A P07` | `A P07` | `A P07` | TiN 계열 증착. 실제 소비점 재확인 필요 |
| GAS-019 | TEMAHf | `A P01` | `A P01` | `A P01` | High-k HfO₂ 전구체. M22 적용성 확인 필요 |
| GAS-020 | DIPAS | `A P04` | `A P04` | `A P04` | SiO₂ Spacer 전구체. 공정코드 적합성 확인 필요 |
| GAS-021 | BF₃ | `R P05` | `T P05` | `T P05*` | B 도핑 소스 |
| GAS-022 | PH₃ | `R P05` | `T P05` | `R P05*` | P 도핑 소스 |
| GAS-023 | AsH₃ | `R P05` | `R P05` | `T P05*` | As 도핑 소스 |
| GAS-024 | B₂H₆ | `A P05` | `A P05` | `A P05*` | B 도핑·도핑막 |
| GAS-025 | HBr | `R P04` | `R P04` | `T P04` | 고종횡비 Si 식각 |
| GAS-026 | C₄F₈ | `R P04` | `T P04` | `R P04` | Oxide Contact/Via 식각 |

`*` M22 P05는 현재 코드에는 활성 행이 있으나 기존 Consumption 문서의 “P05 비활성” 설명과 충돌한다. M22 주변 CMOS의 Implant Recipe를 기준으로 유지·제외를 결정해야 한다.

### 4.2 CHM — 13종

| ID | 자재 | M20 HBM | M21 DRAM | M22 NAND | 주 사용 목적 |
|---|---|---|---|---|---|
| CHM-001 | 불산 HF | `A P04` | `A P04` | `A P04` | SiO₂ 습식 식각·세정 |
| CHM-002 | 과산화수소 H₂O₂ | `A P01/P04` | `A P01/P04` | `A P01/P04` | SC1/SC2 세정·산화 |
| CHM-003 | 황산 H₂SO₄ | `A P03` | `A P03` | `A P03` | SPM 유기물·PR 잔사 제거 |
| CHM-004 | 암모니아수 NH₄OH | `A P03` | `A P03` | `A P03` | SC1 Particle 세정 |
| CHM-005 | 염산 HCl | `A P03` | `A P03` | `A P03` | SC2 금속 오염 제거 |
| CHM-006 | 인산 H₃PO₄ | `R P04` | `R P04` | `T P04` | NAND 게이트 치환 SiN Strip |
| CHM-007 | ArF PR | `A P03` | `A P03` | `A P03` | ArF 노광 감광막 |
| CHM-008 | KrF PR | `A P03` | `A P03` | `A P03` | KrF 노광 감광막 |
| CHM-009 | EUV PR | `A P03` | `A P03` | `A P03` | EUV 감광막. 실제 Mask mix 확인 필요 |
| CHM-010 | TMAH 현상액 | `A P03` | `A P03` | `A P03` | PR 현상 |
| CHM-011 | Cu ECD 도금액 | `A P08.TSV_FRONT` | `—` | `—` | M20 TSV Cu Fill |
| CHM-012 | EBR 신너 | `R P03` | `T P03` | `R P03` | PR Edge Bead 제거 |
| CHM-013 | Post-CMP 세정액 | `A P07` | `A P07` | `A P07` | CMP 잔류물·금속 오염 제거 |

### 4.3 CSM — 19종

| ID | 자재 | M20 HBM | M21 DRAM | M22 NAND | 주 사용 목적 |
|---|---|---|---|---|---|
| CSM-001 | Ceria Slurry | `A P07` | `A P07` | `A P07` | Oxide·STI CMP |
| CSM-002 | Silica Slurry | `A P07` | `A P07` | `A P07` | W 계열 CMP |
| CSM-003 | Cu Slurry | `A P07` | `A P07` | `A P07` | Cu 배선 CMP. M22 적용성 확인 필요 |
| CSM-004 | CMP Pad | `A P07` | `A P07` | `A P07` | CMP 교체성 Pad |
| CSM-005 | Conditioner Disk | `A P07` | `A P07` | `A P07` | CMP Pad Conditioning |
| CSM-006 | PVD Ti Target | `A P06` | `A P06` | `A P06` | Ti 배리어 스퍼터 |
| CSM-007 | PVD W Target | `A P06` | `A P06` | `A P06` | W 계열 스퍼터 |
| CSM-008 | PVD TiN Target | `A P06` | `A P06` | `A P06` | TiN 배리어 스퍼터 |
| CSM-009 | HBM Probe Card | `A P09.WAFER_TEST` | `—` | `—` | M20 HBM KGD 선별 |
| CSM-010 | DRAM Probe Card | `—` | `T P09.WAFER_TEST` | `R P09` | M21 DRAM Test. NAND 전용 Card ID 필요 |
| CSM-011 | PR Stripper | `A P03` | `A P03` | `A P03` | Ashing 후 PR 잔사 제거 |
| CSM-012 | SnAg μBump | `A P08.TSV_FRONT` | `—` | `—` | M20 HBM Micro-bump |
| CSM-013 | Backgrinding Tape | `A P08.BACKGRIND_THINNING` | `R` | `—` | M20 박막화 보호. Legacy M21 P08 행은 Route와 충돌 |
| CSM-014 | TC-NCF | `A P10.DRAM_BOND_12H` | `—` | `—` | M20 HBM 열압착 본딩 |
| CSM-015 | Quartz Kit | `A P04` | `A P04` | `A P04` | 식각·증착 Chamber PM 교체품 |
| CSM-016 | Edge Trim Blade/Wheel | `T P08.EDGE_TRIM` | `—` | `—` | M20 조건부 Edge Trim |
| CSM-017 | Dicing Blade | `T P10.DICING` | `T P10.DICING` | `T P10.DICING` | Blade-saw Singulation |
| CSM-018 | Dicing UV Tape | `T P10.DICING` | `T P10.DICING` | `T P10.DICING` | Wafer/Frame 고정 |
| CSM-019 | Memory KGD Die Tray | `T P10.DIE_SORT_KGD` | `R P10` | `R P10` | 선별 Die Carrier·회수 관리 |

### 4.4 UTL·PKG — 5종

| ID | 자재 | M20 HBM | M21 DRAM | M22 NAND | 주 사용 목적 |
|---|---|---|---|---|---|
| UTL-001 | 초순수 UPW | `U UTIL` | `U UTIL` | `U UTIL` | 세정·습식공정 공통. 현장 생산·유량 관리 |
| UTL-002 | Scrubber NaOH | `U UTIL` | `U UTIL` | `U UTIL` | 산성 배기 중화. 배기 부하 기준 |
| PKG-001 | HBM용 EMC | `A P10.MUF_MOLDING_CURE` | `—` | `—` | M20 MR-MUF 몰딩. 다른 제품 EMC와 분리 |
| PKG-002 | HBM용 DAF | `A P10.BASE_DIE_ATTACH` | `—` | `—` | M20 HBM Stack 접착 |
| PKG-LBD-001 | HBM4 Logic Base Die KGD | `A P10.BASE_DIE_ATTACH` | `—` | `—` | M20 HBM 직접 구성품 |

## 5. 현재 정합성 Gap

### 5.1 자재 수와 정량 연결 수

| 구분 | 등록 | M20 정량 연결 | M21 정량 연결 | M22 정량 연결 |
|---|---:|---:|---:|---:|
| 현재 63종 | 63 | 44 | 36 | 36 |

등록되어 있다는 사실만으로 해당 FAB에서 쓰이는 자재라고 판단하면 안 된다. `A`가 아닌 행은 Consumption 계산과 AI 자동발주에서 제외하는 것이 안전하다.

### 5.2 코드·문서 충돌

1. M21·M22 Consumption은 M20의 활성 행을 필터·재스케일해 만들기 때문에, Legacy 시드에 있던 GAS-005·007·012·015·021·022·023·025·026, CHM-006·012, CSM-010 등이 최신 정량 모델에서 빠져 있다.
2. M22 문서에는 P05를 비활성으로 적은 부분이 있지만 현재 코드는 GAS-010·024를 포함한 M20 P05 행을 M22에도 생성한다.
3. Legacy 시드의 M21 `CSM-013/P08`은 M21 Route에 P08이 없다는 정의와 충돌한다.
4. `UTL-001/002`는 사용처 문서에는 있으나 현재 `material-consumption.ts`의 Fab별 정량 행에는 없다.
5. GAS-018은 증착 전구체인데 현재 소비점이 P07, GAS-020은 ALD 전구체인데 P04로 잡혀 있다. 실제 Recipe의 투입 Operation을 확인해야 한다.

### 5.3 아직 `materials`에 없는 필수 후보

| FAB | 후보 자재 | 사용처 |
|---|---|---|
| M21 | `PKG-LF-001`, `PKG-DA-001`, `PKG-WB-001`, `PKG-EMC-LF-001`, `PKG-SOL-001` | P10 Conventional Package |
| M22 | `PKG-WB-002`, `PKG-DA-002`, `PKG-EMC-002` | P10 16단 NAND Package |
| M22 | NAND 전용 Probe Card ID | P09 Wafer Test |

이 후보는 실제 공급 형태와 Spec이 확정되기 전까지 현재 63종에 억지로 합치지 않는다.

## 6. Consumption으로 내려보내는 규칙

1. `A` 행만 현재 생산 증가·재고·발주 시뮬레이션의 정량 입력으로 사용한다.
2. `T` 행은 `equivalentPerWafer` 또는 교체수명·package당 원단위가 승인된 뒤 `A`로 승격한다.
3. `R` 행은 Recipe/SOP/MES 소비 이력 중 하나 이상으로 공정 사용 여부를 먼저 확인한다.
4. 한 자재가 여러 공정에서 쓰이면 공정별 Consumption 행을 분리한다. GAS-001과 CHM-002가 이에 해당한다.
5. P10은 반드시 `operationCode`까지 분리한다. `DICING`, `BASE_DIE_ATTACH`, `DRAM_BOND_12H`, `MUF_MOLDING_CURE`, `NAND_PACKAGE`를 한 행으로 합치지 않는다.
6. Utility는 wafer BOM에 넣지 않고 유량·배기부하·수질 기준의 별도 원단위를 사용한다.

## 7. 승인에 필요한 최소 증거

| 상태 변경 | 필요한 증거 |
|---|---|
| `R → T` | FAB·제품·Route·공정·Operation 사용 여부를 확인한 Recipe/SOP 또는 담당자 승인 |
| `T → A` | MES 투입량, 설비 유량, 교체 이력 또는 공급사 Spec으로 원단위 산정 |
| `A 유지` | 30/90일 실적과 기준 원단위 편차 모니터링 |
| `A → —` | Route 변경 또는 공식 미사용 승인 |

## 8. 관련 문서와 구현

- 공정 Route: [`route-master.md`](./route-master.md)
- FAB 생산 기준: [`fab-master.md`](./fab-master.md)
- 설비·공정 기준: [`fab-equipment-master.md`](./fab-equipment-master.md)
- 하위 원단위: [`material-consumption-master.md`](./material-consumption-master.md)
- 현재 정량 구현: `src/lib/material-consumption.ts`
- 현재 63종 등록 원본: `prisma/seed.ts`

