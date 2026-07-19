import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { collections, type EquipmentMasterDoc } from "../src/lib/db";
import { PROCESSES } from "../src/lib/processes";
import {
  FAB_EQUIPMENT_MASTER_VERSION,
  M20_DEFINED_EQUIPMENT_COUNTS,
  M20_MODELED_RATE_VALUES,
  modeledOeeForSequence,
  type M20ProcessCode,
} from "../src/lib/m20-equipment-capacity-plan";

const apply = process.argv.includes("--apply");

function equipmentId(processCode: M20ProcessCode, sequence: number): string {
  return `M20-${processCode}-${String(sequence).padStart(3, "0")}`;
}

async function main() {
  const { equipmentMaster } = await collections();
  const current = await equipmentMaster.find({ fabId: "M20" }).sort({ processCode: 1, _id: 1 }).toArray();
  const legacyP11 = current.filter((tool) => tool.processCode === "P11");
  if (legacyP11.length) {
    throw new Error(`P11 장비 ${legacyP11.length}대가 원장에 남아 있습니다. 자동 병합하지 않고 수동 검토를 위해 중단합니다.`);
  }
  const allExistingIds = new Set(current.map((tool) => tool._id));
  const additions: EquipmentMasterDoc[] = [];
  const summary: Array<{ processCode: M20ProcessCode; current: number; target: number; add: number }> = [];
  const now = new Date();
  const targetTotal = Object.values(M20_DEFINED_EQUIPMENT_COUNTS).reduce((sum, count) => sum + count, 0);

  for (const [processIndex, process] of PROCESSES.entries()) {
    const processCode = process.code as M20ProcessCode;
    const target = M20_DEFINED_EQUIPMENT_COUNTS[processCode];
    const currentTools = current.filter((tool) => tool.processCode === processCode);
    if (currentTools.length > target) {
      throw new Error(`${processCode} 원장 ${currentTools.length}대가 정의 ${target}대를 초과합니다. 장비를 삭제하지 않고 중단합니다.`);
    }
    const needed = target - currentTools.length;
    const candidates = Array.from({ length: target }, (_, index) => index + 1)
      .filter((sequence) => !allExistingIds.has(equipmentId(processCode, sequence)));
    if (candidates.length < needed) throw new Error(`${processCode} deterministic ID 공간이 부족합니다.`);

    for (const sequence of candidates.slice(0, needed)) {
      additions.push({
        _id: equipmentId(processCode, sequence),
        fabId: "M20",
        processCode,
        model: `${process.nameEn.toUpperCase().replaceAll(" ", "-")}-M20`,
        bay: `M20-${processCode}-B${String(Math.floor((sequence - 1) / 12) + 1).padStart(2, "0")}`,
        position: { x: ((sequence - 1) % 12) - 5.5, y: 0, z: processIndex * 4 + Math.floor((sequence - 1) / 12) * 0.55 },
        status: "RUN",
        ratedCapacity: M20_MODELED_RATE_VALUES[processCode],
        // 기존 원장 스키마는 WAFER_DAY다. WPH 프록시는 별도 Equipment Master 계산에서만 사용한다.
        capacityUnit: "WAFER_DAY",
        oee: modeledOeeForSequence(sequence),
        source: "MODELED_BASELINE",
        updatedAt: now,
      });
    }
    summary.push({ processCode, current: currentTools.length, target, add: needed });
  }

  console.table(summary);
  console.log(`${FAB_EQUIPMENT_MASTER_VERSION} · current=${current.length} · target=${targetTotal} · additions=${additions.length} · mode=${apply ? "APPLY" : "DRY_RUN"}`);
  if (!apply) return;

  const snapshotPath = `/private/tmp/m20-equipment-master-before-${new Date().toISOString().replaceAll(":", "-")}.json`;
  await writeFile(snapshotPath, JSON.stringify({ version: FAB_EQUIPMENT_MASTER_VERSION, capturedAt: new Date().toISOString(), equipment: current }, null, 2), "utf8");
  console.log(`snapshot=${snapshotPath}`);

  if (additions.length) {
    await equipmentMaster.bulkWrite(additions.map((tool) => ({
      updateOne: { filter: { _id: tool._id }, update: { $setOnInsert: tool }, upsert: true },
    })), { ordered: true });
  }

  for (const row of summary) {
    const after = await equipmentMaster.countDocuments({ fabId: "M20", processCode: row.processCode });
    if (after !== row.target) throw new Error(`${row.processCode} 반영 후 ${after}대, 목표 ${row.target}대가 일치하지 않습니다.`);
  }
  const afterTotal = await equipmentMaster.countDocuments({ fabId: "M20" });
  if (afterTotal !== targetTotal) throw new Error(`M20 반영 후 총 ${afterTotal}대로 정의 ${targetTotal}대와 일치하지 않습니다.`);
  console.log(`✅ M20 Equipment Master applied: ${afterTotal} modeled tools`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
