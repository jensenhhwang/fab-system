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
  { day: 7, date: "2026-07-16", label: "1WMS / 3FAB Control Tower 재설계", color: "#2563EB", items: [
    "상단 중앙 WMS와 하단 M20·M21·M22를 연결하는 ㅗ형 공정 흐름도 구축",
    "WMS 가용재고를 3개 FAB의 합산 일사용량으로 나누는 SKU별 통합 잔여일 계산 적용",
    "CAMPUS와 FAB별 선택에 따라 기준 SKU·배분재고·일사용량·경보·오늘의 조치가 전환되도록 연결",
    "품질보류·격리 재고를 가용재고에서 제외하고 서로 다른 자재와 단위를 합산하지 않는 계산 규칙 반영",
    "각 FAB의 일사용량·수요 비중·공용재 배분 예정량·예상 잔여일을 WMS 흐름과 함께 표시",
    "기존 3D 공정 화면은 보존했으며 Control Tower 선택 상태와 3D 화면의 직접 연동은 후속 범위로 분리",
    "계산 규칙 테스트, TypeScript, ESLint, 브라우저 렌더링 및 Webpack 프로덕션 빌드 검증 완료",
  ] },
  { day: 8, date: "2026-07-17", label: "WMS–3FAB Campus Material Twin 1차", color: "#0F766E", items: [
    "1WMS 상단과 M20·M21·M22 하단을 ㅗ형 동선으로 묶은 Campus 전체 3D 허브 구축",
    "자재·Fab·시설·Lot·Handling Unit·Flow Step·카메라 선택 상태를 URL과 공통 Context로 유지",
    "Campus에 전체 물리 창고를 항상 표시하고 선택 SKU의 실제 보관창고→수요 Fab 경로만 강조",
    "기존 공정별 사용량의 P01~P10 장비·AMHS·FOUP·자재 배관은 학습용 독립 탭으로 유지하면서 Twin Fab 상세에도 재사용",
    "M20 HBM TSV·적층본딩, M21 DRAM 셀·배선 어레이, M22 3D NAND HAR 식각·Stack CVD로 장비 밀도와 대표 설비 구성을 분리",
    "Fab 투명 외벽·지붕과 공중 계획 노드를 제거하고 Fab 식별 라벨을 바닥 전면으로 이동",
    "실제 TransferOrder가 CREATED·PICKING·STAGED·IN_TRANSIT·RECEIVED일 때만 물류 캐리어를 표시하고, 전체 활성 자재를 동시에 렌더링",
    "TransferOrder가 없는 창고 물류는 정지시키고 ETA 예상 위치·15초 이내 실측 위치·지연 상태를 구분해 표시하며 도착 후 재순환 애니메이션 제거",
    "M20 대표 수직 경로를 WMS 재고→Allocation→피킹→Staging→이송→PRS→Line-side→MES 소비로 분리",
    "MES 작업지시 생성 시 Fab별 Allocation·TransferOrder·Flow Event를 동시 생성하고 Lot 피킹 시 실제 창고·위치·Lot·Handling Unit을 같은 이송에 결합",
    "5초 Transfer Feed, 순방향 상태 전이 API, IN_TRANSIT 실측 좌표 수신 API를 추가하고 완료·취소 주문은 활성 3D 장면에서 제거",
    "Campus에서 창고 코드·실제 명칭·Capacity를 일치시키고 다른 SKU로 진입해도 창고 상세 전체 위치가 비어 보이지 않도록 필터 규칙 수정",
    "M20 P10 HBM 대표 작업지시를 PKG-001 98kg·Lot 1개·HU 1개로 생성하고 FEFO 예약→출고→이송→PRS→Line-side→소비까지 실제 Mongo 원장으로 완주",
    "피킹 시 Lot 가용량만 예약하고 IN_TRANSIT 출발 때 WMS 재고를 차감해 이중 차감을 제거했으며, PRS·Line-side·소비 수량 보존과 requestId 멱등 이벤트를 적용",
    "M20 공정별 Equipment Master 452대를 모델링 기준으로 구축하고 가동 장비의 rated capacity×OEE를 장비 Capacity와 3D 장비 밀도에 연결",
    "공정별 사용량 화면에 기존 월 기준소요량과 CONSUMED 이벤트 기반 최근 30일 실제 사용량을 분리 표시",
    "실제 원장 단계와 아직 미연결된 계획 단계를 초록·노랑으로 명확히 구분해 가상 이송을 LIVE로 오인하지 않도록 설계",
    "Facility·Allocation·TransferOrder·Flow Event 인덱스와 기존 WorkOrder fabId 보정을 포함한 안전한 DB 초기화 스크립트 추가",
    "동시 이송·실측 우선·ETA 정지·역전이 및 재순환 금지 규칙 테스트와 TypeScript·ESLint·브라우저·Webpack 빌드 검증 완료",
  ] },
  { day: 9, date: "2026-07-17", label: "M20 규칙형 운영 에이전트 1차", color: "#6332A8", items: [
    "자유 판단형 LLM 대신 동일 입력에 동일 결정을 내리는 발주·WMS·MES·공정 규칙형 에이전트 구축",
    "AgentRun·AgentDecision 원장에 정책 버전, 입력 스냅샷, 사유 코드, 실행 결과와 멱등키 기록",
    "PKG-001의 3FAB 합산 일사용량·안전재고·21일 리드타임·가용재고·예약·확정입고를 반영한 보충 발주량 계산",
    "하드코딩 모델 공급사·MOQ·주문배수·기준가격으로 운영 PO 초안을 생성하고 사람 승인 전 외부 Outbox 생성을 차단",
    "WMS 에이전트의 FEFO Lot/HU 논리 예약과 현장 피킹 완료 확인을 분리해 물리 실적 자동 생성 방지",
    "Line-side 도착 후 MES가 자재와 모델 Capacity를 검증하고 공정 에이전트가 M20 P10 장비를 중복 없이 예약한 뒤 WO Release",
    "출발·도착·인계·소비는 기존 권한 기반 물리 확인 API만 허용하고 각 확인 뒤 에이전트가 다음 단계 자동 조율",
    "M20 대표 흐름 화면에 4개 에이전트 결정, 차단 사유, PO 계산 근거·승인·Outbox, 모델 장비 배정을 통합 표시",
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
