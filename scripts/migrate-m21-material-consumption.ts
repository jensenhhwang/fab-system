import "dotenv/config";
import { collections } from "../src/lib/db";
import { m21ProcessUsageForScenario } from "../src/lib/material-consumption";

const apply = process.argv.includes("--apply");

async function main() {
  const { processUsage } = await collections();
  const targetRows = m21ProcessUsageForScenario();
  const existingRows = await processUsage.find({ fabId: "M21", product: "DRAM" }).toArray();
  const existingById = new Map(existingRows.map((row) => [row._id, row]));

  let changed = 0;
  for (const row of targetRows) {
    const before = existingById.get(row._id);
    if (!before
      || before.monthlyQty !== row.monthlyQty
      || before.equivalentPerWafer !== row.equivalentPerWafer
      || before.sourceVersion !== row.sourceVersion
      || before.modelProduct !== row.modelProduct
      || before.routeVersion !== row.routeVersion
      || before.operationCode !== row.operationCode
      || before.active !== true) changed += 1;
  }

  console.log(`[m21-consumption] mode=${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`[m21-consumption] existing=${existingRows.length} target=${targetRows.length} changed=${changed}`);

  if (!apply) {
    console.log("변경 없음. 실제 적용: npx dotenv-cli -e .env -- npx tsx scripts/migrate-m21-material-consumption.ts -- --apply");
    return;
  }

  const result = await processUsage.bulkWrite(targetRows.map((row) => {
    const { _id, ...fields } = row;
    return { updateOne: { filter: { _id }, update: { $set: fields }, upsert: true } };
  }), { ordered: false });

  const targetIds = targetRows.map((row) => row._id);
  const deactivated = await processUsage.updateMany(
    { fabId: "M21", product: "DRAM", source: "MODELED_BASELINE", _id: { $nin: targetIds }, active: { $ne: false } },
    { $set: { active: false } },
  );

  console.log(`[m21-consumption] matched=${result.matchedCount} modified=${result.modifiedCount} upserted=${result.upsertedCount}`);
  console.log(`[m21-consumption] deactivatedModeledBaseline=${deactivated.modifiedCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
