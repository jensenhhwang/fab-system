import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, "../dev.db");
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  // admin 유저 id 조회
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("Admin user not found");

  // 기존 오늘 날짜 항목이 있으면 skip
  const today = new Date("2026-07-10T00:00:00.000Z");
  const existing = await prisma.wikiEntry.findFirst({
    where: { date: today, title: { contains: "재고 페이지" } },
  });
  if (existing) {
    console.log("이미 오늘 항목이 있습니다.");
    return;
  }

  await prisma.wikiEntry.create({
    data: {
      date: today,
      title: "재고 페이지 탭 필터 · 컬럼 정렬 구현",
      category: "개발",
      content: `[오늘 완료 작업]
• 재고·보관일수(DOH) 페이지 구조 개선
  - 서버 컴포넌트(data fetch) + 클라이언트 컴포넌트(인터랙션) 분리
  - 위급/경보/적정/여유 KPI 카드 → 클릭 시 해당 상태 품목만 필터링
  - 카드 활성화 시 색상 채우기 + 그림자 + 살짝 부상 애니메이션

• 재고 테이블 컬럼 정렬 기능 추가
  - 품번 / 자재명 / 구분 / 현재고 / 일사용량 / 보관일수 / 창고 / 상태 전 컬럼 정렬 지원
  - 클릭 → 오름차순, 재클릭 → 내림차순
  - 현재 정렬 컬럼 헤더 강조 + ▲▼ 아이콘

• 공정별 사용량 3D 흐름도 (이전 세션)
  - ProcessFlow3D.tsx: P01→P10 공정 박스 5×2 그리드, 뱀형 화살표 연결
  - 자재 hover 시 해당 공정 3D 박스 glow + 부상 애니메이션
  - UsageClient.tsx: 제품/카테고리 필터 + 공정 클릭 역필터`,
      result: "재고 페이지 탭 필터 + 전 컬럼 정렬 완성. 공정 3D 흐름도 기본 구현 완료.",
      nextAction: `[다음 세션 우선순위]
1. 입고 시뮬레이션 페이지 (/simulation) — VISION 원칙 1번
   - 자재 선택 → 입고 수량/날짜 입력 → DOH 변화 예측 그래프
2. 창고 Capacity 페이지 (/warehouse) — 실제 DB 데이터로 구현
3. 공정 3D 흐름도 완성도 개선 (화살표 방향 표시, 공정 클릭 상세 패널)`,
      userId: admin.id,
    },
  });

  console.log("✅ 업무 일지 저장 완료");
}

main().finally(() => prisma.$disconnect());
