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
      "🏭 3D 팹 사실화 — 창고 종류별(AS/RS 고층랙·위험물 방폭·평치·MRO) + 가스야드·CUB·스크러버·케미컬 VMB",
      "장비 공정별 실루엣(리소/클러스터/CMP/퍼니스/박스) + EFEM·로드포트, 베이앤체이스 배치(통로+서비스체이스)",
      "카메라 포커스 — 창고·공정 클릭 시 부드럽게 줌인(CameraControls) + 전체 뷰 리셋 (실제 fab 유사도 ~80%)",
    ],
  },
  {
    day: 3,
    date: "2026-07-12",
    label: "단일 진실원 강화 + 탭 간 데이터 정합",
    color: "#0078D4",
    items: [
      "전체 58개 자재 ProcessUsage 연결 감사 — GAS·CHM·CSM 27개 자재에 74건 ProcessUsage 신규 추가 (총 59→133건)",
      "H₂·Ar·He·CO₂ 등 시설 인프라 가스도 공정에 연결: 모든 GAS 26종이 공정별 사용량 탭에 표시",
      "단일 진실원 확립: ProcessUsage → dailyUsage·monthlyQty 유도, 재고·공정 탭 모두 동일 수치 공유",
      "재고 탭에 월소요량 컬럼 추가 — 공정 탭과 4개 핵심 수치(재고량·일소요량·보관일수·월소요량) 실시간 비교 가능",
      "UPW(초순수) 위급 버그 수정 — ropDays=0 → doh=null → 상태=데이터없음 (현장생산 자재는 DOH 미적용)",
      "DOHBar 개선 — 0나눗셈 가드, 최대값 표시(/ X일), ROP 33.3% 위치 마커 추가",
      "현장생산 자재 UI 통일 — 현재고 셀 '현장생산' 배지, 일사용량 '연속공급', 보관일수 '현장생산' (재고·공정 탭 공통)",
      "UTL(유틸리티) 자재 공정 탭 누락 수정 — ProcessUsage 없는 자재도 재고 fallback으로 집계, '시설 전체' 태그 표시",
      "공정별 사용량 테이블 전 컬럼 정렬 ▲▼ 추가 (품번·자재명·구분·현재고·일소요량·보관일수·월소요량)",
      "트리오 에이전트 구성 (크리·패브·엑스) — AGENTS.md 기반 기획팀 3인 서브에이전트 체계",
      "입고 시뮬레이션 (/simulation) — 발주량 산정, ROP 기반 추천, 3D 창고 capacity 실시간 연동",
    ],
  },
  {
    day: 4,
    date: "2026-07-12",
    label: "FAB 규모 확장 + 3D 현실화 + 창고 연동 일관성",
    color: "#7C3AED",
    items: [
      "Seed 재고·공정소비량 업계 표준 스케일업 — WH-A 68%, WH-B 51%, WH-C 75%, WH-D 46% (실제 FAB 수준)",
      "WH-C totalCapacity 7500 cylinder-slot으로 확장 (특수가스 공급량 기준), WH-A 2000 pallet 조정",
      "수요 시나리오 시뮬레이터 신규 추가 — 제품별(HBM·DRAM·NAND) 수요 변화 → 공정 소비량·창고 영향 예측",
      "% 배지 클릭으로 직접 숫자 입력 (DemandSlider 인라인 input, Enter/Escape/blur 지원)",
      "ProcessFlow3D: FAB_W 자동 계산 — 장비 수 변경 시 바닥·레일·창고·CUB·스크러버 모두 자동 스케일",
      "장비 수 ×2 확장 (P04 식각 16대 기준 FAB_W ≈ 23 자동 산출), 기존 레이아웃 겹침 문제 해소",
      "클린룸 raised access floor — 600mm 타일 격자선(LineSegments 단일 드로우콜), 에폭시 광택 바닥 재질",
      "FOUP / 자재흐름 on/off 토글 버튼 — OFF 시 메시 언마운트·useFrame 제거로 실질적 성능 향상",
      "창고 상세 3D ↔ 통계 패널 ↔ FAB 뷰 세 곳 일관성 확보 — utilization 기반 슬롯 확장으로 68% = 82/120 슬롯",
      "operationalLayout ↔ 가상레이아웃 자동 전환 로직 (20%p 괴리 기준) — DB 슬롯 데이터 미동기화 방지",
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
                D4
              </div>
            </div>
            <div className="flex-1 bg-[#FAFAFA] rounded-2xl border border-dashed border-[#E0E0E0] px-5 py-4 mb-1">
              <div className="text-xs font-semibold text-[#999] mb-2">다음 세션 예정</div>
              <ul className="space-y-1.5">
                {[
                  "SCM 페이지 — 발주·납기·협력사 관리 연동",
                  "리스크 알람 고도화 — 임계치 설정, 에스컬레이션 플로우",
                  "제품별 사용량 (/product) — HBM·DRAM·NAND 제품 단위 집계",
                  "Vercel 배포 최신화 — Day 4 변경분 반영",
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
