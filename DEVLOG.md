# FAB 자재관리 시스템 — 개발 이력

---

## Day 0 · 2026-07-08 · 환경 세팅 삽질

- Prisma 7: schema.prisma에 `url` 속성 제거 → `prisma.config.ts`로 분리
- PrismaClient adapter 방식 변경: `new PrismaClient({ adapter })` 필수
- `PrismaBetterSqlite3` 생성자 인자: Database 인스턴스 ❌ → `{ url: "file:..." }` ✅
- DB 파일 위치: `prisma/dev.db` ❌ → 프로젝트 루트 `dev.db` ✅
- Next.js 16: `middleware.ts` 폐기 → `src/proxy.ts` (export named `proxy`)
- OS 다크모드 강제 화이트 적용: `globals.css` + html 인라인 `color-scheme: light`

---

## Day 1 · 2026-07-10 · 핵심 페이지 구현

- 대시보드 홈: KPI 4개 + AI 브리핑(Groq llama-3.3-70b) + 창고 바 + 리스크 목록
- 재고·DOH 페이지: 실계산(현재고÷일사용량), 상태 탭 필터 클릭, 전 컬럼 정렬 ▲▼
- 공정별 사용량: React Three Fiber 3D 흐름도(P01→P10), 자재 hover → 공정 하이라이트
- 업무 일지: DB(WikiEntry) 연동, 아코디언 리스트, 새 일지 작성 폼 + API

---

## Day 8 · 2026-07-17 · WMS–3FAB 이벤트 기반 Material Twin

- MWH-01·MWH-02·HZW-01·MRO-01·BGY-01·BCY-01·PRS-01·UPW-01을 실제 명칭과 Capacity 기준으로 Campus에 상시 표시
- M20 HBM, M21 DRAM, M22 3D NAND의 서로 다른 공정 장비 구성을 하나의 전체뷰로 연결
- MES 작업지시에서 Allocation·TransferOrder를 생성하고 피킹 시 실제 창고·위치·Lot·Handling Unit을 연결
- 모든 활성 자재 이송을 동시에 표시하되 `IN_TRANSIT` 상태만 ETA 또는 실측 위치에 따라 이동
- 요청 없는 캐리어와 창고 크레인은 정지하고, 완료 후 출발점으로 되돌아가는 반복 애니메이션 제거
- 5초 Transfer Feed, 순방향 상태 전이, IN_TRANSIT 실측 좌표 수신, 동시 이송·재순환 금지 테스트 추가
- 공정별 사용량 분석 화면은 독립 탭과 Twin Fab 상세에 모두 유지
- M20 P10 HBM 대표 작업지시를 PKG-001 98kg·Lot 1개·HU 1개로 실제 FEFO 예약부터 공정 소비까지 완주
- 피킹·출발·PRS·Line-side·소비 회계를 분리하고 7개 불변 이벤트와 requestId 멱등성으로 연결
- M20 Equipment Master 452대와 공정별 `ratedCapacity × OEE` Capacity를 3D 장비 밀도에 연결
- 기존 기준 사용량과 `CONSUMED` 원장 기반 최근 30일 실제 사용량을 공정별 사용량 화면에 병기

---

## Day 9 · 2026-07-17 · M20 규칙형 운영 에이전트 1차

- 발주·WMS·MES·공정 담당을 결정론적 정책 서비스로 분리하고 `AgentRun`·`AgentDecision` 감사 원장 추가
- PKG-001의 WMS 가용재고, 활성 예약, 확정입고, 3FAB 합산 일사용량, 안전재고와 리드타임을 사용해 보충 발주량 계산
- 모델 공급사·MOQ·주문배수·기준가격 기반 `PurchaseOrderDraft`를 생성하고 사용자 승인 전 Outbox 적재 차단
- WMS 에이전트의 FEFO Lot/HU 예약과 작업자의 실제 피킹 확인을 분리
- Line-side 인계 후 MES Release와 M20 P10 모델 장비 독점 배정을 자동 수행
- 출발·도착·소비는 스캐너·작업자 역할의 기존 확인 API만 허용하고 시간 기반 가짜 완료 금지
- M20 대표 흐름 카드에서 4개 에이전트 결정, PO 계산·승인·Outbox, 장비 배정과 다음 물리 확인을 함께 조회

---

## Day 10 · 2026-07-17 · Campus 전체 자재·Scene Clock

