import { db } from "@/lib/db";
import UsageClient from "./UsageClient";

async function getUsageData() {
  const usages = await db.processUsage.findMany({
    include: { material: true },
    orderBy: [{ processCode: "asc" }, { product: "asc" }],
  });

  // 자재별로 그룹핑: { materialId → { name, code, category, processes: Set<code> } }
  const materialMap = new Map<string, {
    id: string; code: string; name: string; category: string;
    processes: string[]; products: string[];
    usages: { proc: string; product: string; qty: number }[];
  }>();

  for (const u of usages) {
    const key = u.materialId;
    if (!materialMap.has(key)) {
      materialMap.set(key, {
        id: u.materialId,
        code: u.material.code,
        name: u.material.name,
        category: u.material.category,
        processes: [],
        products: [],
        usages: [],
      });
    }
    const entry = materialMap.get(key)!;
    if (!entry.processes.includes(u.processCode)) entry.processes.push(u.processCode);
    if (!entry.products.includes(u.product)) entry.products.push(u.product);
    entry.usages.push({ proc: u.processCode, product: u.product, qty: u.monthlyQty });
  }

  return Array.from(materialMap.values()).sort((a, b) => a.code.localeCompare(b.code));
}

export default async function UsagePage() {
  const materials = await getUsageData();
  return <UsageClient materials={materials} />;
}
