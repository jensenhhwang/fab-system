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
    "기존 공정별 사용량의 P01~P10 장비·AMHS·FOUP·자재 배관은 분석용 독립 탭으로 유지하면서 Twin Fab 상세에도 재사용",
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
  { day: 10, date: "2026-07-17", label: "Campus 전체 자재·Scene Clock", color: "#1D5FBF", items: [
    "LIVE CAMPUS MATERIAL SCENE 자재 범위의 기본값을 전체 자재로 변경하고 URL material 파라미터가 없으면 이전 선택을 초기화",
    "전체 자재에서는 단위가 다른 수량을 합산하지 않고 자재종·활성 Transfer·이동 중 HU·출발 창고 기준으로 집계",
    "개별 자재 선택 시 Transfer 목록과 3D 장면을 동일 SKU 조건으로 필터링하고 기존 상세 원장·공정 Trace를 유지",
    "서버 응답 시각과 브라우저 수신 시각의 오프셋을 계산하는 SceneClock을 도입해 목록 진행률과 3D 위치의 기준 시각 통일",
    "LIVE·일시정지·현재로 복귀 조작을 추가하고 PAUSED 상태에서 Transfer 폴링·Scene 프레임·운영 드릴다운 정지",
    "전체 모드에서 IN_TRANSIT만 HU 단위로 이동시키고 CREATED·PICKING·STAGED·RECEIVED는 시설·상태별 정지 표식으로 집계",
    "OS·MongoDB 시간과 실제 이벤트 원장은 변경하지 않으며 과거 재생·배속은 시점 Projection 원장 구축 전까지 차단",
    "Control Tower=조치, Digital Twin=물리 위치·이송, 공정별 사용량=계획·실사용·차이 분석으로 역할 분리",
    "Campus WebGL 컨텍스트 유실 시 3D 자동 재생성과 WMS·3FAB 운영 장면 fallback을 적용해 흰 화면 고착 방지",
    "공정별 사용량 메뉴에서 학습 문구를 제거하고 Fab 범위를 M20→M21→M22→전체 3FAB 순서로 통일",
    "전체 비교에서는 서로 다른 자재 단위를 합산하지 않고 Fab별 자재·공정·계획·30일 실적·장비 원장 연결 건수 표시",
    "Fab 선택 시 자재별 계획 일사용량과 최근 30일 평균 실사용량, 적용 공정, 장비 Capacity와 Fab 3D를 함께 조회",
    "M20=HBM, M21=DRAM, M22=NAND를 운영 매핑으로 명시하고 제품은 Fab의 하위 속성으로 정리",
    "P01~P10 공정 사전에 한영 명칭·목적·전후 공정·설비·자재·KPI·산출물과 MODELED_BASELINE 정합성 안내 추가",
    "M20 실제 수직 원장을 기준 모델로 집중 완성한 뒤 공통 엔진으로 M21·M22를 확장하는 전략 확정",
  ] },
  { day: 11, date: "2026-07-18", label: "실제 공정 라우트 + 12-FOUP 실시간 추적", color: "#0EA5E9", items: [
    "일일 생산 실적 원장(productionActuals)을 추가해 일일 통제 화면의 재고·DOH 투영을 계획치 대신 확정 실적 기준으로 계산",
    "materialReroute로 자재 전용 경로 변경을 기록하고, MES 공정 준비도·자재 상세·로그인 화면에 남아있던 이천 M14/M16 표기를 M20/M21/M22 기준으로 정리",
    "Applied Materials·SK하이닉스 뉴스룸·Samsung Newsroom·imec·SemiEngineering 등 업계 공개 자료를 근거로 HBM·DRAM·NAND 실제 공정 흐름을 문서화(docs/route-master.md)하고 routeMaster 컬렉션으로 시딩",
    "waferLots·waferLotStepEvents 실행 원장을 추가해 FOUP-01 하나만 되던 3D 실시간 추적을 FOUP-01~12 전부로 확장",
    "FOUP가 130스텝 라우팅을 완주하면 새 웨이퍼 25장 로트로 자동 재적재되는 순환 구조 구현",
    "패키징 노드 첫 진입 시 M20 파일럿 워크오더를 자동 생성해 WMS 예약·소비·발주 에이전트 체인을 재트리거 — 재고가 계속 깎이기만 하고 발주로 이어지지 않던 문제 해소",
    "6초 폴링마다 MES_TELEMETRY 트리거로 1스텝씩 자동 진행하는 타이머를 추가하고 기존 OPERATOR_CONFIRM 수동 확인 버튼과 병행",
    "docs/vision.md에 시뮬레이션 배속(약 1.2만~1.6만배, 균등 배분 가정)을 기록하고 '타임 액셀러레이터 제외' 원칙이 Phase 4 What-if 트윈에 한정됨을 명시",
    "실 DB 시나리오 스크립트(test:wafer-lot-12foup)로 FOUP 독립성·패키징 트리거·재적재 순환을 검증하고 TypeScript·ESLint·브라우저 콘솔 0 에러 확인",
  ] },
  { day: 12, date: "2026-07-19", label: "M20 생산능력·설비·FOUP 실행 원장 통합", color: "#EA002C", items: [
    "M20 NORMAL 생산능력을 117,000 WSPM으로 확정하고 HBM4 12-Hi 36GB 기준 월 5,703,750개 계획 생산량과 wafer당 KGD·stack 수율 계산 계약 수립",
    "M21·M22는 미정으로 분리하고 fab-master·route-master·material-consumption-master를 가정·신뢰도·변경관리 기준이 있는 단일 문서 체계로 정리",
    "P10 Packaging 안에 Dicing·Die Sort·Base Die Attach·12단 DRAM Bonding·MUF·Final Test를 통합하고 외부 조달 Base Die KGD와 후공정 자재·BOM 연결",
    "M20 117K WSPM을 업계형 여유율로 감당하도록 공정별 Equipment Master를 494대로 확정하고 장비 Capacity·OEE·가동률·병목 여유를 화면과 API에 연결",
    "3D에 494대 설비를 대표 샘플이 아닌 전수 instance로 반영하고 P09 Test와 P10 Packaging을 하나의 후공정 라인으로 연결해 OHT·AGV 동선을 단축",
    "Little's Law 기준 일 156 Lot, Wafer/FOUP 체류 90일, Occupied 14,040대, Physical FOUP Fleet 15,600대, Reserve 1,560대 실행 계약 수립",
    "M20:HBM:V3 Route에 14,040개 활성 Wafer Lot·15,600개 FOUP·14,040개 활성 Assignment를 멱등 bootstrap하고 기존 Aggregate WIP 20,828개는 완료 이력으로 보존",
    "전체 Lot 실행 원장 API와 검색·10개 단위 페이지 조회를 추가해 Modeled 14,028개와 Watched 12개를 동일 화면에서 Lot·FOUP·공정·Carrier 기준으로 추적",
    "3D는 설비와 겹치는 압축 FOUP density를 제거하고 이동 의미가 있는 Watched 12개만 표시하며 전체 수량은 LEDGER_EXACT 원장과 수량판을 기준으로 분리",
    "실행추적의 전체 원장 선택과 Watched 상세 선택을 하나로 통합해 서로 다른 FOUP 정보가 동시에 표시되던 이중 선택 UX 제거",
    "FOUP bootstrap 재실행 추가 생성 0건, 14,040 Lot/Assignment 불변식, 494대 3D, 생산 시나리오, TypeScript, ESLint 및 Next.js 프로덕션 빌드 검증 완료",
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
