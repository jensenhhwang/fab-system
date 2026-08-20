import "dotenv/config";
import { collections, getMongoClient } from "../src/lib/db";
import { buildProcurementSummary } from "../src/lib/procurement";
import { getInventoryRows } from "../src/lib/queries";
import { resolveLeadTimeDays } from "../src/lib/twin/lead-time";

// 자재별 조달 마스터 결손 유형을 실제 판정 함수(buildProcurementSummary)로 분류한다.
// calibrate-inventory-policy가 BLOCKED_MASTER_DATA를 내는 조건과 같은 경로를 쓴다.
async function main() {
  const { materials, suppliers, materialSuppliers } = await collections();
  const [rows, materialDocs, supplierDocs, links] = await Promise.all([
    getInventoryRows(true), materials.find({}).toArray(), suppliers.find({}).toArray(), materialSuppliers.find({}).toArray(),
  ]);
  const linksByMaterial = new Map<string, typeof links>();
  for (const l of links) linksByMaterial.set(l.materialId, [...(linksByMaterial.get(l.materialId) ?? []), l]);
  const seen = new Set<string>();
  const uniq = rows.filter(r => { if (seen.has(r.materialId)) return false; seen.add(r.materialId); return true; });

  const now = new Date();
  const buckets = { noLink: [] as string[], noApproved: [] as string[], noLeadTime: [] as string[], ok: [] as string[] };

  for (const r of uniq) {
    const m = materialDocs.find(d => d._id === r.materialId);
    if (!m || m.supplyMode === "ON_SITE" || m.ropDays <= 0) continue;
    const ls = linksByMaterial.get(r.materialId) ?? [];
    const summary = buildProcurementSummary(ls, supplierDocs, now);
    const twinLt = resolveLeadTimeDays(ls, supplierDocs, m.category, now);
    const line = `${m.code.padEnd(12)} ${m.name.slice(0, 16).padEnd(18)} cat=${m.category.padEnd(4)} rop=${String(m.ropDays).padStart(2)}d ` +
      `links=${ls.length}(approved=${ls.filter(l => l.qualificationStatus === "APPROVED").length}) ` +
      `normalDays=${summary?.normalDays ?? "-"}  twin실효LT=${twinLt}d  DOH=${(r.doh ?? -1).toFixed(1)}일`;
    if (!ls.length) buckets.noLink.push(line);
    else if (!summary) buckets.noApproved.push(line);
    else if (!summary.normalDays || summary.normalDays <= 0) buckets.noLeadTime.push(line);
    else buckets.ok.push(`${line}  ${m.ropDays < summary.normalDays ? "⚠ ROP<LT" : ""}${m.ropDays < twinLt ? " ⚠ ROP<twinLT" : ""}`);
  }

  console.log(`=== 공급사 링크 자체가 없음 — ${buckets.noLink.length}종 ===`);
  buckets.noLink.forEach(l => console.log("  " + l));
  console.log(`\n=== 링크는 있으나 APPROVED 공급사 없음 — ${buckets.noApproved.length}종 ===`);
  buckets.noApproved.forEach(l => console.log("  " + l));
  console.log(`\n=== APPROVED는 있으나 유효 리드타임 없음 — ${buckets.noLeadTime.length}종 ===`);
  buckets.noLeadTime.forEach(l => console.log("  " + l));
  console.log(`\n=== 정상 — ${buckets.ok.length}종 (⚠는 발주점이 리드타임보다 짧음) ===`);
  buckets.ok.forEach(l => console.log("  " + l));

  await (await getMongoClient()).close();
}

main().catch(e => { console.error(e); process.exit(1); });
