import assert from "node:assert/strict";
import type { MaterialSupplierDoc, SupplierDoc } from "../src/lib/db";
import { getBaseLeadTime, LEAD_TIME_RANGE, resolveLeadTimeDays } from "../src/lib/twin/lead-time";

assert.equal(getBaseLeadTime("CHM"), 11, "CHM 평균 리드타임 (7+14)/2 반올림");
assert.equal(getBaseLeadTime("GAS"), 5, "GAS 평균 리드타임 (3+7)/2");
assert.equal(getBaseLeadTime("PKG"), 8, "PKG 평균 리드타임 (5+10)/2 반올림");
assert.equal(getBaseLeadTime("UNKNOWN"), 7, "미정의 카테고리 기본 7일");
assert.deepEqual(LEAD_TIME_RANGE.CHM, [7, 14], "CHM 범위");

// ── resolveLeadTimeDays — 트윈 발주 리드타임의 진실원 ────────────────────────
// 트윈이 카테고리 평균으로 발주하고 ERP 재고정책은 승인 주공급사 마스터를 쓰면, 같은 자재의
// 리드타임이 두 값으로 갈라진다. 실관측(2026-08-18): GAS-006 NF₃가 마스터 21일인데 트윈은
// 5일로 발주했고, CHM-003 황산은 마스터 7일인데 트윈이 11일로 발주해 ropDays 7일을 넘겼다.
// 진실원은 조달 마스터 하나이고, 마스터가 없을 때만 카테고리 평균으로 폴백한다.
const now = new Date("2026-08-18T00:00:00Z");
const suppliers: SupplierDoc[] = [
  { _id: "SUP-A", name: "A상사" } as SupplierDoc,
  { _id: "SUP-B", name: "B상사" } as SupplierDoc,
];
const link = (over: Partial<MaterialSupplierDoc>): MaterialSupplierDoc => ({
  _id: "L", materialId: "M", supplierId: "SUP-A", leadTimeDays: 0, isPrimary: true,
  qualificationStatus: "APPROVED", ...over,
} as MaterialSupplierDoc);

assert.equal(
  resolveLeadTimeDays([link({ standardLeadTimeDays: 21 })], suppliers, "GAS", now), 21,
  "승인 주공급사 표준 리드타임이 카테고리 평균(GAS 5일)을 이긴다",
);

assert.equal(
  resolveLeadTimeDays([link({ standardLeadTimeDays: 7 })], suppliers, "CHM", now), 7,
  "마스터가 카테고리 평균(CHM 11일)보다 짧아도 마스터를 따른다",
);

assert.equal(
  resolveLeadTimeDays([], suppliers, "CHM", now), 11,
  "공급사 링크가 없으면 카테고리 평균으로 폴백",
);

assert.equal(
  resolveLeadTimeDays([link({ qualificationStatus: "SUSPENDED", standardLeadTimeDays: 21 })], suppliers, "GAS", now), 5,
  "승인되지 않은 공급사의 리드타임은 쓰지 않는다 — 카테고리 폴백",
);

assert.equal(
  resolveLeadTimeDays([link({ standardLeadTimeDays: null, leadTimeDays: 0 })], suppliers, "PKG", now), 8,
  "승인 공급사는 있으나 유효 리드타임이 0이면 카테고리 폴백",
);

assert.equal(
  resolveLeadTimeDays(
    [link({ _id: "L2", supplierId: "SUP-B", isPrimary: false, sourcingRole: "SECONDARY", standardLeadTimeDays: 3 }),
     link({ _id: "L1", supplierId: "SUP-A", isPrimary: true, sourcingRole: "PRIMARY", standardLeadTimeDays: 30 })],
    suppliers, "GAS", now,
  ), 30,
  "보조 공급사가 더 빨라도 주공급사 기준을 쓴다 — ERP 재고정책과 같은 선정 규칙",
);

assert.equal(
  resolveLeadTimeDays(
    [link({ standardLeadTimeDays: 30, currentExpectedLeadTimeDays: 45, currentExpectedValidUntil: new Date("2026-09-01T00:00:00Z") })],
    suppliers, "GAS", now,
  ), 45,
  "유효기간 안의 현재 예상 리드타임이 표준값보다 우선한다",
);

assert.equal(
  resolveLeadTimeDays(
    [link({ standardLeadTimeDays: 30, currentExpectedLeadTimeDays: 45, currentExpectedValidUntil: new Date("2026-08-01T00:00:00Z") })],
    suppliers, "GAS", now,
  ), 30,
  "유효기간이 지난 현재 예상 리드타임은 무시하고 표준값으로 돌아간다",
);

console.log("✅ twin lead-time passed");
