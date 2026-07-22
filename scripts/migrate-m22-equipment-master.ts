import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { collections, type EquipmentMasterDoc } from "../src/lib/db";
import {
  FAB_EQUIPMENT_MASTER_M22_VERSION,
  M22_DEFINED_EQUIPMENT_COUNTS,
  M22_P10_TOTAL,
  M22_PROCESS_RATED_WPH,
  modeledOeeForSequence,
  type M22WphProcessCode,
} from "../src/lib/m22-equipment-capacity-plan";

const apply = process.argv.includes("--apply");

function equipmentId(processCode: string, sequence: number): string {
  return `M22-${processCode}-${String(sequence).padStart(3, "0")}`;
}

// P10 대수는 RATE_TBD placeholder라 ratedCapacity에 M20과 동일한 자리수(140 WAFER_DAY)를 재사용한다.
const P10_PLACEHOLDER_RATED_CAPACITY = 140;

async function main() {
  const { equipmentMaster } = await collections();
  const current = await equipmentMaster.find({ fabId: "M22" }).toArray();
  const allExistingIds = new Set(current.map((tool) => tool._id));

  const targets: Array<{ processCode: string; target: number; ratedCapacity: number }> = [
    ...(Object.entries(M22_DEFINED_EQUIPMENT_COUNTS) as [M22WphProcessCode, number][])
      .map(([processCode, target]) => ({ processCode, target, ratedCapacity: M22_PROCESS_RATED_WPH[processCode] })),
    { processCode: "P10", target: M22_P10_TOTAL, ratedCapacity: P10_PLACEHOLDER_RATED_CAPACITY },
  ];

  const additions: EquipmentMasterDoc[] = [];
  const summary: Array<{ processCode: string; current: number; target: number; add: number }> = [];
  const now = new Date();
  const targetTotal = targets.reduce((sum, t) => sum + t.target, 0);

  for (const [processIndex, { processCode, target, ratedCapacity }] of targets.entries()) {
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
        fabId: "M22",
        processCode,
        model: `M22-${processCode}-NAND`,
        bay: `M22-${processCode}-B${String(Math.floor((sequence - 1) / 12) + 1).padStart(2, "0")}`,
        position: { x: ((sequence - 1) % 12) - 5.5, y: 0, z: processIndex * 4 + Math.floor((sequence - 1) / 12) * 0.55 },
        status: "RUN",
        ratedCapacity,
        capacityUnit: "WAFER_DAY",
        oee: modeledOeeForSequence(sequence),
        source: "MODELED_BASELINE",
        updatedAt: now,
      });
    }
    summary.push({ processCode, current: currentTools.length, target, add: needed });
  }

  console.table(summary);
  console.log(`${FAB_EQUIPMENT_MASTER_M22_VERSION} · current=${current.length} · target=${targetTotal} · additions=${additions.length} · mode=${apply ? "APPLY" : "DRY_RUN"}`);
  if (!apply) return;

  const snapshotPath = `/private/tmp/m22-equipment-master-before-${new Date().toISOString().replaceAll(":", "-")}.json`;
  await writeFile(snapshotPath, JSON.stringify({ version: FAB_EQUIPMENT_MASTER_M22_VERSION, capturedAt: new Date().toISOString(), equipment: current }, null, 2), "utf8");
  console.log(`snapshot=${snapshotPath}`);

  if (additions.length) {
    await equipmentMaster.bulkWrite(additions.map((tool) => ({
      updateOne: { filter: { _id: tool._id }, update: { $setOnInsert: tool }, upsert: true },
    })), { ordered: true });
  }

  for (const row of summary) {
    const after = await equipmentMaster.countDocuments({ fabId: "M22", processCode: row.processCode });
    if (after !== row.target) throw new Error(`${row.processCode} 반영 후 ${after}대, 목표 ${row.target}대가 일치하지 않습니다.`);
  }
  const afterTotal = await equipmentMaster.countDocuments({ fabId: "M22" });
  if (afterTotal !== targetTotal) throw new Error(`M22 반영 후 총 ${afterTotal}대로 정의 ${targetTotal}대와 일치하지 않습니다.`);
  console.log(`✅ M22 Equipment Master applied: ${afterTotal} modeled tools`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
