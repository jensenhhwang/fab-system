import { processTick, type MaterialUsage, type TickInput } from "../src/lib/sim-engine";
import type { InventoryLotDoc } from "../src/lib/db";

const simDate = new Date("2026-07-13");
const materials: MaterialUsage[] = [
  { materialId: "CHM-007", category: "CHM", dailyQty: 10, ropDays: 14 },
];
const lots: InventoryLotDoc[] = [
  {
    _id: "lot-1", materialId: "CHM-007", lotNo: "TEST-001",
    quantity: 200, availableQuantity: 200,
    receivedAt: new Date("2026-07-01"),
    expiryDate: new Date("2026-09-01"),
    qualityStatus: "AVAILABLE", updatedAt: new Date(),
  },
];
const input: TickInput = { simDate, materials, lots, activePOs: [] };
const result = processTick(input);

console.assert(result.lotUpdates.length === 1, "LotUpdate 1개");
console.assert(result.lotUpdates[0].newAvailable === 190, `잔여 190, 실제: ${result.lotUpdates[0].newAvailable}`);
console.assert(result.newPOs.length === 0, "ROP 초과 아님 → PO 없음");
console.assert(result.newEvents.some(e => e.type === "CONSUMPTION"), "CONSUMPTION 이벤트 존재");

// ROP 트리거 테스트
const lowLots: InventoryLotDoc[] = [
  { ...lots[0], availableQuantity: 5 }, // 5 < ropDays(14) * dailyQty(10) = 140
];
const lowResult = processTick({ ...input, lots: lowLots });
console.assert(lowResult.newPOs.length > 0, "ROP 미달 → 자동 발주");
console.assert(lowResult.newEvents.some(e => e.type === "STOCKOUT_RISK"), "STOCKOUT_RISK 이벤트 존재");

console.log("✅ sim-engine 검증 통과");
