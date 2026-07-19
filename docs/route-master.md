# Fab Route Master — HBM · DRAM · NAND 공정 흐름 정의

## 목적

`src/lib/processes.ts`의 `PROCESSES`는 P01~P10이라는 공통 공정 코드를 정의하지만, 실제 팹은 제품마다 이 공정을 **몇 번, 어떤 순서로, 어디서 갈라지며** 도는지가 다르다. 이 문서는 그 반복·분기 구조를 제품별로 정의하고, `routeMaster` 컬렉션(DB)과 공정 시각화의 기준으로 사용한다.

연결된 기준 문서:

- [`fab-master.md`](./fab-master.md): M20 평균 WSPM, 정상 WIP, 증산 경계
- [`material-consumption-master.md`](./material-consumption-master.md): M20 wafer 1장당 자재 원단위와 시나리오 소요량

**표기 원칙**: 여기 적힌 스텝 순서·자재·구조는 문서 하단 [출처](#출처)에 정리한 업계 공개 자료(Applied Materials, SK하이닉스 뉴스룸, Samsung Newsroom, imec, SemiEngineering, Micron 공식 교육 자료 등)에 근거한다. 반복 횟수는 이 자료들이 공개한 범위 안에서 잡은 **대표값(MODELED_BASELINE)**이며, 사내 고유 엔지니어링 라우트 시트를 재현한 것은 아니다. 구조(무엇이 왜 반복·분기하는지)의 정확도를 우선했다.

> 이 문서의 `전체 공정`은 실제 수백 개 장비 레시피를 모두 나열한 것이 아니라, P01~P10 공정 코드로 묶은 **시스템 모델 라우트**다. 아래 스텝 수는 시뮬레이션 방문 횟수이며 실제 장비 공정 수와 같지 않다.

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
| P08 | TSV/배선2 | 관통전극·상부 금속배선 |
| P09 | 웨이퍼테스트 | 전기특성 검사, 양/불량 분류 |
| P10 | 패키징 | 다이싱·본딩·봉지·최종검사 |

---

## 한눈에 보는 3팹 라우트

| Fab | 기준 제품 | 핵심 흐름 | 현재 모델 상태 | 총 모델 스텝 |
|---|---|---|---|---:|
| M20 | HBM4 12-Hi | DRAM Front-end → TSV Front/Back → 재검 → 다이싱·12단 적층 | **DB 연결 / ROUTE_MASTER_V1** | **134** |
| M21 | DRAM | DRAM Front-end → EDS → 단일 다이 패키징 | 문서 초안 / DB 미연결 | **119 PROVISIONAL** |
| M22 | 3D NAND | CMOS → 수직 스택 → 채널홀·Staircase → EDS → NAND 패키징 | 변수 모델 / DB 미연결 | **TBD** |

M20만 현재 실행 가능한 Route Master다. M21의 119스텝은 M20과 같은 대표 Front-end 반복값을 적용한 비교용 초안이고, M22는 제품 단수와 구조가 정해져야 총 스텝을 계산할 수 있다.

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
| 6 | 백그라인딩 | P08 프록시 | 1회 | 1 | 120 | FOUP / wafer |
| 7 | TSV 백사이드 | P08 | 1회 | 1 | 121 | FOUP / wafer |
| 8 | 2차 웨이퍼 테스트 | P09 | 1회 | 1 | 122 | FOUP / wafer |
| 9 | HBM4 12-Hi 패키징 | P10 | **12회** | 12 | **123~134** | die → 조립 중 stack → 완성 stack |
| 합계 |  |  |  | **134** | **1~134** |  |

따라서 현재 Route Master에는 **HBM4 12단 적층 기준이 반영되어 있다.** DB의 `M20:HBM` 패키징 노드는 `P10 × 12`이며, 전체 라우트는 134스텝이다.

다만 123~134번은 패키징의 실제 세부 레시피를 각각 구현한 것이 아니라, `다이싱 1회 → 다이 정렬·본딩 반복 → 몰딩 1회 → 최종검사 1회`를 **P10 12회로 축약한 12-Hi 모델 프록시**다. 현재 실행 원장은 패키징 구간에서도 동일한 `WaferLotDoc`과 `foupCode`를 134번까지 유지한다. 물리적으로는 다이싱부터 die/stack 단위로 바뀌지만, Die/Stack 개별 실행 원장과 carrier 전환은 아직 구현되지 않았다.

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
P10(패키징): 다이싱 → { 다이 정렬·본딩 } × 12회(HBM4 12-Hi 기준) → 몰딩(MR-MUF) → 최종검사
```

**분기 요약**: P09(1차) 이후 프런트사이드 P08 → 백그라인딩 → 백사이드 P08 → P09(2차)로 이어지는 것이 HBM 고유 경로다. DRAM/NAND는 이 경로를 타지 않는다.

---

## M21 · DRAM

M20 1단계(프론트엔드)와 구조가 동일하다 — HBM 다이 자체가 DRAM이기 때문이다. 다만 **TSV·3D 적층이 없고**, 단일 다이 패키징으로 끝난다.

### M21 전체 모델 라우트 — 비교용 초안

| 순서 | 구간 | 시스템 Cycle | 대표 반복 | 모델 스텝 수 | 문서 스텝 | 물리적 운반 단위 |
|---:|---|---|---:|---:|---:|---|
| 1 | 산화막 형성 | P01 | 4회 | 4 | 1~4 | FOUP / wafer |
| 2 | DRAM 셀 어레이 | P03 → P04 → P02 → P07 | 22회 | 88 | 5~92 | FOUP / wafer |
| 3 | BEOL 금속배선 | P02 → P03 → P04 → P06 → P07 | 5회 | 25 | 93~117 | FOUP / wafer |
| 4 | 웨이퍼 테스트 | P09 | 1회 | 1 | 118 | FOUP / wafer |
| 5 | 단일 다이 패키징 | P10 | 1회 | 1 | 119 | die → package |
| 합계 |  |  |  | **119 PROVISIONAL** | **1~119** |  |

이 119스텝은 M20 Front-end의 대표 반복값을 재사용한 **PROVISIONAL 모델**이다. M21 Route Master는 아직 DB에 연결되지 않았으며, 실제 기준 제품과 반복 횟수가 확정되면 별도 버전으로 승인해야 한다.

```
P01(산화막) × 3~5회
  ↓
{ P03(포토) → P04(식각) → P02(증착) 또는 P05(이온주입) → P07(CMP) } × 20~25회 반복
  — 셀 어레이 형성 — 이 구간엔 아직 금속배선이 없음
  ↓
{ P02(층간절연막 증착) → P03(포토) → P04(트렌치·비아 식각) → P06(금속 충진) → P07(CMP) } × 4~6회 반복
  — 금속배선(BEOL, Cu 다마신 공정): 층마다 반복
  ↓
P09(웨이퍼테스트) — EDS
  ↓
P10(패키징): 다이싱 → 단일 다이 실장(와이어본딩 또는 플립칩) → 몰딩 → 최종검사
  — 적층 반복 없음 (1회), P08 없음
```

**M20 대비 차이**: P09 이후 P08(TSV) 분기가 통째로 없고, P10에서 다이 적층 반복(× N) 대신 단일 다이 실장으로 바로 끝난다.

---

## M22 · NAND

3D NAND는 프런트엔드 구조 자체가 DRAM/HBM과 다르다. 커패시터 대신 **산화막/질화막을 번갈아 수백 층 쌓은 뒤, 그걸 수직으로 관통하는 채널 홀을 뚫는** 방식이라 P02(증착)의 반복 비중이 압도적으로 크고, 층수 자체가 DRAM 금속배선보다 훨씬 많다. 2024~2025년 기준 SK하이닉스 321단, 삼성 300단대 제품이 이미 양산 단계([Blocks & Files](https://www.blocksandfiles.com/flash/2023/08/18/samsung-has-300-layer-nand-coming-with-430-layers-after-that-report/1612557), [Yole Group](https://www.yolegroup.com/industry-news/sk-hynix-announces-production-of-its-321-layer-nand-flash-shipments-will-start-in-the-first-half-of-2025/))이며 400층대가 다음 세대로 예고돼 있다.

셀 구조는 W/TiN 게이트 전극, AlO 블로킹막, 질화막 전하트랩층, 터널링 산화막, 중심부 폴리실리콘 채널로 구성된다([Applied Materials 3D NAND](https://www.appliedmaterials.com/us/en/semiconductor/markets-and-inflections/memory/3d-nand.html)).

### M22 전체 모델 라우트 — 변수 기반 초안

| 순서 | 구간 | 대표 시스템 Cycle | 반복 기준 | 모델 스텝 수 | 물리적 의미 |
|---:|---|---|---|---:|---|
| 1 | 주변 CMOS | P01 → P03 → P04 → P05 → P07 | `C_cmos`회 | `5 × C_cmos` | 주변 제어 트랜지스터 형성 |
| 2 | 주변 금속배선 | P06 | `L_beol`층 | `L_beol` | 셀 어레이 하부/주변 배선 |
| 3 | NAND 스택 증착 | P02 | `D_pair`회 | `D_pair` | 산화막·질화막 페어 적층 |
| 4 | 채널홀 식각 | P04 | `E_channel`회 | `E_channel` | 전체 스택을 수직 관통 |
| 5 | ONO·채널 충진 | P02 | 대표 1세트 | 1 | 메모리막·폴리실리콘 채널 형성 |
| 6 | Staircase | P03 → P04 | `S_stair`회 | `2 × S_stair` | 워드라인 접점 노출 |
| 7 | Slit·게이트 치환 | P04 → P06 | `R_gate`회 | `2 × R_gate` | 희생막 제거·텅스텐 충진 |
| 8 | 평탄화 | P07 | `C_cmp`회 | `C_cmp` | 주요 충진 이후 CMP |
| 9 | 웨이퍼 테스트 | P09 | 1회 | 1 | EDS |
| 10 | NAND 패키징 | P10 | `P_pkg`회 | `P_pkg` | 다이싱·와이어본딩 계열 적층·검사 |
| 합계 |  |  |  | **TBD / NOT MODELED** | 제품 단수·구조 확정 후 산출 |

`D_pair`는 단순 비교용으로 NAND 적층 단수의 약 절반 수준으로 볼 수 있지만, 실제 장비 레시피 횟수와 동일하다는 뜻은 아니다. M22는 기준 제품의 적층 단수, String Stacking 방식, Staircase 분할과 패키지 적층 수가 정해진 뒤 총 스텝을 확정한다.

```
[주변 회로 — CMOS 트랜지스터, 셀 어레이보다 먼저 형성되는 경우가 많음 (CMOS-under-Array 구조)]
{ P01(산화막) → P03(포토) → P04(식각) → P05(이온주입) → P07(CMP) } × 소수 반복
  ↓
P06(금속배선) × 소수 층 — 이후 셀 어레이가 그 위에 얹힘 (CMOS-over-Array 구조에서는 반대로 별도 웨이퍼에서 만들어 나중에 본딩)

[스택 형성 — NAND 고유 반복, 현재 200~300층대]
{ P02(증착) } × 층수/2 반복 (산화막/질화막 페어를 층수의 절반만큼 반복 증착 — 예: 321단이면 페어 약 160여 회)
  ↓
P04(식각) — 채널 홀 식각: 쌓인 스택 전체를 관통하는 초고종횡비 단일/단계 식각 (3D NAND 공정의 상징적 병목 스텝)
  ↓
P02(증착) — 터널링 산화막·전하트랩(질화막)·블로킹막(AlO)·채널 폴리실리콘 충진 (ONO 스택)
  ↓
{ P03(포토) → P04(식각) } × 계단수만큼 반복 — 계단식(Staircase) 워드라인 콘택 형성, 층마다 한 계단씩
  ↓
P04(식각) — 슬릿 식각 → 습식으로 희생 질화막 제거(리플레이스먼트 갭) → P06(CVD 텅스텐 금속배선)으로 워드라인 충진
  — 이 게이트 리플레이스먼트도 층수만큼 실질적으로 반복됨
  ↓
P07(CMP) — 매 증착·충진 단계마다 반복

  ↓
P09(웨이퍼테스트) — EDS
  ↓
P10(패키징): 다이싱 → 단일 또는 와이어본딩 기반 다이 적층(밀도용, TSV 아님) → 몰딩 → 최종검사
  — P08(TSV) 없음
```

**M20/M21 대비 차이**: 반복의 주역이 `P03→P04`(포토·식각 페어)가 아니라 `P02`(스택 증착)와 채널홀/슬릿 식각이고, 반복 단위가 4~6층(DRAM 금속배선)이 아니라 200~300층대다. P08(TSV) 분기가 없고, 패키징 단계의 다이 적층은 TSV 기반이 아니라 와이어본딩 기반이라 M20의 P08 경로와는 완전히 다른 방식이다. 주변 회로(CMOS)가 셀 어레이보다 먼저 만들어질 수 있다는 점도 M20/M21과 다르다.

---

## 3팹 비교 요약

| 구분 | M20 · HBM4 12-Hi | M21 · DRAM | M22 · NAND |
|---|---|---|---|
| 현재 구현 상태 | DB 연결, 134스텝 | 문서 초안, DB 미연결 | 변수 모델, DB 미연결 |
| 반복이 가장 큰 구간 | 셀 22회 + BEOL 5회 + P10 12회 | 셀 22회 + BEOL 5회 | P02 스택 증착 + Staircase |
| P08(TSV) 분기 | 있음 (프런트사이드 + 백사이드, 총 2회) | 없음 | 없음 |
| P09(웨이퍼테스트) 횟수 | 2회 (1차 EDS + 2차 적층 전) | 1회 (EDS) | 1회 (EDS) |
| P10 적층 방식 | `P10 × 12` 패키징 프록시 | 단일 다이 | 와이어본딩 계열, 반복 TBD |
| 금속배선(P06) 특징 | 프론트엔드 BEOL 3~6층 | 프론트엔드 BEOL 3~6층 | 워드라인 게이트 리플레이스먼트(텅스텐), 층수는 200~300+ |

---

## 구현 연결 상태와 다음 단계

| 항목 | 상태 |
|---|---|
| M20 `routeMaster` (`M20:HBM`) | 구현됨 — ROUTE_MASTER_V1, 9개 매크로 노드, 134스텝 |
| HBM4 12-Hi | 구현됨 — 패키징 노드 `P10`, `repeatCount: 12` |
| M20 실행 원장 | 구현됨 — `waferLots`, `waferLotStepEvents`, 12개 FOUP 타임랩스 추적 |
| 패키징 자재 연결 | 구현됨 — 첫 P10 진입 시 M20 파일럿 워크오더 트리거 |
| M21·M22 `routeMaster` | 미구현 — 본 문서의 초안/변수 모델만 존재 |
| FOUP → Die/Stack carrier 전환 | 미구현 — 현재는 패키징 완료까지 `foupCode` 유지 |
| 다이싱·본딩·몰딩·최종검사 세부 노드 | 미구현 — 현재 `P10 × 12` 프록시 |

다음 구현 우선순위는 M21·M22 기준 제품 확정과 DB Route Master 연결, M20 패키징 세부 노드 분리, FOUP WIP와 Die/Stack WIP 실행 원장 분리다. 3D 화면의 5초 간격 이동은 실제 가공시간이 아니라 정의된 라우트를 순서대로 보여주는 타임랩스다.

### 모델 해석 각주

- M20 대표 셀 사이클에 P05가 없다고 해서 이온주입 물리 공정이 없다는 뜻은 아니다. `ROUTE_MASTER_V1`이 P02 경로를 대표 사이클로 선택하고 P05 방문을 별도로 전개하지 않은 것이다.
- 문서 스텝은 1-based이고 코드 `stepIndex`는 0-based다.
- 물리적 운반 단위와 시스템 추적 식별자를 구분한다. 물리적으로는 다이싱 후 wafer가 die/stack으로 바뀌지만, 현재 시스템은 134번까지 같은 웨이퍼 로트와 `foupCode`를 유지한다.

---

## 시뮬레이션 배속 가정 (3D 실시간 추적)

`ProcessFlow3D`/`LotRouteTrackerCard`의 FOUP 실시간 추적은 `AUTO_ADVANCE_INTERVAL_MS`(`src/lib/lot-route.ts`) 간격마다 스텝을 1개씩 자동 진행시킨다. 이건 실제 소요 시간을 재현한 시뮬레이션이 아니라 **흐름과 WMS/발주 트리거 로직이 눈에 보이게 계속 돌아가게 하는 데모용 타임랩스**다.

| 구분 | 값 |
|---|---|
| 실제 웨이퍼 투입 → 패키징 완료 (업계 공개 자료 기준 대략치) | 약 3~4개월 (90~120일) |
| 이 시스템의 HBM4 12-Hi 라우팅 134스텝 완주 시간 (5초/스텝 × 134) | 약 11.2분 (670초) |
| 배속 | 약 **12,000 ~ 16,000배** |

**가정과 한계**: 위 배속은 134스텝에 5초씩 균등하게 배분했다는 가정 위에서 나온 평균치다. 실제로는 스텝마다 걸리는 시간이 균일하지 않고(설비 대기·큐잉이 실가공 시간보다 훨씬 크게 작용), 노드별(예: TSV 구간 vs 셀 어레이 반복 구간) 상대적 소요 비중도 이 시뮬레이션엔 반영돼 있지 않다. 노드별로 다른 간격을 주는 건 향후 개선 과제로 남겨둔다.

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
