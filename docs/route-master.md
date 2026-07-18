# Fab Route Master — HBM · DRAM · NAND 공정 흐름 정의

## 목적

지금 `src/lib/processes.ts`의 `PROCESSES`는 P01~P10을 하나의 고정 배열로 M20(HBM)·M21(DRAM)·M22(NAND) 전부에 동일하게 적용한다. 실제 팹은 제품마다 이 10개 공정을 **몇 번, 어떤 순서로, 어디서 갈라지며** 도는지가 다르다. 이 문서는 그 반복·분기 구조를 제품별로 정의해서, 이후 `routeMaster` 컬렉션(DB)과 `ProcessFlow3D` 시각화의 소스 데이터로 쓰기 위한 기준 문서다.

**표기 원칙**: 여기 적힌 스텝 순서·자재·구조는 문서 하단 [출처](#출처)에 정리한 업계 공개 자료(Applied Materials, SK하이닉스 뉴스룸, Samsung Newsroom, imec, SemiEngineering, Micron 공식 교육 자료 등)에 근거한다. 반복 횟수는 이 자료들이 공개한 범위 안에서 잡은 **대표값(MODELED_BASELINE)**이며, 사내 고유 엔지니어링 라우트 시트를 재현한 것은 아니다. 구조(무엇이 왜 반복·분기하는지)의 정확도를 우선했다.

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

## M20 · HBM

HBM 다이는 곧 DRAM 다이다. 즉 **일반 DRAM 프런트엔드 공정(약 700스텝, [Applied Materials](https://www.appliedmaterials.com/us/en/newsroom/blogs/hbm--materials-innovation-propels-high-bandwidth-memory-into-the.html))을 그대로 거친 뒤**, 그 위에 **TSV(관통전극) 형성을 위한 약 19개의 추가 공정**(프런트사이드 10개 + 웨이퍼를 뒤집은 뒤 백사이드 9개)이 더해져 HBM이 된다. 이 추가 구간이 HBM을 DRAM과 구분 짓는 핵심이다.

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
P10(패키징): 다이싱 → { 다이 정렬·본딩 } × 스택층수(현재 8-Hi 주력, 12-Hi 확대 중 — Samsung은 12층에 6만개 이상 TSV 홀 적용 사례 발표) 반복
  → 몰딩(EMC) → 최종검사
```

**분기 요약**: P09(1차) 이후 프런트사이드 P08 → 백그라인딩 → 백사이드 P08 → P09(2차)로 이어지는 것이 HBM 고유 경로다. DRAM/NAND는 이 경로를 타지 않는다.

---

## M21 · DRAM

M20 1단계(프론트엔드)와 구조가 동일하다 — HBM 다이 자체가 DRAM이기 때문이다. 다만 **TSV·3D 적층이 없고**, 단일 다이 패키징으로 끝난다.

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

| 구분 | M20 · HBM | M21 · DRAM | M22 · NAND |
|---|---|---|---|
| 반복이 가장 큰 구간 | P03↔P04 (셀 어레이) + BEOL 금속배선 | P03↔P04 (셀 어레이) + BEOL 금속배선 | P02 (스택 증착, 200~300+ 층) |
| P08(TSV) 분기 | 있음 (프런트사이드 + 백사이드, 총 2회) | 없음 | 없음 |
| P09(웨이퍼테스트) 횟수 | 2회 (1차 EDS + 2차 적층 전) | 1회 (EDS) | 1회 (EDS) |
| P10 적층 방식 | TSV 기반 다이 스택 (8-Hi 주력 → 12-Hi 확대) | 단일 다이 (반복 없음) | 와이어본딩 기반 (TSV 아님) |
| 금속배선(P06) 특징 | 프론트엔드 BEOL 3~6층 | 프론트엔드 BEOL 3~6층 | 워드라인 게이트 리플레이스먼트(텅스텐), 층수는 200~300+ |

---

## 다음 단계 (구현 연결)

이 문서는 코드가 아니라 **정의 단계**다. 이후 구현 시:

1. 신규 컬렉션 `routeMaster`: `{ _id: "{fabId}:{product}", fabId, product, nodes: [{ id, processCode, repeatCount, order }], edges: [{ from, to, condition? }], version, source: "MODELED_BASELINE", updatedAt }` — 이 문서의 각 팹 섹션을 그래프 데이터로 옮긴다.
2. `getProcessGuide()`의 `fabNote`를 "그래프 연결됨" 상태로 갱신.
3. `ProcessFlow3D.tsx`의 전역 상수 `WAFER_RECIPE`(현재 프론트엔드 하드코딩, 팹 구분 없음)를 `routeMaster`에서 가져온 팹·제품별 배열로 교체.
4. 시딩 순서는 M20(HBM)부터 — 유일하게 실제 실행 파이프라인(M20 파일럿)이 있어 최소한의 실데이터 대조가 가능하다. M21·M22는 같은 스키마로 2단계에서 확장.
5. 3D에서 "리얼타임"은 로트별 실행 상태 반영이 아니라 **정의된 라우팅 순서를 순서대로 보여주는 애니메이션**을 의미한다 — 로트 단위 공정 내부 이동을 추적하는 실행 원장은 이 시스템에 아직 없다(별도 과제).

---

## 시뮬레이션 배속 가정 (3D 실시간 추적)

`ProcessFlow3D`/`LotRouteTrackerCard`의 FOUP 실시간 추적은 `AUTO_ADVANCE_INTERVAL_MS`(`src/lib/lot-route.ts`) 간격마다 스텝을 1개씩 자동 진행시킨다. 이건 실제 소요 시간을 재현한 시뮬레이션이 아니라 **흐름과 WMS/발주 트리거 로직이 눈에 보이게 계속 돌아가게 하는 데모용 타임랩스**다.

| 구분 | 값 |
|---|---|
| 실제 웨이퍼 투입 → 패키징 완료 (업계 공개 자료 기준 대략치) | 약 3~4개월 (90~120일) |
| 이 시스템의 HBM 라우팅 130스텝 완주 시간 (5초/스텝 × 130) | 약 10.8분 (650초) |
| 배속 | 약 **12,000 ~ 16,000배** |

**가정과 한계**: 위 배속은 130스텝에 5초씩 균등하게 배분했다는 가정 위에서 나온 평균치다. 실제로는 스텝마다 걸리는 시간이 균일하지 않고(설비 대기·큐잉이 실가공 시간보다 훨씬 크게 작용), 노드별(예: TSV 구간 vs 셀 어레이 반복 구간) 상대적 소요 비중도 이 시뮬레이션엔 반영돼 있지 않다. 노드별로 다른 간격을 주는 건 향후 개선 과제로 남겨둔다.

---

## 출처

- [Applied Materials — HBM: Materials Innovation Propels High-Bandwidth Memory Into the AI Era](https://www.appliedmaterials.com/us/en/newsroom/blogs/hbm--materials-innovation-propels-high-bandwidth-memory-into-the.html) — DRAM ~700스텝 + HBM 전용 ~19스텝(프런트 10 + 백 9), TSV 지름·마이크로범프 공정
- [Applied Materials — 3D NAND](https://www.appliedmaterials.com/us/en/semiconductor/markets-and-inflections/memory/3d-nand.html) — 셀 구성 물질(W/TiN 게이트, AlO, 질화막, 채널 폴리), CMOS-under/over-Array, 게이트 리플레이스먼트·텅스텐 충진
- [SK hynix Newsroom — Semiconductor Back-End Process Episode 4: Packages Part 2](https://news.skhynix.com/semiconductor-back-end-process-episode-4-packages-part-2/) — TSV·패키지 스택·칩 스택 정의
- [Samsung Newsroom — Industry's First 12-Layer 3D-TSV Chip Packaging Technology](https://news.samsung.com/global/samsung-electronics-develops-industrys-first-12-layer-3d-tsv-chip-packaging-technology) — 12-Hi 스택, TSV 홀 6만개+, 8-Hi 대비 두께 유지
- [Micron — Intro to Fabrication (공식 교육자료 PDF)](https://www.micron.com/content/dam/micron/educatorhub/fabrication/micron-intro-to-fabrication-presentation.pdf) — 트랜지스터 게이트(TG)·콘택(CN)·M1 다마신 공정 스텝 단위 설명
- [imec — A View on the Logic Technology Roadmap](https://www.imec-int.com/en/articles/view-logic-technology-roadmap) — BEOL 금속층 수 범위(Mx 3~6층, 최대 15층)
- [SemiEngineering — Advanced Patterning Techniques For 3D NAND Devices](https://semiengineering.com/advanced-patterning-techniques-for-3d-nand-devices/) — 32P/64P/96P 노드별 슬릿·계단(Staircase) 패터닝 구조
- [Blocks & Files — Samsung has 300-layer NAND coming, with 430 layers after that](https://www.blocksandfiles.com/flash/2023/08/18/samsung-has-300-layer-nand-coming-with-430-layers-after-that-report/1612557) / [Yole Group — SK hynix 321-layer NAND](https://www.yolegroup.com/industry-news/sk-hynix-announces-production-of-its-321-layer-nand-flash-shipments-will-start-in-the-first-half-of-2025/) — 2024~2025년 기준 3D NAND 층수
