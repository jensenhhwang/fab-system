import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { collections, getMongoClient, type MaterialSupplierDoc } from "../src/lib/db";
import { getInventoryRows } from "../src/lib/queries";
import { buildProcurementSummary } from "../src/lib/procurement";
import { correctedReorderPointDays, REORDER_POINT_SAFETY_FACTOR } from "../src/lib/inventory-policy";
import { getBaseLeadTime } from "../src/lib/twin/lead-time";

// 조달 리드타임 마스터 정합화 — DOH가 0에 붙는 구조적 원인 두 가지를 마스터 차원에서 없앤다.
//
//   ① 승인 주공급사가 없는 27종 — buildProcurementSummary가 null을 내서 재고정책이
//      BLOCKED_MASTER_DATA로 막히고 목표재고가 서지 않는다. UTL-002는 발주가 한 건도 안 나갔다.
//   ② ropDays < leadTimeDays — ROP에 닿아 발주해도 화물은 그 뒤에 오므로 그 차이만큼 재고 0을
//      지나간다. 코드 안전계수로 덮으면 마스터가 틀린 채 숨겨지므로 마스터를 정정한다.
//
// 리드타임 등록값은 카테고리 기준값(getBaseLeadTime)을 쓴다 — 트윈이 폴백으로 쓰던 값과 같아서
// 이 마이그레이션이 트윈의 발주 동작을 바꾸지 않고, 대신 그 값을 마스터에 명시해 ERP 재고정책이
// 같은 값을 보게 한다(§twin/lead-time.ts resolveLeadTimeDays).
const apply = process.argv.includes("--apply");

// 카테고리별 기본 공급사가 아니라 자재 성격에 맞는 실존 공급사를 붙인다 — 조달 마스터는
// "누구에게 사는가"가 리드타임만큼 중요하고, 화면(자재 상세)에 그대로 노출된다.
const SUPPLIER_BY_MATERIAL: Record<string, string> = {
  // 벌크가스
  "GAS-009": "sup-lindekorea",
  // 식각가스
  "GAS-011": "sup-skg", "GAS-012": "sup-skg", "GAS-013": "sup-skg", "GAS-025": "sup-skg", "GAS-026": "sup-skg",
  // 도판트(전자특수가스)
  "GAS-021": "sup-airproducts", "GAS-022": "sup-airproducts", "GAS-023": "sup-airproducts", "GAS-024": "sup-airproducts",
  // 전구체
  "GAS-015": "sup-mks", "GAS-017": "sup-mks", "GAS-020": "sup-mks",
  // 습식 케미컬
  "CHM-004": "sup-soulbrain", "CHM-005": "sup-soulbrain", "CHM-006": "sup-soulbrain", "CHM-013": "sup-soulbrain",
  // 포토 케미컬
  "CHM-010": "sup-duksan", "CHM-012": "sup-duksan",
  // 소모재
  "CSM-005": "sup-cmi", "CSM-011": "sup-cmi", "CSM-013": "sup-disco", "CSM-014": "sup-sumitomo", "CSM-015": "sup-tokai",
  // 패키지
  "PKG-002": "sup-sumitomo", "PKG-LBD-001": "sup-m20-emc-model",
  // 유틸리티
  "UTL-002": "sup-soulbrain",
};

