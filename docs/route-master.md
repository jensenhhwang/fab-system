# Fab Route Master — HBM · DRAM · NAND 공정 흐름 정의

## 목적

`src/lib/processes.ts`의 `PROCESSES`는 P01~P10 대공정 capability를 정의하지만, 실제 팹은 제품마다 이 공정을 **몇 번, 어떤 순서로, 어떤 operation으로** 사용하는지가 다르다. 이 문서는 그 반복·분기 구조를 제품별로 정의하고, `routeMaster` 컬렉션(DB)과 공정 시각화의 기준으로 사용한다.

연결된 기준 문서:

- [`fab-master.md`](./fab-master.md): M20 평균 WSPM, 정상 WIP, 증산 경계
- [`foup-wip-master.md`](./foup-wip-master.md): P10 Dicing 경계의 FOUP 해제와 Lot·Carrier·Genealogy 계약
- [`fab-equipment-master.md`](./fab-equipment-master.md): Fab별 표준 설비 대수와 Capacity reserve
- [`material-consumption-master.md`](./material-consumption-master.md): M20 wafer 1장당 자재 원단위와 시나리오 소요량

**표기 원칙**: 여기 적힌 스텝 순서·자재·구조는 문서 하단 [출처](#출처)에 정리한 업계 공개 자료(Applied Materials, SK하이닉스 뉴스룸, Samsung Newsroom, imec, SemiEngineering, Micron 공식 교육 자료 등)에 근거한다. 반복 횟수는 이 자료들이 공개한 범위 안에서 잡은 **대표값(MODELED_BASELINE)**이며, 사내 고유 엔지니어링 라우트 시트를 재현한 것은 아니다. 구조(무엇이 왜 반복·분기하는지)의 정확도를 우선했다.

> 이 문서의 `전체 공정`은 실제 수백 개 장비 레시피를 모두 나열한 것이 아니라, P01~P10 대공정 코드와 operation code로 묶은 **시스템 모델 라우트**다. 아래 스텝 수는 시뮬레이션 방문 횟수이며 실제 장비 공정 수와 같지 않다.

설비 Capacity를 계산할 때 이 반복수를 그대로 `wafer-pass`로 사용하지 않는다. 장비군·레시피별 실제 `capacityVisitsPerWafer`는 [`fab-equipment-master.md`](./fab-equipment-master.md)의 계약으로 별도 승인한다.

## 공통 축약 표기

| 코드 | 이름 | 역할 |
|---|---|---|
| P01 | 산화막 (Oxidation) | 절연막·게이트 산화막 형성 |
| P02 | CVD | 유전체·보호막 등 박막 증착 |
| P03 | 포토 (Photo) | 감광막 도포·노광·현상 |
| P04 | 식각 (Etching) | 패턴 전사, 선택적 제거 |
| P05 | 이온주입 (Ion Implant) | 도펀트 주입, 트랜지스터 특성 형성 |
| P06 | 금속배선1 (Metallization) | 금속막 증착·패터닝 |
| P07 | CMP | 표면 평탄화 |
| P08 | TSV/박막화 | 관통전극·조건부 Edge Trim·Backgrind/Reveal |
| P09 | 웨이퍼테스트 | 전기특성 검사, 양/불량 분류 |
| P10 | Packaging | Dicing·Singulation·Die Sort·제품별 조립·몰딩·최종검사; M20에서는 Base Die와 Memory KGD 합류 |

---

## 한눈에 보는 3팹 라우트

| Fab | 기준 제품 | 핵심 흐름 | 현재 모델 상태 | 총 모델 스텝 |
|---|---|---|---|---:|
| M20 | HBM4 12-Hi | DRAM Front-end → TSV/박막화 → 재검 → P10 패키징(싱귤레이션·Base Die 합류·12단 적층) | **DB 연결 / M20:HBM:V3** | **140** |
| M21 | DDR5 16Gb | DRAM Front-end → EDS → Singulation → conventional 단일 다이 패키징(8단계) | **문서 승인 / M21:DRAM:V1, DB 미연결** | **120** |
| M22 | 3D NAND 321단(V9) | 주변 CMOS → 3-deck 수직 스택 → deck별 채널홀·Staircase·게이트 리플레이스먼트 → EDS → 16단 와이어본딩 패키징 | **문서 승인 / M22:NAND:V1, DB 미연결** | **256** |

M20만 현재 DB에 실행 연결된 Route Master다. M21·M22는 [`fab-master.md`](./fab-master.md)에서 확정한 기준 제품(DDR5 16Gb / 321단 1Tb TLC)을 근거로 이 문서에서 스텝 구조를 승인했으나, `routeMaster` 컬렉션과 실행 원장 연결은 아직 구현되지 않았다.

---

## M20 · HBM

HBM 다이는 곧 DRAM 다이다. 즉 **일반 DRAM 프런트엔드 공정(약 700스텝, [Applied Materials](https://www.appliedmaterials.com/us/en/newsroom/blogs/hbm--materials-innovation-propels-high-bandwidth-memory-into-the.html))을 그대로 거친 뒤**, 그 위에 **TSV(관통전극) 형성을 위한 약 19개의 추가 공정**(프런트사이드 10개 + 웨이퍼를 뒤집은 뒤 백사이드 9개)이 더해져 HBM이 된다. 이 추가 구간이 HBM을 DRAM과 구분 짓는 핵심이다.

### M20 전체 모델 라우트 — DB 반영 기준

| 순서 | 구간 | 시스템 Cycle | 반복 | 모델 스텝 수 | 문서 스텝 | 물리적 운반 단위 |
|---:|---|---|---:|---:|---:|---|
| 1 | 산화막 형성 | P01 | 4회 | 4 | 1~4 | FOUP / wafer |
| 2 | DRAM 셀 어레이 | P03 → P04 → P02 → P07 | 22회 | 88 | 5~92 | FOUP / wafer |
| 3 | BEOL 금속배선 | P02 → P03 → P04 → P06 → P07 | 5회 | 25 | 93~117 | FOUP / wafer |
| 4 | 1차 웨이퍼 테스트 | P09 | 1회 | 1 | 118 | FOUP / wafer |
| 5 | TSV 프런트사이드 | P08 | 1회 | 1 | 119 | FOUP / wafer |
| 6 | Edge Trim | P08.`EDGE_TRIM` | 1회 | 1 | 120 | FOUP / wafer |
| 7 | 백그라인딩·박막화 | P08.`BACKGRIND_THINNING` | 1회 | 1 | 121 | FOUP / wafer |
| 8 | TSV 백사이드 | P08.`TSV_BACK` | 1회 | 1 | 122 | FOUP / wafer |
| 9 | 2차 웨이퍼 테스트 | P09.`WAFER_TEST` | 1회 | 1 | 123 | FOUP / wafer |
| 10 | Dicing / Singulation | P10.`DICING` | 1회 | 1 | 124 | wafer → Memory KGD |
| 11 | Die Sort / KGD staging | P10.`DIE_SORT_KGD` | 1회 | 1 | 125 | Memory KGD / tray |
| 12 | Base Die Attach | P10.`BASE_DIE_ATTACH` | 1회 | 1 | 126 | Memory KGD + 외부 Base KGD → stack |
| 13 | DRAM 12-Hi Bond | P10.`DRAM_BOND_12H` | **12회** | 12 | 127~138 | stack |
| 14 | MUF·Molding·Cure | P10.`MUF_MOLDING_CURE` | 1회 | 1 | 139 | stack |
| 15 | Final Test | P10.`FINAL_TEST` | 1회 | 1 | 140 | good package |
| 합계 |  |  |  | **140** | **1~140** |  |

`M20:HBM:V3`는 12단이 **DRAM Memory Die 12개**라는 뜻임을 명시한다. Logic Base Die 1개는 외부 Logic Fab/Foundry에서 KGD로 입고되고 P10.`BASE_DIE_ATTACH`에서 합류한다. M20 117K WSPM에는 Base Die wafer starts·전공정 설비·수율을 포함하지 않는다.

기존 `M20:HBM` V1과 분리형 V2(P11)는 과거 진행 lot 재현용으로 보존한다. 신규 lot은 active V3를 사용하며 자재 소비점은 `processCode` 단독이 아니라 `routeKey + routeVersion + operationCode`로 식별한다. 화면은 V2의 P11 이력을 P10으로 정규화해 표시한다.

문서의 스텝 번호는 읽기 쉬운 1-based다. 코드의 `stepIndex`는 0-based이므로 문서 123번은 코드에서 `stepIndex: 122`다.

```
[1단계 · 프론트엔드 — DRAM 코어 회로 형성 (M21과 동일 구조)]
P01(산화막) × 3~5회 (STI 라이너, 게이트 산화막 등)
  ↓
{ P03(포토) → P04(식각) → P02(증착) 또는 P05(이온주입) → P07(CMP) } × 20~25회 반복
  — 셀 어레이(커패시터/트랜지스터) 형성 — 이 구간엔 아직 금속배선이 없음
  ↓
{ P02(층간절연막 증착) → P03(포토) → P04(트렌치·비아 식각) → P06(금속 충진, Cu 다마신) → P07(CMP) } × 4~6회 반복
  — 금속배선(BEOL): 층(M1, M2, M3…)마다 이 사이클을 새로 돎. 로직 BEOL은 최대 15층까지도 가지만
    DRAM은 회로가 단순해 보통 3~6개 Mx층 범위([imec BEOL 로드맵](https://www.imec-int.com/en/articles/view-logic-technology-roadmap))
  ↓
P09(웨이퍼테스트) — 1차, EDS/KGD(Known Good Die) 선별

[분기점 — HBM 전용, 프런트사이드 TSV]
  ↓
P08(TSV/배선2) — 프런트사이드: 실리콘에 고종횡비 트렌치(비아) 식각 → 절연 라이너 증착 → 배리어/시드 PVD → Cu 도금 충진
  → CMP로 표면 오버버든 제거. 현재 TSV 지름은 ~5μm(차세대 3μm 이하로 축소 추세)
  ↓
백그라인딩(웨이퍼 뒷면 연마·박막화) → 웨이퍼 뒤집기
  ↓
P08(TSV/배선2) — 백사이드: TSV 노출(리빌) → 백사이드 절연/배리어 → 마이크로범프(UBM) PVD·도금 형성
  ↓
P09(웨이퍼테스트) — 2차, 적층 전 재검 (불량 다이가 스택에 섞이면 스택 전체가 낭비되므로 필수)

[2단계 · 3D 적층 패키징]
  ↓
P10(Dicing/Singulation → Die Sort/KGD)
  ↓
외부 Logic Base Die KGD 1개 + Memory KGD 12개 동시 예약
  ↓
P10(Base Die Attach → DRAM Bond ×12 → MR-MUF/Molding/Cure → Final Test)
```

**분기 요약**: P09(1차) 이후 프런트사이드 P08 → 백그라인딩 → 백사이드 P08 → P09(2차)로 이어지는 것이 HBM 고유 경로다. DRAM/NAND는 이 경로를 타지 않는다.

---

## M21 · DRAM

M20 1단계(프론트엔드)와 구조가 동일하다 — HBM 다이 자체가 DRAM이며, DRAM 700+ 스텝 위에 HBM 전용 19스텝이 얹히는 가산 구조이기 때문이다([Applied Materials](https://www.appliedmaterials.com/us/en/newsroom/blogs/hbm--materials-innovation-propels-high-bandwidth-memory-into-the.html)). M21은 이 HBM 전용 19스텝(TSV front/back)이 **전부 빠지고**, 적층 없는 conventional 단일 다이 패키징으로 끝난다. 기준 제품은 SK hynix DDR5 16Gb 다이(다이 면적 75.21 mm²)로 확정한다.

### M21 전체 모델 라우트 — DB 반영 예정 기준 (`M21:DRAM:V1`)

| 순서 | 구간 | 시스템 Cycle | 반복 | 모델 스텝 수 | 문서 스텝 | 물리적 운반 단위 |
|---:|---|---|---:|---:|---:|---|
| 1 | 산화막 형성 | P01 | 4회 | 4 | 1~4 | FOUP / wafer |
| 2 | DRAM 셀 어레이 | P03 → P04 → P02 → P07 | 22회 | 88 | 5~92 | FOUP / wafer |
| 3 | BEOL 금속배선 | P02 → P03 → P04 → P06 → P07 | 5회 | 25 | 93~117 | FOUP / wafer |
| 4 | 웨이퍼 테스트(EDS) | P09 | 1회 | 1 | 118 | FOUP / wafer |
| 5 | Dicing / Singulation | P10.`DICING` | 1회 | 1 | 119 | wafer → die |
| 6 | Backgrind(단일-패스) | P10.`SDP_BACKGRIND` | 1회 | (119에 통합) | 119 | die |
| 7 | Die Attach | P10.`DIE_ATTACH` | 1회 | 1 | 120 | die → 리드프레임/기판 |
| 합계 |  |  |  | **120** | **1~120** |  |

문서 스텝 119~120은 SK hynix 공개 conventional 패키징 8단계([SK hynix Newsroom](https://news.skhynix.com/semiconductor-back-end-process-episode-6-conventional-packages/): Backgrind → Dicing → Die Attach → Wire Bond/Flip-chip → Molding → Marking → Lead Finish/Ball Mount → Singulation) 중 시스템 모델이 추적하는 대표 경계(웨이퍼 릴리스 시점)까지만 반영한다. Die Attach 이후 Wire Bond·Molding·Marking·Lead Finish·최종 Singulation은 `operationCode` 세부 단계로 material-consumption-master.md에서 개별 자재 소비점으로만 다룬다(Route 스텝 수를 늘리지 않음 — 이유는 M20의 P10이 물리 carrier 전환(FOUP→Memory KGD→Stack)이 있는 지점만 스텝으로 센 것과 동일 원칙).

`M21:DRAM:V1`는 TSV 없는 conventional 패키징 흐름을 승인한 버전이며, M20의 route 반복수를 복사한 것이 아니라 동일한 DRAM 프런트엔드 물리 공정(Applied Materials 근거)에서 독립적으로 도출한 결과가 M20과 일치한 것이다.

```
[프론트엔드 — DRAM 코어 회로 형성, M20과 동일 구조]
P01(산화막) × 4회 (STI 라이너, 게이트 산화막 등)
  ↓
{ P03(포토) → P04(식각) → P02(증착) 또는 P05(이온주입) → P07(CMP) } × 22회 반복 — 셀 어레이 형성
  ↓
{ P02(층간절연막 증착) → P03(포토) → P04(트렌치·비아 식각) → P06(금속 충진) → P07(CMP) } × 5회 반복 — BEOL
  ↓
P09(웨이퍼테스트) — EDS, 1회만 (적층이 없어 재검 불필요)

[백엔드 — conventional 단일 다이 패키징, P08(TSV) 없음]
  ↓
Backgrinding(단일-패스, 200~250μm까지만 — TSV reveal용 초박막화 아님)
  ↓
P10(Dicing/Singulation → Die Attach: DAF 또는 접착제로 리드프레임/기판에 부착)
  ↓
[Route 스텝 경계 밖 — 자재 소비점으로만 추적] Wire Bond(Au/Cu) → Molding(EMC) → Marking → Lead Finish/Ball Mount → Singulation → Final Test
```

**M20 대비 차이**: P09가 1회뿐이고(2회였던 M20과 달리 적층 전 재검이 불필요), P08(TSV front/back) 분기가 통째로 없다. P10은 "다른 다이와의 적층"이 아니라 "리드프레임/기판과의 단일 실장"으로 끝난다.

---

## M22 · NAND

3D NAND는 프런트엔드 구조 자체가 DRAM/HBM과 다르다. 커패시터 대신 **산화막/질화막을 번갈아 수백 층 쌓은 뒤, 그걸 수직으로 관통하는 채널 홀을 뚫는** 방식이라 P02(증착)의 반복 비중이 압도적으로 크고, 층수 자체가 DRAM 금속배선보다 훨씬 많다. 2024~2025년 기준 SK하이닉스 321단, 삼성 300단대 제품이 이미 양산 단계([Blocks & Files](https://www.blocksandfiles.com/flash/2023/08/18/samsung-has-300-layer-nand-coming-with-430-layers-after-that-report/1612557), [Yole Group](https://www.yolegroup.com/industry-news/sk-hynix-announces-production-of-its-321-layer-nand-flash-shipments-will-start-in-the-first-half-of-2025/))이며 400층대가 다음 세대로 예고돼 있다.

셀 구조는 W/TiN 게이트 전극, AlO 블로킹막, 질화막 전하트랩층, 터널링 산화막, 중심부 폴리실리콘 채널로 구성된다([Applied Materials 3D NAND](https://www.appliedmaterials.com/us/en/semiconductor/markets-and-inflections/memory/3d-nand.html)).

### M22 전체 모델 라우트 — DB 반영 예정 기준 (`M22:NAND:V1`)

기준 제품을 SK hynix 321단(V9) 1Tb TLC로 확정하면서 아래 변수들이 구체적 정수로 결정됐다.

| 변수 | 값 | 근거 |
|---|---:|---|
| 적층 단수 | 321 | SK hynix V9 공개 사양 |
| Deck 수 | 3 | 단일 식각 장비의 층수 한계(~100층)로 "3-plug" 공정을 씀([SK hynix](https://news.skhynix.com/how-sk-hynixs-advanced-4d-nand-technologies-are-overcoming-stacking-limitations/)) |
| `C_cmos` (주변 CMOS 반복) | 3 | 대표값, `MODELED_BASELINE` |
| `L_beol` (주변 금속배선 층수) | 3 | 대표값, `MODELED_BASELINE` |
| `D_pair` (산화막·질화막 페어 적층) | 161 | 321층 ÷ 2 (홀수라 올림) |
| `E_channel` (채널홀 식각) | 3 | deck당 1회, deck 수와 동일([SK hynix](https://news.skhynix.com/how-sk-hynixs-advanced-4d-nand-technologies-are-overcoming-stacking-limitations/)) |
| `S_stair` (Staircase 반복) | 21 | deck당 대표 7회 × 3 deck, `LOW·MODELED_BASELINE`(정확한 321단 전용 분할수는 미공개) |
| `R_gate` (게이트 치환) | 3 | deck당 1회 — SK hynix는 "word line과 staircase를 동시 형성"한다고 명시, deck 단위 반복이 구조적으로 타당 |
| `C_cmp` (평탄화) | 7 | deck 스택 3 + 게이트 치환 3 + 최종 1 |
| `P_pkg` (와이어본딩 적층) | 16 | 공개된 와이어본딩 다이 적층 상한 사례([IEEE](https://ieeexplore.ieee.org/document/8277544/)) |

| 순서 | 구간 | 시스템 Cycle | 반복 | 모델 스텝 수 | 문서 스텝 | 물리적 의미 |
|---:|---|---|---:|---:|---:|---|
| 1 | 주변 CMOS | P01 → P03 → P04 → P05 → P07 | 3회 | 15 | 1~15 | 주변 제어 트랜지스터 형성 |
| 2 | 주변 금속배선 | P06 | 3층 | 3 | 16~18 | 셀 어레이 하부/주변 배선 |
| 3 | NAND 스택 증착 | P02 | 161회 | 161 | 19~179 | 산화막·질화막 페어 적층(3 deck 누적) |
| 4 | Deck별 채널홀 식각 | P04 | 3회(deck당 1) | 3 | 180~182 | 3-deck 관통, deck마다 독립 식각 |
| 5 | ONO·채널 충진 | P02 | 1세트 | 1 | 183 | 메모리막·폴리실리콘 채널 형성 |
| 6 | Deck별 Staircase | P03 → P04 | 21회(7×3 deck) | 42 | 184~225 | 워드라인 접점 노출, deck 단위 |
| 7 | Deck별 Slit·게이트 치환 | P04 → P06 | 3회(deck당 1) | 6 | 226~231 | 희생 질화막(H₃PO₄) 제거·텅스텐 충진 |
| 8 | 평탄화 | P07 | 7회 | 7 | 232~238 | 스택 3 + 게이트치환 3 + 최종 1 |
| 9 | 웨이퍼 테스트 | P09 | 1회 | 1 | 239 | EDS |
| 10 | NAND Singulation | P10.`DICING` | 1회 | 1 | 240 | wafer → NAND die |
| 11 | 16단 와이어본딩 패키징 | P10.`NAND_PACKAGE` | 16회 | 16 | 241~256 | Die Attach·Wire Bond 적층 반복 |
| 합계 |  |  |  | **256** | **1~256** |  |

`Wafer/FOUP 구간`(step 1~239, Dicing 진입 전)이 M20(123스텝)·M21(118스텝)보다 훨씬 긴 것은 321단 적층 특유의 반복 증착·deck별 식각·계단·게이트치환이 누적되기 때문이며, 오류가 아니다.

```
[주변 회로 — CMOS 트랜지스터, 셀 어레이보다 먼저 형성 (CMOS-under-Array 구조)]
{ P01(산화막) → P03(포토) → P04(식각) → P05(이온주입) → P07(CMP) } × 3회
  ↓
P06(금속배선) × 3층 — 이후 셀 어레이가 그 위에 얹힘

[스택 형성 — 3-deck × ~107층, deck마다 독립 반복]
{ P02(증착) } × 161회 (산화막/질화막 페어를 321단÷2만큼 누적 증착, 3 deck에 걸쳐 수행)
  ↓
{ P04(식각) } × 3회 — deck마다 별도 채널 홀 식각(단일 식각 장비의 ~100층 한계 때문에 deck당 1회씩 3번)
  ↓
P02(증착) — 터널링 산화막·전하트랩(질화막)·블로킹막(AlO)·채널 폴리실리콘 충진 (ONO 스택, 1세트)
  ↓
{ P03(포토) → P04(식각) } × 21회(deck당 7회 × 3 deck) — 계단식(Staircase) 워드라인 콘택 형성
  ↓
{ P04(식각) → P06(CVD 텅스텐) } × 3회(deck당 1) — 슬릿 식각 → 습식 희생 질화막(H₃PO₄) 제거 → 텅스텐 워드라인 충진
  ↓
P07(CMP) × 7회 — deck 스택 3 + 게이트치환 3 + 최종 평탄화 1

  ↓
P09(웨이퍼테스트) — EDS, 1회
  ↓
P10(Dicing/Singulation → Die Attach → Wire Bond × 16단 적층 → Molding → Final Test)
  — P08(TSV) 없음, 적층은 와이어본딩 기반
```

**M20/M21 대비 차이**: 반복의 주역이 `P03→P04`(포토·식각 페어)가 아니라 `P02`(스택 증착, 161회)와 deck별 채널홀/슬릿 식각이고, 반복 단위가 M20/M21의 4~6층(DRAM 금속배선)이 아니라 321단/3-deck다. P08(TSV) 분기가 없고, 패키징 단계의 다이 적층은 TSV 기반이 아니라 16단 와이어본딩 기반이라 M20의 P08 경로와는 완전히 다른 방식이다. 주변 회로(CMOS)가 셀 어레이보다 먼저 만들어진다는 점도 M20/M21과 다르다. 텅스텐 게이트 충진(GAS-007 WF₆)은 321단(V9)에서도 유지되며, 몰리브덴 전환은 375단 이후 세대 계획이라 이 버전에는 반영하지 않는다.

---

## 3팹 비교 요약

| 구분 | M20 · HBM4 12-Hi | M21 · DDR5 16Gb | M22 · NAND 321단 |
|---|---|---|---|
| 현재 구현 상태 | DB 연결, V3 140스텝 | 문서 승인, DB 미연결, 120스텝 | 문서 승인, DB 미연결, 256스텝 |
| 반복이 가장 큰 구간 | 셀 22회 + BEOL 5회 + P10 Bond 12회 | 셀 22회 + BEOL 5회 | P02 스택 증착 161회 + deck별 Staircase 21회×3 |
| P08(TSV) 분기 | 있음 (프런트사이드 + 백사이드, 총 2회) | 없음 | 없음 |
| P09(웨이퍼테스트) 횟수 | 2회 (1차 EDS + 2차 적층 전) | 1회 (EDS) | 1회 (EDS) |
| P10 Packaging | Singulation 후 HBM 전용 Base Die merge·12-Hi TSV 적층 | Singulation 후 conventional 단일 다이 package | Singulation 후 16단 와이어본딩 적층 |
| 금속배선(P06) 특징 | 프론트엔드 BEOL 5층 | 프론트엔드 BEOL 5층 | 주변 BEOL 3층 + deck별 텅스텐 게이트 리플레이스먼트 3회 |
| 적층/스택 구조 | 12층, TSV 관통 | 없음(단일 다이) | 321단, 3-deck × ~107층 |

---

## 구현 연결 상태와 다음 단계

| 항목 | 상태 |
|---|---|
| M20 `routeMaster` | 구현됨 — active `M20:HBM:V3`, 15개 노드, 140스텝; V1/V2 보존 |
| HBM4 12-Hi | 구현됨 — `P10.DRAM_BOND_12H`, `repeatCount: 12` |
| M20 실행 원장 | 구현됨 — `waferLots`, `waferLotStepEvents`, 12개 FOUP 타임랩스 추적 |
| 패키징 자재 연결 | 구현됨 — `route/version/operation` scope, P10 MUF 진입 시 파일럿 트리거 |
| M21 `routeMaster` | 구현됨 — `M21:DRAM:V1`, 120스텝, DB 시딩 완료 |
| M22 `routeMaster` | 구현됨 — `M22:NAND:V1`, 256스텝, 3-deck 321단, DB 시딩 완료 |
| M20 설비 Capacity 연결 | 구현됨 — M20 329대; P10 Packaging 36대의 5개 native-stage capacity |
| M21·M22 설비 Capacity | 구현됨 — `fab-equipment-master.md` 기준 M21 495대, M22 533대, `equipmentMaster` DB 원장 연결 완료(P10은 여전히 `RATE_TBD`) |
| FOUP → Die/Stack carrier 전환 | Route 단위 전환은 정의됨; 물리 Die/Stack 개별 원장은 후속 구현 |
| 다이싱·본딩·몰딩·최종검사 세부 노드 | M20 V4 P10 operation node로 구현됨; M21·M22는 문서 단계(`RATE_TBD`) |

다음 구현 우선순위는 M20의 모델 반복수와 설비용 capacity visit 분리, P05 물리 방문 전개, 패키징 세부 노드 및 FOUP/Die/Stack WIP 분리, **M21·M22 route/equipment 문서를 `routeMaster`·`equipmentMaster` 컬렉션과 실행 원장에 연결하는 마이그레이션**이다. 3D 화면의 5초 간격 이동은 실제 가공시간이 아니라 정의된 라우트를 순서대로 보여주는 타임랩스다.

### 모델 해석 각주

- M20 대표 셀 사이클에 P05가 없다고 해서 이온주입 물리 공정이 없다는 뜻은 아니다. V3도 P02/P05 선택 분기를 선형 대표 경로로 단순화했으며 P05 capacity는 별도로 정의한다.
- 문서 스텝은 1-based이고 코드 `stepIndex`는 0-based다.
- 물리적 운반 단위와 시스템 추적 식별자를 구분한다. V3 Route는 P10 내부 operation 경계에서 wafer→Memory KGD→stack 전환을 정의하지만 현재 실행 원장은 물리 carrier별 개별 lot ledger까지 분리하지 않았다.

---

## 시뮬레이션 배속 가정 (3D 실시간 추적)

`ProcessFlow3D`/`LotRouteTrackerCard`의 FOUP 실시간 추적은 `AUTO_ADVANCE_INTERVAL_MS`(`src/lib/lot-route.ts`) 간격마다 스텝을 1개씩 자동 진행시킨다. 이건 실제 소요 시간을 재현한 시뮬레이션이 아니라 **흐름과 WMS/발주 트리거 로직이 눈에 보이게 계속 돌아가게 하는 데모용 타임랩스**다.

| 구분 | 값 |
|---|---|
| 실제 웨이퍼 투입 → 패키징 완료 (업계 공개 자료 기준 대략치) | 약 3~4개월 (90~120일) |
| 이 시스템의 HBM4 12-Hi V3 라우팅 140스텝 완주 시간 (5초/스텝 × 140) | 약 11.7분 (700초) |
| 배속 | 약 **12,000 ~ 16,000배** |

**가정과 한계**: 위 배속은 140스텝에 5초씩 균등하게 배분했다는 가정 위에서 나온 평균치다. 실제로는 스텝마다 걸리는 시간이 균일하지 않고(설비 대기·큐잉이 실가공 시간보다 훨씬 크게 작용), 노드별 상대적 소요 비중도 이 시뮬레이션엔 반영돼 있지 않다.

---

## 출처

- [Applied Materials — HBM: Materials Innovation Propels High-Bandwidth Memory Into the AI Era](https://www.appliedmaterials.com/us/en/newsroom/blogs/hbm--materials-innovation-propels-high-bandwidth-memory-into-the.html) — DRAM ~700스텝 + HBM 전용 ~19스텝(프런트 10 + 백 9), TSV 지름·마이크로범프 공정
- [Applied Materials — 3D NAND](https://www.appliedmaterials.com/us/en/semiconductor/markets-and-inflections/memory/3d-nand.html) — 셀 구성 물질(W/TiN 게이트, AlO, 질화막, 채널 폴리), CMOS-under/over-Array, 게이트 리플레이스먼트·텅스텐 충진
- [SK hynix Newsroom — Semiconductor Back-End Process Episode 4: Packages Part 2](https://news.skhynix.com/semiconductor-back-end-process-episode-4-packages-part-2/) — TSV·패키지 스택·칩 스택 정의
- [Samsung Newsroom — Industry's First 12-Layer 3D-TSV Chip Packaging Technology](https://news.samsung.com/global/samsung-electronics-develops-industrys-first-12-layer-3d-tsv-chip-packaging-technology) — 12-Hi 스택, TSV 홀 6만개+, 8-Hi 대비 두께 유지
- [SK hynix — World's First 12-Layer HBM4 Samples](https://news.skhynix.com/sk-hynix-ships-world-first-12-layer-hbm4-samples-to-customers/) — HBM4 12-Hi, 36GB, Advanced MR-MUF
- [Samsung — Commercial HBM4 Shipment](https://news.samsung.com/global/samsung-ships-industry-first-commercial-hbm4-with-ultimate-performance-for-ai-computing) — HBM4 12-layer 상용 출하와 24~36GB 구성
- [Micron — Intro to Fabrication (공식 교육자료 PDF)](https://www.micron.com/content/dam/micron/educatorhub/fabrication/micron-intro-to-fabrication-presentation.pdf) — 트랜지스터 게이트(TG)·콘택(CN)·M1 다마신 공정 스텝 단위 설명
- [imec — A View on the Logic Technology Roadmap](https://www.imec-int.com/en/articles/view-logic-technology-roadmap) — BEOL 금속층 수 범위(Mx 3~6층, 최대 15층)
- [SemiEngineering — Advanced Patterning Techniques For 3D NAND Devices](https://semiengineering.com/advanced-patterning-techniques-for-3d-nand-devices/) — 32P/64P/96P 노드별 슬릿·계단(Staircase) 패터닝 구조
- [Blocks & Files — Samsung has 300-layer NAND coming, with 430 layers after that](https://www.blocksandfiles.com/flash/2023/08/18/samsung-has-300-layer-nand-coming-with-430-layers-after-that-report/1612557) / [Yole Group — SK hynix 321-layer NAND](https://www.yolegroup.com/industry-news/sk-hynix-announces-production-of-its-321-layer-nand-flash-shipments-will-start-in-the-first-half-of-2025/) — 2024~2025년 기준 3D NAND 층수
- [SK hynix Newsroom — How SK hynix's Advanced 4D NAND Technologies Are Overcoming Stacking Limitations](https://news.skhynix.com/how-sk-hynixs-advanced-4d-nand-technologies-are-overcoming-stacking-limitations/) — 321단 3-deck(3-plug) 구조, deck당 channel-hole 식각·word line staircase 동시 형성
- [TechInsights — SK hynix H25GTD0 321-Layer V9 1Tb TLC 3D NAND Process Flow Analysis](https://www.techinsights.com/blog/sk-hynix-h25gtd0-321-layer-v9-1-tb-tlc-3d-nand-process-flow-analysis) — 346 word line 실측, die area 43.54 mm²
- [Blocks & Files — SK hynix begins mass production of 321-layer 3D NAND](https://www.blocksandfiles.com/ai-ml/2024/11/21/sk-hynix-begins-mass-production-of-321-layer-3d-nand/1605947) — "triple stack... each around 100 layers" 확인
- [SemiAnalysis — Interconnects: Beyond Copper](https://newsletter.semianalysis.com/p/interconnects-beyond-copper-1000) — V8→V9 전체 스텝 30%·식각 스텝 20% 증가
- [AZoM — 3D NAND Fabrication and Hot Phosphoric Acid Nitride Strip](https://www.azom.com/article.aspx?ArticleID=20124) — 게이트 리플레이스먼트(H₃PO₄ strip → 텅스텐 충진) 공정 확인
- [wccftech — SK Hynix 400+ Layer NAND, Tungsten to Molybdenum](https://wccftech.com/sk-hynix-races-samsung-to-400-layer-nand-must-abandon-tungsten-as-stacking-hits-a-wall/) — 텅스텐→몰리브덴 전환은 375단 이후 세대 계획
- [IEEE — Yauw et al., Leading Edge Die Stacking and Wire Bonding Technologies](https://ieeexplore.ieee.org/document/8277544/) — 16단 와이어본딩 다이 적층 상한 사례
- [Leachman & Kang — SLIM: Short Cycle Time and Low Inventory in Manufacturing at Samsung Electronics (Interfaces, 2002)](https://pubsonline.informs.org/doi/10.1287/inte.32.1.61.15) — DRAM 웨이퍼 사이클타임 80일→30일 미만 단축 실측
- [SK hynix Newsroom — Semiconductor Back-End Process Episode 6: Conventional Packages](https://news.skhynix.com/semiconductor-back-end-process-episode-6-conventional-packages/) — conventional 8단계 패키징 흐름
- [TechInsights / EE Times — DDR5 Micron vs Samsung vs SK hynix 다이 비교](https://www.eetimes.com/comparing-ddr5-memory-from-micron-samsung-sk-hynix/) — SK hynix DDR5 16Gb 다이 면적 75.21 mm²
