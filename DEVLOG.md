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
- 공정별 사용량 학습 화면은 독립 탭과 Twin Fab 상세에 모두 유지
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

## Next · 입고 시뮬레이션 (`/simulation`) — VISION 원칙 1번
