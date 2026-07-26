import "dotenv/config";
import { collections } from "../src/lib/db";

// CSM-016~019(백엔드 소모재) 계획 가정 보정 — 원단위·기초재고·공급사 채우기.
// ⚠️ 실측이 아니라 "계획 가정치"(CSM_BACKEND_PLANNING_V0). 실측 원단위가 확보되면 교체해야 한다.
// migrate-m20-backend-materials.ts가 만든 미보정 스텁(RATE_TBD)의 짝.
// dry-run 기본, 반영은 `--apply`.

const apply = process.argv.includes("--apply");
const SOURCE_VERSION = "CSM_BACKEND_PLANNING_V0";
const now = new Date();
const d = (offsetDays: number) => new Date(now.getTime() + offsetDays * 86400000);

const SUPPLIERS = [
  { _id: "sup-disco", name: "DISCO Corporation", country: "JP", notes: "다이싱 블레이드·UV 테이프·엣지 트림 소모재 공급" },
  { _id: "sup-peakintl", name: "Peak International", country: "US", notes: "Memory KGD Die Tray·반도체 캐리어 공급" },
];

// 계획 가정 원단위 (M20/HBM, 월소요 monthlyQty; 일소요 = /30 WORKING_DAYS)
const CALIBRATION = [
  { code: "CSM-016", proc: "P08", monthlyQty: 30,  basis: "REPLACEMENT_LIFE", supId: "sup-disco",    leadTimeDays: 45, whCode: "MWH-01", safetyStock: 45,  openingQty: 60,  unit: "개" },
  { code: "CSM-017", proc: "P10", monthlyQty: 45,  basis: "REPLACEMENT_LIFE", supId: "sup-disco",    leadTimeDays: 45, whCode: "MWH-01", safetyStock: 70,  openingQty: 90,  unit: "개" },
  { code: "CSM-018", proc: "P10", monthlyQty: 300, basis: "WAFER_VISIT",      supId: "sup-disco",    leadTimeDays: 30, whCode: "MWH-02", safetyStock: 300, openingQty: 450, unit: "롤" },
  { code: "CSM-019", proc: "P10", monthlyQty: 15,  basis: "REPLACEMENT_LIFE", supId: "sup-peakintl", leadTimeDays: 30, whCode: "MWH-01", safetyStock: 15,  openingQty: 25,  unit: "TRAY" },
] as const;

async function main() {
  const { suppliers, materialSuppliers, processUsage, materials, inventoryLots } = await collections();

  const plan: string[] = [];

  // 1) 공급사
  const supplierOps = SUPPLIERS.map((s) => ({
    updateOne: { filter: { _id: s._id }, update: { $set: { name: s.name, country: s.country, notes: s.notes }, $setOnInsert: { _id: s._id } }, upsert: true },
  }));
  plan.push(`suppliers upsert: ${SUPPLIERS.map((s) => s._id).join(", ")}`);

  // 2) 공급사 링크 / 3) 원단위 / 4) 마스터 safetyStock / 5) 기초재고 lot
  const linkOps = [];
  const usageOps = [];
  const materialOps = [];
  const lotOps = [];
  const positionOps = [];

  for (const c of CALIBRATION) {
    const dailyQty = Math.round((c.monthlyQty / 30) * 100) / 100;

    positionOps.push({
      updateOne: {
        filter: { _id: `${c.code}__${c.whCode}` },
        update: {
          $set: { materialId: c.code, warehouseId: c.whCode, quantity: c.openingQty, avgDailyUsage: dailyQty, status: "AVAILABLE", updatedAt: now },
          $setOnInsert: { _id: `${c.code}__${c.whCode}` },
        },
        upsert: true,
      },
    });

    linkOps.push({
      updateOne: {
        filter: { _id: `${c.code}__${c.supId}` },
        update: {
          $set: {
            materialId: c.code, supplierId: c.supId, leadTimeDays: c.leadTimeDays, isPrimary: true,
            standardLeadTimeDays: c.leadTimeDays, qualificationStatus: "APPROVED", sourcingRole: "PRIMARY", emergencyOrderAllowed: false,
            updatedAt: now,
          },
          $setOnInsert: { _id: `${c.code}__${c.supId}` },
        },
        upsert: true,
      },
    });

    usageOps.push({
      updateOne: {
        filter: { _id: `PU-${c.code}-${c.proc}-HBM` },
        update: {
          $set: {
            materialId: c.code, processCode: c.proc, product: "HBM", monthlyQty: c.monthlyQty,
            fabId: "M20", active: true, source: "MODELED_BASELINE", sourceVersion: SOURCE_VERSION, consumptionBasis: c.basis,
          },
          $setOnInsert: { _id: `PU-${c.code}-${c.proc}-HBM` },
        },
        upsert: true,
      },
    });

    materialOps.push({
      updateOne: {
        filter: { _id: c.code },
        update: { $set: { safetyStock: c.safetyStock } },
      },
    });

    lotOps.push({
      updateOne: {
        filter: { _id: `LOT-${c.code.replace("-", "")}-CAL01` },
        update: {
          $set: {
            materialId: c.code, lotNo: `${c.code}-CAL01`, quantity: c.openingQty, availableQuantity: c.openingQty,
            receivedAt: d(-15), qualityStatus: "AVAILABLE", warehouseId: c.whCode, updatedAt: now,
          },
          $setOnInsert: { _id: `LOT-${c.code.replace("-", "")}-CAL01` },
        },
        upsert: true,
      },
    });

    plan.push(`${c.code}: 원단위 ${c.monthlyQty}/월(${dailyQty}/일, ${c.basis}) · 공급사 ${c.supId} L/T ${c.leadTimeDays}d · 안전재고 ${c.safetyStock} · 기초 ${c.openingQty}${c.unit}(${c.whCode})`);
  }

  console.log("── CSM-016~019 백엔드 계획 보정 (CSM_BACKEND_PLANNING_V0) ──");
  for (const line of plan) console.log("  " + line);

  if (!apply) {
    console.log("\n[dry-run] 반영하려면 --apply 를 붙이세요.");
    return;
  }

  const { inventory } = await collections();
  await suppliers.bulkWrite(supplierOps as never[]);
  await materialSuppliers.bulkWrite(linkOps as never[]);
  await processUsage.bulkWrite(usageOps as never[]);
  await materials.bulkWrite(materialOps as never[]);
  await inventoryLots.bulkWrite(lotOps as never[]);
  await inventory.bulkWrite(positionOps as never[]);

  console.log(`\n✅ 반영 완료 — 공급사 ${SUPPLIERS.length}, 링크/원단위/포지션/lot 각 ${CALIBRATION.length}건.`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
