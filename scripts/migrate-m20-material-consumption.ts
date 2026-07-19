import "dotenv/config";
import { collections } from "../src/lib/db";
import { m20ProcessUsageForScenario } from "../src/lib/material-consumption";

const apply = process.argv.includes("--apply");

async function main() {
  const { processUsage } = await collections();
  const targetRows = m20ProcessUsageForScenario("NORMAL");
  const existingRows = await processUsage.find({ fabId: "M20", product: "HBM" }).toArray();
  const existingById = new Map(existingRows.map((row) => [row._id, row]));

  let changed = 0;
  let quantityChanged = 0;
  let metadataChanged = 0;
  for (const row of targetRows) {
    const before = existingById.get(row._id);
    if (!before || before.monthlyQty !== row.monthlyQty) quantityChanged += 1;
    if (!before
      || before.equivalentPerWafer !== row.equivalentPerWafer
      || before.sourceVersion !== row.sourceVersion
      || before.modelProduct !== row.modelProduct
      || before.routeVersion !== row.routeVersion
      || before.operationCode !== row.operationCode
      || before.active !== true) metadataChanged += 1;
    if (!before
      || before.monthlyQty !== row.monthlyQty
      || before.equivalentPerWafer !== row.equivalentPerWafer
      || before.sourceVersion !== row.sourceVersion
      || before.modelProduct !== row.modelProduct
      || before.routeVersion !== row.routeVersion
      || before.operationCode !== row.operationCode
      || before.active !== true) changed += 1;
  }

  console.log(`[m20-consumption] mode=${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`[m20-consumption] existing=${existingRows.length} target=${targetRows.length} changed=${changed}`);
  console.log(`[m20-consumption] quantityChanged=${quantityChanged} metadataChanged=${metadataChanged}`);
  console.log("[m20-consumption] NORMAL=117,000 WSPM, activeMaterials=44, processRows=49, routeScoped=V3/P10");
  for (const row of targetRows.filter((target) => existingById.get(target._id)?.monthlyQty !== target.monthlyQty).slice(0, 10)) {
    console.log(`[m20-consumption] qty-diff ${row._id} current=${existingById.get(row._id)?.monthlyQty ?? "MISSING"} target=${row.monthlyQty}`);
  }

  if (!apply) {
    console.log("변경 없음. 실제 적용: npx dotenv-cli -e .env -- npx tsx scripts/migrate-m20-material-consumption.ts -- --apply");
    return;
  }

  const result = await processUsage.bulkWrite(targetRows.map((row) => {
    const { _id, ...fields } = row;
    return {
      updateOne: {
        filter: { _id },
        update: { $set: fields },
        upsert: true,
      },
    };
  }), { ordered: false });

  const targetIds = targetRows.map((row) => row._id);
  const deactivated = await processUsage.updateMany(
    {
      fabId: "M20",
      product: "HBM",
      source: "MODELED_BASELINE",
      _id: { $nin: targetIds },
      active: { $ne: false },
    },
    { $set: { active: false } },
  );

  console.log(`[m20-consumption] matched=${result.matchedCount} modified=${result.modifiedCount} upserted=${result.upsertedCount}`);
  console.log(`[m20-consumption] deactivatedModeledBaseline=${deactivated.modifiedCount}; MES_ACTUAL rows preserved`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
