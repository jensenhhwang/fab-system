import { buildControlTowerSnapshot } from "../src/lib/control-tower";

const snapshot = buildControlTowerSnapshot(
  [
    {
      materialId: "MAT-1",
      quantity: 12_000,
      avgDailyUsage: 999,
      status: "AVAILABLE",
      material: { code: "MAT-1", name: "공용 자재", unit: "kg", ropDays: 7 },
    },
    {
      materialId: "MAT-1",
      quantity: 500,
      avgDailyUsage: 999,
      status: "HOLD",
      material: { code: "MAT-1", name: "공용 자재", unit: "kg", ropDays: 7 },
    },
  ],
  [
    { materialId: "MAT-1", product: "HBM", monthlyQty: 60_000 },
    { materialId: "MAT-1", product: "DRAM", monthlyQty: 30_000 },
    { materialId: "MAT-1", product: "NAND", monthlyQty: 30_000 },
  ],
  new Date("2026-07-16T00:00:00.000Z"),
);

const material = snapshot.materials[0];
console.assert(material.availableQuantity === 12_000, "가용재고는 HOLD 수량을 제외해야 한다");
console.assert(material.excludedQuantity === 500, "HOLD 수량을 제외량으로 보여줘야 한다");
console.assert(material.dailyUsage === 4_000, "3FAB 일사용량을 합산해야 한다");
console.assert(material.coverageDays === 3, "통합 잔여일은 가용재고 ÷ 3FAB 일사용량이다");
console.assert(material.fabs.find((fab) => fab.fabId === "M20")?.dailyUsage === 2_000, "HBM은 M20 수요다");
console.assert(material.fabs.find((fab) => fab.fabId === "M21")?.dailyUsage === 1_000, "DRAM은 M21 수요다");
console.assert(material.fabs.find((fab) => fab.fabId === "M22")?.dailyUsage === 1_000, "NAND는 M22 수요다");
console.assert(material.fabs.every((fab) => fab.coverageDays === 3), "공용재 비례배분 커버리지가 일치해야 한다");
console.log("✅ control tower coverage rules passed");
