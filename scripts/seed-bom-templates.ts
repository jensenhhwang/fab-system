import { collections } from "../src/lib/db";
import type { BomTemplateDoc } from "../src/lib/db";

async function main() {
  const { processUsage, bomTemplates } = await collections();
  const usages = await processUsage.find({ active: { $ne: false } }).toArray();

  const map = new Map<string, { processCode: string; product: string; routeKey?: string; routeVersion?: string; operationCode?: string; lines: { materialId: string; qtyPerRun: number }[] }>();

  for (const u of usages) {
    const key = u.routeVersion && u.operationCode
      ? `${u.routeVersion}__${u.processCode}__${u.operationCode}__${u.product}`
      : `${u.processCode}-${u.product}`;
    if (!map.has(key)) {
      map.set(key, { processCode: u.processCode, product: u.product, routeKey: u.routeKey, routeVersion: u.routeVersion, operationCode: u.operationCode, lines: [] });
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
      routeKey: template.routeKey,
      routeVersion: template.routeVersion,
      operationCode: template.operationCode,
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
