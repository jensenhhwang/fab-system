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

## Next · 입고 시뮬레이션 (`/simulation`) — VISION 원칙 1번
