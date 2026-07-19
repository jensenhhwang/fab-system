import "dotenv/config";
import { collections, type MaterialDoc } from "../src/lib/db";
import { M20_BASE_DIE_ASSUMPTION } from "../src/lib/route-contract";

const apply = process.argv.includes("--apply");

const MATERIALS: MaterialDoc[] = [
  {
    _id: M20_BASE_DIE_ASSUMPTION.materialId,
    code: M20_BASE_DIE_ASSUMPTION.materialId,
    name: M20_BASE_DIE_ASSUMPTION.materialName,
    nameEn: M20_BASE_DIE_ASSUMPTION.materialName,
    category: "PKG",
    unit: M20_BASE_DIE_ASSUMPTION.inventoryUom,
    purchaseUnit: M20_BASE_DIE_ASSUMPTION.purchaseUom,
    purchaseToInventoryFactor: M20_BASE_DIE_ASSUMPTION.assumedDiesPerTray,
    materialType: "DIRECT_COMPONENT",
    assumptionConfidence: "LOW",
    safetyStock: 0,
    ropDays: 30,
    notes: "외부 Logic Fab/Foundry KGD 조달 가정. P10.BASE_DIE_ATTACH에서 gross stack당 1개 투입; 99% incoming acceptance와 1,000 die/tray는 override 가능한 계획 가정",
  },
  { _id: "CSM-016", code: "CSM-016", name: "Edge Trim Blade/Wheel", nameEn: "Wafer Edge Trim Blade/Wheel", category: "CSM", unit: "개", safetyStock: 0, ropDays: 30, assumptionConfidence: "CALIBRATION_REQUIRED", notes: "P08.EDGE_TRIM 조건부 소모재. RATE_TBD" },
  { _id: "CSM-017", code: "CSM-017", name: "Dicing Blade", nameEn: "Wafer Dicing Blade", category: "CSM", unit: "개", safetyStock: 0, ropDays: 30, assumptionConfidence: "CALIBRATION_REQUIRED", notes: "P10.DICING blade-saw 방식 전용. RATE_TBD" },
  { _id: "CSM-018", code: "CSM-018", name: "Dicing UV Tape", nameEn: "Dicing UV Tape", category: "CSM", unit: "롤", safetyStock: 0, ropDays: 30, assumptionConfidence: "CALIBRATION_REQUIRED", notes: "P10.DICING wafer/frame 기준 소모. RATE_TBD" },
  { _id: "CSM-019", code: "CSM-019", name: "Memory KGD Die Tray", nameEn: "Memory KGD Die Tray", category: "CSM", unit: "TRAY", safetyStock: 0, ropDays: 30, materialType: "REUSABLE_CARRIER", assumptionConfidence: "CALIBRATION_REQUIRED", notes: "P10.DIE_SORT_KGD 산출 carrier. 적재량·회수율 RATE_TBD" },
];

async function main() {
  const { materials } = await collections();
  const existing = await materials.find({ _id: { $in: MATERIALS.map((material) => material._id) } }).toArray();
  console.table(MATERIALS.map((material) => ({
    materialId: material._id,
    operation: material._id === "PKG-LBD-001" ? "P10.BASE_DIE_ATTACH" : material.notes?.split(" ")[0],
    status: existing.some((row) => row._id === material._id) ? "UPDATE" : "ADD",
    confidence: material.assumptionConfidence,
  })));
  console.log(`mode=${apply ? "APPLY" : "DRY_RUN"}`);
  if (!apply) return;
  await materials.bulkWrite(MATERIALS.map(({ _id, ...fields }) => ({
    updateOne: { filter: { _id }, update: { $set: fields, $setOnInsert: { _id } }, upsert: true },
  })), { ordered: true });
  console.log(`✅ M20 back-end material master applied: ${MATERIALS.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
