import "dotenv/config";
import { getInventoryRows, getMaterialDailyUsage, getWarehouseCapacity } from "../src/lib/queries";

async function main() {
  const [rows, usage, facilities] = await Promise.all([
    getInventoryRows(true), getMaterialDailyUsage(), getWarehouseCapacity(),
  ]);
  const errors: string[] = [];
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.materialId, (totals.get(row.materialId) ?? 0) + row.quantity);

  for (const row of rows) {
    const expectedTotal = totals.get(row.materialId) ?? 0;
    const expectedUsage = usage.get(row.materialId)?.daily ?? 0;
    const expectedDoh = expectedUsage > 0 ? expectedTotal / expectedUsage : null;
    if (row.totalQuantity !== expectedTotal) errors.push(`${row.materialId}: totalQuantity 불일치`);
    if (Math.abs(row.dailyUsage - expectedUsage) > 1e-9) errors.push(`${row.materialId}: dailyUsage 불일치`);
    if (expectedDoh === null ? row.doh !== null : row.doh === null || Math.abs(row.doh - expectedDoh) > 1e-9) {
      errors.push(`${row.materialId}: DOH 불일치`);
    }
  }
  for (const facility of facilities) {
    if (!Number.isFinite(facility.occupancy) || !Number.isFinite(facility.utilization)) errors.push(`${facility.code}: Capacity 비정상`);
  }
  const facilityCodes = new Set(facilities.map((facility) => facility.code));
  for (const row of rows) if (!facilityCodes.has(row.warehouse.code)) errors.push(`${row.materialId}: 시설 참조 누락`);

  if (errors.length) throw new Error(`정합 검증 실패 (${errors.length}건)\n${errors.join("\n")}`);
  console.log(`[consistency] PASS inventoryRows=${rows.length}, materials=${totals.size}, usage=${usage.size}, facilities=${facilities.length}`);
  console.log("[consistency] DOH = SUM(all facility inventory) / (SUM ProcessUsage monthlyQty / 30)");
  console.log("[consistency] capacity:", facilities.map((facility) => `${facility.code}=${facility.utilization}%`).join(", "));
}

main();