async function main() {
  const { materials, suppliers, materialSuppliers } = await collections();
  const [rows, materialDocs, supplierDocs, links] = await Promise.all([
    getInventoryRows(true), materials.find({}).toArray(), suppliers.find({}).toArray(), materialSuppliers.find({}).toArray(),
  ]);
  const supplierNames = new Map(supplierDocs.map(s => [s._id, s.name]));
  const linksByMaterial = new Map<string, MaterialSupplierDoc[]>();
  for (const l of links) linksByMaterial.set(l.materialId, [...(linksByMaterial.get(l.materialId) ?? []), l]);
  const seen = new Set<string>();
  const uniqueRows = rows.filter(r => { if (seen.has(r.materialId)) return false; seen.add(r.materialId); return true; });
  const now = new Date();

  console.log(`[procurement-master] mode=${apply ? "APPLY" : "DRY-RUN"}\n`);

  // ── ① 승인 주공급사 링크 보충 ────────────────────────────────────────────
  const newLinks: MaterialSupplierDoc[] = [];
  const unmapped: string[] = [];
  for (const row of uniqueRows) {
    const mat = materialDocs.find(m => m._id === row.materialId);
    if (!mat || mat.supplyMode === "ON_SITE" || mat.ropDays <= 0) continue;
    if (buildProcurementSummary(linksByMaterial.get(mat._id) ?? [], supplierDocs, now)) continue;
    const supplierId = SUPPLIER_BY_MATERIAL[mat._id];
    if (!supplierId || !supplierNames.has(supplierId)) { unmapped.push(`${mat.code} ${mat.name}`); continue; }
    const leadTimeDays = getBaseLeadTime(mat.category);
    newLinks.push({
      _id: `${mat._id}__${supplierId}`, materialId: mat._id, supplierId,
      leadTimeDays, standardLeadTimeDays: leadTimeDays,
      isPrimary: true, sourcingRole: "PRIMARY", qualificationStatus: "APPROVED",
      emergencyOrderAllowed: false, updatedAt: now,
    });
  }
  console.log(`── ① 승인 주공급사 링크 신규 등록 — ${newLinks.length}종 ──`);
  for (const l of newLinks) {
    const mat = materialDocs.find(m => m._id === l.materialId)!;
    console.log(`  ${mat.code.padEnd(12)} ${mat.name.slice(0, 16).padEnd(18)} → ${(supplierNames.get(l.supplierId) ?? l.supplierId).padEnd(24)} LT=${l.standardLeadTimeDays}d`);
  }
  if (unmapped.length) console.log(`  ⚠ 공급사 매핑 없음 ${unmapped.length}종: ${unmapped.join(", ")}`);

  // ── ② ropDays 교정 ───────────────────────────────────────────────────────
  // 새로 등록할 링크를 반영한 상태에서 리드타임을 다시 구한다.
  for (const l of newLinks) linksByMaterial.set(l.materialId, [...(linksByMaterial.get(l.materialId) ?? []), l]);
  const ropChanges: { id: string; code: string; name: string; from: number; to: number; lt: number; capDays: number | null }[] = [];
  for (const row of uniqueRows) {
    const mat = materialDocs.find(m => m._id === row.materialId);
    if (!mat || mat.supplyMode === "ON_SITE") continue;
    const summary = buildProcurementSummary(linksByMaterial.get(mat._id) ?? [], supplierDocs, now);
    const lt = summary?.normalDays ?? null;
    if (lt == null || lt <= 0) continue;
    const to = correctedReorderPointDays({
      currentRopDays: mat.ropDays, leadTimeDays: lt, dailyUsage: row.dailyUsage, capacityLimit: row.capacityLimit ?? null,
    });
    if (to === mat.ropDays) continue;
    ropChanges.push({
      id: mat._id, code: mat.code, name: mat.name, from: mat.ropDays, to, lt,
      capDays: row.capacityLimit != null && row.dailyUsage > 0 ? row.capacityLimit / row.dailyUsage : null,
    });
  }
  console.log(`\n── ② ropDays 교정 (ROP ≥ LT×${REORDER_POINT_SAFETY_FACTOR}, 탱크 만재 95% 클램프) — ${ropChanges.length}종 ──`);
  for (const c of ropChanges) {
    console.log(`  ${c.code.padEnd(12)} ${c.name.slice(0, 16).padEnd(18)} rop ${String(c.from).padStart(2)}d → ${String(c.to).padStart(2)}d  (LT=${c.lt}d${c.capDays != null ? `, 만재 ${c.capDays.toFixed(1)}일` : ""})`);
  }

  if (!apply) {
    console.log(`\n변경 없음(DRY-RUN). 실제 적용: npm run db:migrate-procurement-lead-time -- --apply`);
    await (await getMongoClient()).close();
    return;
  }
  // 마스터를 되돌릴 수 있게 적용 직전 상태를 남긴다 — ropDays는 발주량·목표재고·창고 정원
  // 산정이 모두 참조하는 값이라, 교정이 과했을 때 원상복구가 가능해야 한다.
  const backupPath = `.backup/ropDays-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await mkdir(dirname(backupPath), { recursive: true });
  await writeFile(backupPath, JSON.stringify({
    appliedAt: now.toISOString(),
    newSupplierLinkIds: newLinks.map(l => l._id),
    ropDays: ropChanges.map(c => ({ materialId: c.id, code: c.code, before: c.from, after: c.to })),
  }, null, 2));
  console.log(`\n롤백 스냅샷: ${backupPath}`);

  if (newLinks.length) await materialSuppliers.insertMany(newLinks);
  for (const c of ropChanges) await materials.updateOne({ _id: c.id }, { $set: { ropDays: c.to } });
  console.log(`✅ 적용 완료 — 공급사 링크 ${newLinks.length}건 등록, ropDays ${ropChanges.length}종 교정`);
  await (await getMongoClient()).close();
}

main().catch(e => { console.error(e); process.exit(1); });
