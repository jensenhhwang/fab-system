import { getDb } from "../src/lib/db";
import type { WikiDoc } from "../src/lib/db";

async function main() {
  const db = await getDb();
  const wiki = db.collection<WikiDoc>("wikiEntries");
  const now = new Date("2026-07-14T18:00:00+09:00");

  const content = [
    "## MES Phase 1 구축 (공정 실행 관리)",
    "",
    "- BomTemplateDoc, WorkOrderDoc 스키마 설계 및 DB 타입 추가",
    "- API 라우트 구축: bom-templates, workorders, workorders/[id]/status, workorders/[id]/pick, process-readiness",
    "- UI: MesClient(3탭), ProcessReadinessMatrix, WorkOrderTable, WorkOrderCreateModal, PickingDrawer",
    "- BOM 시드 26개 템플릿 (monthlyQty/30 = qtyPerRun)",
    "- 사이드바 '생산 실행 (MES)' 메뉴 추가",
    "",
    "## 공정 현실화",
    "",
    "- src/lib/processes.ts 생성 — PROCESSES 단일 진실 원천 분리",
    "- ProcessUsageDoc에 site 필드 추가 (이천/청주)",
    "- ProcessMetadataDoc 타입 + processMetadata 컬렉션 시드 (P01~P10 한국어명)",
    "- MES 매트릭스: 공정명·사이트 배지·사이트 필터(이천/청주/ALL)",
    "- 양방향 링크: /usage → /mes?process=P04 (MES 공정 준비 보기), /mes → /usage?process=P04 (사용량 보기)",
    "",
    "## 버그 수정",
    "",
    "- DOH 계산 버그: inventoryLots.availableQuantity → inventory.quantity 사용",
    "- DOH 로직 버그: 단일 공정 소비량 기준 → 전체 공정 합산 소비량 기준으로 수정",
    "  (자재는 창고에서 공정 구분 없이 공유 소비되므로 totalDailyUsage 기준이 정확)",
  ].join("\n");

  await wiki.insertOne({
    _id: `devlog-20260714-${Date.now()}`,
    date: now,
    title: "MES Phase 1 구축 + 공정 현실화 완료",
    category: "개발",
    content,
    result: "43개 커밋, TypeScript 에러 0개, main 브랜치 푸시 완료",
    nextAction: "M14/M16 팹 분리 (DRAM 이천 / NAND 청주) 구현 검토",
    userId: "admin@fab.skh",
    createdAt: now,
  });

  console.log("Dev log entry inserted");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
