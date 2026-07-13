import type { InventoryLotDoc } from "@/lib/db";

export type LotConsumeStep = {
  lotId: string;
  lotNo: string;
  consumeQty: number;
  remainingAfter: number;
};

export type FefoResult = {
  steps: LotConsumeStep[];
  fulfilled: boolean;
  totalAvailable: number;
};

export function computeFefo(lots: InventoryLotDoc[], requestQty: number): FefoResult {
  const available = lots.filter(
    (l) => l.qualityStatus === "AVAILABLE" && l.availableQuantity > 0
  );
  // FEFO: expiryDate ASC. 없으면 receivedAt ASC (FIFO)
  const sorted = [...available].sort((a, b) => {
    if (a.expiryDate && b.expiryDate) return a.expiryDate.getTime() - b.expiryDate.getTime();
    if (a.expiryDate) return -1;
    if (b.expiryDate) return 1;
    return a.receivedAt.getTime() - b.receivedAt.getTime();
  });

  const totalAvailable = sorted.reduce((s, l) => s + l.availableQuantity, 0);
  const steps: LotConsumeStep[] = [];
  let remaining = requestQty;

  for (const lot of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(lot.availableQuantity, remaining);
    steps.push({ lotId: lot._id, lotNo: lot.lotNo, consumeQty: take, remainingAfter: lot.availableQuantity - take });
    remaining -= take;
  }

  return { steps, fulfilled: remaining <= 0, totalAvailable };
}