- `LIVE CAMPUS MATERIAL SCENE`의 기본 자재 범위를 전체로 변경하고 개별 SKU 선택과 URL 상태를 분리
- 전체 모드는 서로 다른 단위 수량을 합산하지 않고 자재종, 활성 Transfer, 이동 중 HU, 출발 창고로 집계
- 서버 응답 시각 기반 SceneClock으로 목록 진행률과 3D 캐리어 위치의 기준 시각 통일
- LIVE·일시정지·현재로 복귀 조작을 추가하고 정지 중 폴링·3D 시간·운영 드릴다운 차단
- 전체 모드의 `IN_TRANSIT`만 개별 이동하고 나머지 Transfer 상태는 시설·상태별 정지 표식으로 묶어 렌더링
- 실제 OS·MongoDB·이벤트 시각은 변경하지 않고 과거 재생과 배속은 시점 Projection 원장 이후로 분리
- Control Tower는 부족·지연·조치, Digital Twin은 WMS–Fab 물리 위치·이송, 공정별 사용량은 계획·실사용·차이 분석으로 역할 분리
- Campus WebGL 컨텍스트 유실 시 3D를 자동 재생성하고 재시도 실패 때 WMS·3FAB 운영 장면을 표시해 흰 화면 고착 방지
- 공정별 사용량 메뉴에서 `학습` 문구를 제거하고 Fab 범위를 `M20 → M21 → M22 → 전체 3FAB` 순서로 통일
- 기본 진입은 전체 비교로 유지하고 M20·M21·M22별 자재·공정·계획 연결·30일 실적·장비 원장 상태를 단위 합산 없이 비교
- Fab 선택 시 해당 Fab의 자재별 계획 일사용량과 최근 30일 평균 실사용량, 적용 공정, 장비 Capacity와 3D를 함께 표시
- 운영 매핑을 M20=HBM, M21=DRAM, M22=NAND로 명시하고 제품은 Fab의 하위 속성으로 표시
- P01~P10 공정 사전을 추가해 한영 명칭, 목적, 전후 공정, 대표 설비·자재, KPI와 산출물을 동일 상세 패널에서 조회
- P01~P10 설명은 `MODELED_BASELINE` 기준 모델로 표시하고 Fab별 실제 Route Master가 없는 항목을 실제 공정처럼 단정하지 않음
- M20 실제 수직 원장을 기준 모델로 집중 완성한 뒤 공통 엔진 설정으로 M21·M22를 확장하는 개발 전략 확정

---

## Day 11 · 2026-07-18 · 실제 공정 라우트 + 12-FOUP 실시간 추적

- 일일 생산 실적(`productionActuals`) 원장을 추가해 일일 통제 화면의 재고·DOH 투영이 계획치가 아닌 확정 실적 기준으로 계산되도록 연결
- `materialReroute`로 자재 전용 경로 변경을 기록하고, MES 공정 준비도·자재 상세 화면의 잔존 이천 M14/M16 표기를 M20/M21/M22 기준으로 정리
- 업계 공개 자료(Applied Materials, SK하이닉스 뉴스룸, Samsung Newsroom, imec, SemiEngineering 등)를 근거로 HBM·DRAM·NAND 실제 공정 흐름을 `docs/route-master.md`에 정의하고 `routeMaster` 컬렉션으로 시딩(M20·HBM 9노드·130스텝)
- `waferLots`/`waferLotStepEvents` 실행 원장을 추가해 FOUP-01 하나만 되던 3D 실시간 추적을 12개 FOUP 전부로 확장
- FOUP가 130스텝을 완주하면 새 웨이퍼 25장 로트로 자동 재적재되는 순환 구조 구현
- 패키징 노드 첫 진입 시 M20 파일럿 워크오더를 자동 생성해 WMS 예약·소비·발주 에이전트 체인을 재트리거 — 재고가 계속 깎이기만 하고 발주로 이어지지 않던 문제 해소
- 6초 폴링마다 `MES_TELEMETRY` 트리거로 1스텝씩 자동 진행하는 타이머를 추가하고, 기존 `OPERATOR_CONFIRM` 수동 확인 버튼과 병행 가능하게 유지
- `docs/vision.md`에 시뮬레이션 배속(약 1.2만~1.6만배, 균등 배분 가정)을 기록하고, "타임 액셀러레이터 제외" 원칙은 Phase 4 What-if 트윈에 한정됨을 명시해 FOUP 자동 진행과의 관계를 정리

---

## Next · 입고 시뮬레이션 (`/simulation`) — VISION 원칙 1번
