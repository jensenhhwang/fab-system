import { collections } from "../src/lib/db";
import { installInventoryV2Indexes } from "../src/lib/inventory-v2-indexes";

const apply = process.argv.includes("--apply");
const dbCollections = await collections();
const result = await installInventoryV2Indexes({
  inventoryBalancesV2: dbCollections.inventoryBalancesV2,
  inventoryMovementsV2: dbCollections.inventoryMovementsV2,
  materialUomRulesV2: dbCollections.materialUomRulesV2,
}, { apply });

console.log(JSON.stringify({
  mode: apply ? "APPLY" : "DRY_RUN",
  ...result,
}, null, 2));
