const LOGS = [
  {
    day: 0,
    date: "2026-07-08",
    label: "환경 세팅 삽질",
    color: "#F7A600",
    items: [
      "Prisma 7 — schema.prisma에서 url 제거, prisma.config.ts로 분리",
      "PrismaClient adapter 필수: new PrismaClient({ adapter }) 패턴",
      "PrismaBetterSqlite3 생성자: Database 인스턴스 ❌ → { url: 'file:...' } ✅",
      "DB 파일 위치: prisma/dev.db ❌ → 프로젝트 루트 dev.db ✅",
      "Next.js 16: middleware.ts 폐기 → src/proxy.ts (export named proxy)",
      "OS 다크모드 강제 화이트: globals.css + html 인라인 color-scheme: light",
    ],
  },
  {
    day: 1,
    date: "2026-07-10",
    label: "핵심 페이지 구현",
    color: "#EA002C",
    items: [
      "대시보드 홈 — KPI 4개, AI 브리핑(Groq llama-3.3-70b), 창고 바, 리스크 목록",
      "재고·DOH 페이지 — 실계산(현재고÷일사용량), 상태 탭 필터 클릭, 전 컬럼 정렬 ▲▼",
      "공정별 사용량 — React Three Fiber 3D 흐름도(P01→P10), 자재 hover → 공정 하이라이트",
      "업무 일지 — DB(WikiEntry) 연동, 아코디언 리스트, 새 일지 작성 폼 + POST API",
      "개발 이력 탭 추가 (지금 이 페이지)",
    ],
  },
  {
    day: 2,
    date: "2026-07-11",
    label: "로그인 정상화 + DB 이전 (Turso→MongoDB)",
    color: "#00B96B",
    items: [
      "🔥 Vercel 로그인 실패 근본원인 = 환경변수 TURSO_AUTH_TOKEN에 토큰 대신 DB URL이 들어감(뒤바뀜) → Turso JWT 400",
      "⚠️ 교훈: 로그로 원인 확정 전 이론 세우지 말 것 — 'fetch 패칭' 오진으로 시간 낭비. 진단 라우트로 배포 env 직접 검증하니 즉시 판명",
      "DB 이전: Turso/Prisma → MongoDB Atlas 네이티브 드라이버 (Prisma 7 새 클라이언트는 Mongo 직접연결 불가)",
      "Prisma 완전 제거 — DB 의존성 7종→1종, prisma generate 빌드단계 삭제. src/lib/db.ts + queries.ts($lookup 조인)로 재구성",
      "proxy.ts secureCookie 수정 — 프로덕션 HTTPS 쿠키(__Secure-) 못 읽어 로그인 후 /login 되돌던 버그",
      "공정별 사용량 3D에 자재창고(WH-A~D) + 배관 시각화 추가 — ProcessUsage⋈Inventory로 공정↔창고 연결 도출",
    ],
  },
];

export default function DevlogPage() {
  return (
    <>
      <div className="mb-1 text-2xl font-extrabold tracking-tight">개발 이력</div>
      <div className="text-sm text-[#999] mb-8">FAB 자재관리 시스템 — 세션별 작업 기록</div>

      <div className="relative">
        {/* 타임라인 세로선 */}
        <div className="absolute left-[52px] top-0 bottom-0 w-px bg-[#E8E8E8]" />

        <div className="space-y-6">
          {[...LOGS].reverse().map((log) => (
            <div key={log.day} className="flex gap-6">
              {/* Day 뱃지 */}
              <div className="flex-shrink-0 w-[52px] flex flex-col items-center pt-1">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-black shadow-sm z-10"
                  style={{ backgroundColor: log.color }}
                >
                  D{log.day}
                </div>
              </div>

              {/* 카드 */}
              <div className="flex-1 bg-white rounded-2xl shadow-sm border border-[#F0F0F0] overflow-hidden mb-1">
                <div className="px-5 py-3 border-b border-[#F8F8F8] flex items-center gap-3">
                  <span
                    className="text-xs font-black px-2.5 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: log.color }}
                  >
                    Day {log.day}
                  </span>
                  <span className="text-sm font-bold text-[#111]">{log.label}</span>
                  <span className="ml-auto text-[11px] text-[#999] font-mono">{log.date}</span>
                </div>
                <ul className="px-5 py-3 space-y-2">
                  {log.items.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] text-[#333]">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: log.color }} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}

          {/* 다음 세션 예고 */}
          <div className="flex gap-6">
            <div className="flex-shrink-0 w-[52px] flex flex-col items-center pt-1">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-[#999] text-xs font-black border-2 border-dashed border-[#CCC] bg-white z-10">
                D3
              </div>
            </div>
            <div className="flex-1 bg-[#FAFAFA] rounded-2xl border border-dashed border-[#E0E0E0] px-5 py-4 mb-1">
              <div className="text-xs font-semibold text-[#999] mb-2">다음 세션 예정</div>
              <ul className="space-y-1.5">
                {[
                  "입고 시뮬레이션 (/simulation) — VISION 원칙 1번",
                  "창고 Capacity (/warehouse) — 실 DB 데이터 연동",
                  "공정 3D 흐름도 완성도 개선 (화살표 방향 표시)",
                  "Playwright E2E 회귀 스위트 정비 (MongoDB 기준)",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] text-[#999]">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#CCC] flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
