export const dynamic = "force-dynamic";

import { getBenefitCases, getInventoryRows } from "@/lib/queries";
import ValueClient from "./ValueClient";

export default async function ValuePage() {
  const [cases, inventory] = await Promise.all([getBenefitCases(), getInventoryRows(true)]);
  const materials = [...new Map(inventory.map((row) => [row.materialId, { id: row.materialId, code: row.material.code, name: row.material.name, unit: row.material.unit }])).values()];
  return <ValueClient cases={cases.map((item) => ({ ...item, detectedAt: item.detectedAt.toISOString(), validatedAt: item.validatedAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() }))} materials={materials} />;
}
