import "dotenv/config";
import { collections } from "../src/lib/db";
import { getMaterialDailyUsage } from "../src/lib/queries";

const NEAR_TWO_MIN = 1.5;
const NEAR_TWO_MAX = 2.5;

async function main() {
  const { materials, inventory, inventoryLots, handlingUnits } = await collections();
  const [materialDocs, inventoryDocs, lotDocs, unitDocs, usage] = await Promise.all([
    materials.find({}).sort({ code: 1 }).toArray(),
    inventory.find({}).toArray(),
    inventoryLots.find({ simulated: { $ne: true } }).toArray(),
    handlingUnits.find({}).toArray(),
    getMaterialDailyUsage(),
  ]);

  const rows = materialDocs.map(material => {
    const inv = inventoryDocs.filter(item => item.materialId === material._id);
    const lots = lotDocs.filter(item => item.materialId === material._id);
    const units = unitDocs.filter(item => item.materialId === material._id);
    const inventoryTotal = inv.reduce((sum, item) => sum + item.quantity, 0);
    const inventoryAvailable = inv.filter(item => !item.status || item.status === "AVAILABLE").reduce((sum, item) => sum + item.quantity, 0);
    const legacyDaily = inv.reduce((max, item) => Math.max(max, item.avgDailyUsage ?? 0), 0);
    const lotAvailable = lots.filter(item => item.qualityStatus === "AVAILABLE").reduce((sum, item) => sum + item.availableQuantity, 0);
    const lotRestricted = lots.filter(item => item.qualityStatus === "HOLD" || item.qualityStatus === "QUARANTINE").reduce((sum, item) => sum + item.availableQuantity, 0);
    const huAvailable = units.filter(item => item.status === "AVAILABLE").reduce((sum, item) => sum + item.quantity, 0);
    const daily = usage.get(material._id)?.daily ?? 0;
    return {
      id: material._id, code: material.code, name: material.name, daily, legacyDaily, ropDays: material.ropDays,
      inventoryRows: inv.length, inventoryTotal, inventoryAvailable,
      lotCount: lots.length, lotAvailable, lotRestricted,
      huCount: units.length, huAvailable,
      inventoryDoh: daily > 0 ? inventoryAvailable / daily : null,
      lotDoh: daily > 0 && lots.length > 0 ? lotAvailable / daily : null,
    };
  });

  const nearTwo = rows.filter(row => row.inventoryDoh != null && row.inventoryDoh >= NEAR_TWO_MIN && row.inventoryDoh <= NEAR_TWO_MAX);
  const critical = rows.filter(row => row.inventoryDoh != null && row.inventoryDoh < 5 && row.ropDays > 0);
  const scaleMismatch = rows.filter(row => row.legacyDaily > 0 && row.daily / row.legacyDaily >= 1.5);
  const lotCovered = rows.filter(row => row.lotCount > 0);
  const mismatchedLot = lotCovered.filter(row => Math.abs(row.inventoryAvailable - row.lotAvailable) > 1e-9);
  const mismatchedHu = rows.filter(row => row.huCount > 0 && Math.abs(row.inventoryAvailable - row.huAvailable) > 1e-9);

  console.log(`[inventory-audit] materials=${rows.length} inventoryRows=${inventoryDocs.length} realLots=${lotDocs.length} handlingUnits=${unitDocs.length}`);
  console.log(`[inventory-audit] criticalUnder5d=${critical.length} near2d=${nearTwo.length} usageScaleMismatch=${scaleMismatch.length} lotCovered=${lotCovered.length} lotMismatch=${mismatchedLot.length} huMismatch=${mismatchedHu.length}`);
  console.log("\n[DOH 5일 미만 · inventory projection]");
  for (const row of critical) console.log(`${row.code}\t${row.name}\tDOH=${row.inventoryDoh?.toFixed(2)}\tROP=${row.ropDays}\tavailable=${row.inventoryAvailable}\tdaily=${row.daily.toFixed(2)}\tlegacyDaily=${row.legacyDaily}`);
  console.log("\n[DOH 1.5~2.5일 · inventory projection]");
  for (const row of nearTwo) console.log(`${row.code}\t${row.name}\tDOH=${row.inventoryDoh?.toFixed(2)}\tavailable=${row.inventoryAvailable}\tdaily=${row.daily.toFixed(2)}\twarehouses=${row.inventoryRows}\tlots=${row.lotCount}`);
  console.log("\n[사용량 스케일 불일치 후보 · processDaily / legacyDaily >= 1.5]");
  for (const row of scaleMismatch) console.log(`${row.code}\tratio=${(row.daily / row.legacyDaily).toFixed(2)}\tcurrent=${row.inventoryAvailable}\tproposed=${Math.round(row.inventoryAvailable * row.daily / row.legacyDaily)}\tDOH=${row.inventoryDoh?.toFixed(2) ?? "—"}`);
  console.log("\n[Lot projection 불일치 · Lot 보유 자재]");
  for (const row of mismatchedLot) console.log(`${row.code}\tinventory=${row.inventoryAvailable}\tlotAvailable=${row.lotAvailable}\trestricted=${row.lotRestricted}\tdelta=${(row.lotAvailable - row.inventoryAvailable).toFixed(2)}`);
  console.log("\n[Handling Unit projection 불일치]");
  for (const row of mismatchedHu.slice(0, 30)) console.log(`${row.code}\tinventory=${row.inventoryAvailable}\thuAvailable=${row.huAvailable}\tdelta=${(row.huAvailable - row.inventoryAvailable).toFixed(2)}`);
  if (mismatchedHu.length > 30) console.log(`... ${mismatchedHu.length - 30}건 추가`);
}

main().catch(error => { console.error(error); process.exit(1); });
