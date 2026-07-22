import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { collections } from "../src/lib/db";
import { FAB_EQUIPMENT_MASTER_VERSION, M20_DEFINED_EQUIPMENT_COUNTS, type M20ProcessCode } from "../src/lib/m20-equipment-capacity-plan";

// V4 재계산으로 일부 공정의 표준 대수가 기존 원장보다 줄었다(예: P08 56→12) — 병목/비병목
// 목표 부하 기준을 previousCount 하한 없이 다시 적용한 결과. migrate-m20-equipment-master.ts는
// "삭제하지 않는다"는 불변식을 지키므로, 실제 초과분 삭제는 이 일회성 스크립트로 분리한다.
// deterministic ID(M20-{processCode}-{seq})에서 seq가 가장 큰 것부터 초과분을 지우고,
// equipmentAssignments가 참조 중인 장비는 절대 지우지 않는다.
const apply = process.argv.includes("--apply");

function sequenceOf(id: string): number {
  const match = id.match(/-(\d+)$/);
  if (!match) throw new Error(`deterministic ID 형식이 아닙니다: ${id}`);
  return Number(match[1]);
}

async function main() {
  const { equipmentMaster, equipmentAssignments } = await collections();
  const current = await equipmentMaster.find({ fabId: "M20" }).sort({ processCode: 1, _id: 1 }).toArray();
  const assignedIds = new Set((await equipmentAssignments.find({ fabId: "M20" }).toArray()).map((a) => a.equipmentId));

  const toDelete: string[] = [];
  const summary: Array<{ processCode: M20ProcessCode; current: number; target: number; remove: number; blocked: number }> = [];

  const byProcess = new Map<string, typeof current>();
  for (const tool of current) {
    const list = byProcess.get(tool.processCode) ?? [];
    list.push(tool);
    byProcess.set(tool.processCode, list);
  }

  for (const [processCode, target] of Object.entries(M20_DEFINED_EQUIPMENT_COUNTS) as [M20ProcessCode, number][]) {
    const tools = (byProcess.get(processCode) ?? []).sort((a, b) => sequenceOf(a._id) - sequenceOf(b._id));
    if (tools.length <= target) {
      summary.push({ processCode, current: tools.length, target, remove: 0, blocked: 0 });
      continue;
    }
    const excess = tools.slice(target); // 가장 높은 sequence부터가 뒤쪽에 정렬돼 있음
    const removable = excess.filter((tool) => !assignedIds.has(tool._id));
    const blocked = excess.length - removable.length;
    if (blocked > 0) {
      throw new Error(`${processCode}: 초과분 ${excess.length}대 중 ${blocked}대가 equipmentAssignments에서 참조 중이라 자동 삭제할 수 없습니다.`);
    }
    toDelete.push(...removable.map((tool) => tool._id));
    summary.push({ processCode, current: tools.length, target, remove: removable.length, blocked });
  }

  console.table(summary);
  console.log(`${FAB_EQUIPMENT_MASTER_VERSION} · 삭제 대상=${toDelete.length}대 · mode=${apply ? "APPLY" : "DRY_RUN"}`);
  if (!apply) return;

  const snapshotPath = `/private/tmp/m20-equipment-master-trim-before-${new Date().toISOString().replaceAll(":", "-")}.json`;
  await writeFile(snapshotPath, JSON.stringify({
    version: FAB_EQUIPMENT_MASTER_VERSION, capturedAt: new Date().toISOString(),
    deletedIds: toDelete, equipment: current.filter((tool) => toDelete.includes(tool._id)),
  }, null, 2), "utf8");
  console.log(`snapshot=${snapshotPath}`);

  if (toDelete.length) {
    const result = await equipmentMaster.deleteMany({ _id: { $in: toDelete } });
    if (result.deletedCount !== toDelete.length) throw new Error(`삭제 ${result.deletedCount}대가 계획한 ${toDelete.length}대와 일치하지 않습니다.`);
  }

  for (const row of summary) {
    const after = await equipmentMaster.countDocuments({ fabId: "M20", processCode: row.processCode });
    if (after !== row.target) throw new Error(`${row.processCode} 반영 후 ${after}대, 목표 ${row.target}대가 일치하지 않습니다.`);
  }
  const afterTotal = await equipmentMaster.countDocuments({ fabId: "M20" });
  const targetTotal = Object.values(M20_DEFINED_EQUIPMENT_COUNTS).reduce((sum, count) => sum + count, 0);
  if (afterTotal !== targetTotal) throw new Error(`M20 반영 후 총 ${afterTotal}대로 정의 ${targetTotal}대와 일치하지 않습니다.`);
  console.log(`✅ M20 Equipment Master trimmed: ${afterTotal} modeled tools`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
