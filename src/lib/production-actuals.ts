import { collections } from "@/lib/db";
import type { Product, ProductionActualDoc } from "@/lib/db";
import { fabForProduct } from "@/lib/fab-domain";
import { dailyPlanKWafer } from "@/lib/fab-scenario";

export const PRODUCTS: Product[] = ["HBM", "DRAM", "NAND"];

// 서버 UTC 시각을 KST(UTC+9) 기준 "YYYY-MM-DD"로 변환합니다.
export function todayKST(): string {
  const kst = new Date(Date.now() + 9 * 3600_000);
  return kst.toISOString().slice(0, 10);
}

function actualId(product: Product, date: string) {
  return `${fabForProduct(product)}:${product}:${date}`;
}

export async function getActualsForDate(date: string): Promise<Record<Product, ProductionActualDoc | null>> {
  const { productionActuals } = await collections();
  const docs = await productionActuals.find({ date, product: { $in: PRODUCTS } }).toArray();
  const byProduct = new Map(docs.map((doc) => [doc.product, doc]));
  return { HBM: byProduct.get("HBM") ?? null, DRAM: byProduct.get("DRAM") ?? null, NAND: byProduct.get("NAND") ?? null };
}

export async function confirmProductionActual(input: {
  product: Product;
  date: string;
  producedQty: number;
  note?: string;
  reason?: string;
  enteredBy: string;
}): Promise<ProductionActualDoc> {
  const { productionActuals } = await collections();
  const _id = actualId(input.product, input.date);
  const existing = await productionActuals.findOne({ _id });
  const now = new Date();

  if (existing) {
    if (existing.producedQty === input.producedQty && (input.note ?? "") === (existing.note ?? "")) {
      return existing;
    }
    if (!input.reason?.trim()) {
      throw new Error("이미 확정된 실적입니다. 수정하려면 사유를 입력해야 합니다.");
    }
    await productionActuals.updateOne(
      { _id },
      {
        $set: { producedQty: input.producedQty, note: input.note, enteredBy: input.enteredBy, confirmedAt: now, updatedAt: now },
        $push: { revisions: { producedQty: input.producedQty, note: input.note, reason: input.reason, enteredBy: input.enteredBy, recordedAt: now } },
      },
    );
    return (await productionActuals.findOne({ _id }))!;
  }

  const doc: ProductionActualDoc = {
    _id,
    fabId: fabForProduct(input.product),
    product: input.product,
    date: input.date,
    producedQty: input.producedQty,
    planQty: dailyPlanKWafer(input.product),
    unit: "K_WAFER",
    note: input.note,
    source: "MANUAL",
    enteredBy: input.enteredBy,
    confirmedAt: now,
    revisions: [{ producedQty: input.producedQty, note: input.note, enteredBy: input.enteredBy, recordedAt: now }],
    createdAt: now,
    updatedAt: now,
  };
  await productionActuals.insertOne(doc);
  return doc;
}
