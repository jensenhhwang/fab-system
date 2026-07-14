import { collections } from "../src/lib/db";
import type { BomTemplateDoc } from "../src/lib/db";

async function main() {
  const { processUsage, bomTemplates } = await collections();
  const usages = await processUsage.find({}).toArray();

  const map = new Map<string, { processCode: string; product: string; lines: { materialId: string; qtyPerRun: number }[] }>();

  for (const u of usages) {
    const key = `${u.processCode}-${u.product}`;
    if (!map.has(key)) {
      map.set(key, { processCode: u.processCode, product: u.product, lines: [] });
    }
    map.get(key)!.lines.push({
      materialId: u.materialId,
      qtyPerRun: Math.round((u.monthlyQty / 30) * 100) / 100,
    });
  }

  let upserted = 0;
  for (const [id, template] of map) {
    const doc: BomTemplateDoc = {
      _id: id,
      processCode: template.processCode,
      product: template.product as BomTemplateDoc["product"],
      lines: template.lines,
      updatedAt: new Date(),
    };
    await bomTemplates.replaceOne({ _id: id }, doc, { upsert: true });
    upserted++;
  }

  console.log(`✅ BOM 템플릿 ${upserted}개 시딩 완료`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
