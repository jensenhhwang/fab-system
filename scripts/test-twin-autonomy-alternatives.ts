import assert from "node:assert/strict";
import type { MaterialSupplierDoc, SupplierDoc } from "../src/lib/db";
import { buildProcurementSummary } from "../src/lib/procurement";
import { autonomyCeiling } from "../src/lib/procurement-agent";

// 엔진이 자율등급을 매길 때 쓰는 procurementAlternatives를 loadLiveScenarioMaterials(server-only)
// 대신 공급사 링크에서 직접 유도한다. 두 경로가 같은 판정을 내는지 못박는다 —
// material-scenario-server.ts:87도 같은 buildProcurementSummary를 쓰므로 출처가 동일하고,
// autonomyCeiling은 alternatives의 length만 본다(0건이면 단일소싱).
const suppliers: SupplierDoc[] = [
  { _id: "SUP-A", name: "A상사" } as SupplierDoc,
  { _id: "SUP-B", name: "B상사" } as SupplierDoc,
];
const link = (over: Partial<MaterialSupplierDoc>): MaterialSupplierDoc => ({
  _id: "L", materialId: "M", supplierId: "SUP-A", leadTimeDays: 7, isPrimary: true,
  qualificationStatus: "APPROVED", standardLeadTimeDays: 7, ...over,
} as MaterialSupplierDoc);

/** 엔진이 쓸 유도 경로 — 이미 로드한 링크에서 alternatives를 뽑는다. */
function alternativesOf(links: MaterialSupplierDoc[]) {
  return buildProcurementSummary(links, suppliers)?.alternatives ?? [];
}

// 승인 공급사가 1곳뿐 → alternatives 0건 → 단일소싱 상한
{
  const alts = alternativesOf([link({})]);
  assert.equal(alts.length, 0, "주공급사만 있으면 대체 공급사는 0건");
  const c = autonomyCeiling({ category: "CSM", supplyMode: "DRUM_CHEMICAL", procurementAlternatives: alts });
  assert.equal(c.level, 2, "단일소싱은 자율등급 2로 제한");
  assert.equal(c.code, "SINGLE_SOURCE_CAP");
}

// 승인 공급사 2곳 → alternatives 1건 → 상한 없음
{
  const alts = alternativesOf([
    link({ _id: "L1", supplierId: "SUP-A", isPrimary: true, sourcingRole: "PRIMARY" }),
    link({ _id: "L2", supplierId: "SUP-B", isPrimary: false, sourcingRole: "SECONDARY", standardLeadTimeDays: 9 }),
  ]);
  assert.equal(alts.length, 1, "주공급사를 뺀 나머지가 대체 공급사");
  assert.equal(alts[0].supplierName, "B상사");
  assert.equal(autonomyCeiling({ category: "CSM", supplyMode: "DRUM_CHEMICAL", procurementAlternatives: alts }).level, 4);
}

// 승인되지 않은 공급사는 대체 공급사로 세지 않는다
{
  const alts = alternativesOf([
    link({ _id: "L1", supplierId: "SUP-A" }),
    link({ _id: "L2", supplierId: "SUP-B", isPrimary: false, qualificationStatus: "SUSPENDED" }),
  ]);
  assert.equal(alts.length, 0, "미승인 공급사는 제외 — 여전히 단일소싱");
  assert.equal(autonomyCeiling({ category: "CSM", supplyMode: "DRUM_CHEMICAL", procurementAlternatives: alts }).level, 2);
}

// 링크가 아예 없으면 요약이 null이라 빈 배열로 떨어진다 — 엔진의 기존 폴백과 같다
{
  assert.deepEqual(alternativesOf([]), [], "링크 없으면 빈 배열");
  assert.equal(autonomyCeiling({ category: "CSM", supplyMode: "DRUM_CHEMICAL", procurementAlternatives: [] }).level, 2);
}

// 위험물 실린더는 대체 공급사와 무관하게 상한 2 — 유도 경로가 이 판정을 바꾸지 않는다
{
  const alts = alternativesOf([
    link({ _id: "L1", supplierId: "SUP-A" }),
    link({ _id: "L2", supplierId: "SUP-B", isPrimary: false, sourcingRole: "SECONDARY" }),
  ]);
  assert.equal(alts.length, 1);
  assert.equal(autonomyCeiling({ category: "GAS", supplyMode: "SPECIALTY_CYLINDER", procurementAlternatives: alts }).level, 2);
}

console.log("✅ twin autonomy alternatives passed");
