const LOGS = [
  { day: 0, date: "2026-07-08", label: "환경 세팅", color: "#F7A600", items: ["Prisma 7 및 SQLite 어댑터 구성", "Next.js 16 proxy 규칙 적용", "라이트 테마 고정과 기본 UI 토대 구성"] },
  { day: 1, date: "2026-07-10", label: "핵심 운영 화면", color: "#EA002C", items: ["종합 현황과 AI 브리핑", "재고·DOH 및 공정별 사용량 화면", "업무 일지와 개발 이력 탭"] },
  { day: 2, date: "2026-07-11", label: "인증 정상화와 MongoDB 이전", color: "#00B96B", items: ["배포 환경변수 오류 진단 및 인증 수정", "Turso·Prisma에서 MongoDB Atlas 네이티브 드라이버로 이전", "공정·창고 3D 연결과 카메라 포커스 구현"] },
  { day: 3, date: "2026-07-12", label: "단일 진실원과 데이터 정합", color: "#0078D4", items: ["ProcessUsage를 일사용량·월소요량·DOH의 기준으로 통합", "현장생산 자재와 fallback 계산 규칙 정리", "크리·패브·엑스 3인 기획팀 체계 도입"] },
  { day: 4, date: "2026-07-12", label: "FAB 규모와 3D 현실화", color: "#7C3AED", items: ["재고·공정소비량을 FAB 운영 규모로 확장", "3D 레이아웃과 창고 Capacity 정합성 강화", "수요 변화 시나리오의 공정·창고 영향 연결"] },
  { day: 5, date: "2026-07-14", label: "MES Phase 1", color: "#0891B2", items: ["BOM 기반 작업지시와 상태 전이", "FEFO Lot 피킹과 권한 검증", "공정 준비도·사용량·MES 양방향 연결"] },
  { day: 6, date: "2026-07-15", label: "운영 데이터 통합과 자재 허브", color: "#0F766E", items: [
    "재고·Lot·MES 작업지시 변경을 트랜잭션과 서버 권한 검증으로 강화",
    "랜덤 공급 시뮬레이션을 제거하고 복수 제품 증·감산 기반 결정론적 What-if로 개편",
    "승인 공급사, 주·보조 역할, 최소·기준·최대·현재 리드타임을 관리하는 조달 기준 마스터 구축",
    "What-if에 일반·안전 발주 마감일과 대체 공급사 정보를 연결",
    "재고 목록의 자재를 재고·창고·Lot·공정 사용량·BOM·조달 리드타임 종합 운영 허브로 연결",
    "자재 ID를 공통 식별자로 통일하고 중복 재고·사용량 합산 및 Lot 집계 범위를 교정",
    "대시보드 메뉴와 오래된 시뮬레이션 코드·문서를 현행 운영 목표에 맞게 정리",
    "프로덕션 빌드와 전체 E2E 20개 시나리오 통과",
  ] },
];

export default function DevlogPage() {
  return <>
    <div className="mb-1 text-2xl font-extrabold tracking-tight">개발 이력</div>
    <div className="mb-8 text-sm text-[#999]">FAB 자재관리 시스템 · 세션별 구현 및 운영 규칙 변경 기록</div>
    <div className="relative">
      <div className="absolute bottom-0 left-[17px] top-0 w-px bg-[#E8E8E8]" />
      <div className="space-y-5">{[...LOGS].reverse().map((log) => <article key={log.day} className="relative flex gap-5">
        <div className="z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-black text-white shadow-sm" style={{ backgroundColor: log.color }}>D{log.day}</div>
        <div className="flex-1 overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b px-5 py-3"><span className="rounded-full px-2.5 py-0.5 text-xs font-black text-white" style={{ backgroundColor: log.color }}>Day {log.day}</span><h2 className="text-sm font-bold">{log.label}</h2><time className="ml-auto font-mono text-[11px] text-[#999]">{log.date}</time></div>
          <ul className="space-y-2 px-5 py-4">{log.items.map((item) => <li key={item} className="flex items-start gap-2 text-[13px] text-[#333]"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: log.color }} />{item}</li>)}</ul>
        </div>
      </article>)}</div>
    </div>
  </>;
}
