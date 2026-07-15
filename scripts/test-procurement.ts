import { buildProcurementSummary, currentLeadTime } from "../src/lib/procurement";
import type { MaterialSupplierDoc, SupplierDoc } from "../src/lib/db";

const suppliers: SupplierDoc[] = [{ _id: "a", name: "A" }, { _id: "b", name: "B" }];
const links: MaterialSupplierDoc[] = [
  { _id:"1",materialId:"m",supplierId:"a",leadTimeDays:7,isPrimary:true,qualificationStatus:"APPROVED",sourcingRole:"PRIMARY",standardLeadTimeDays:7,maxLeadTimeDays:12,currentExpectedLeadTimeDays:9,currentExpectedValidUntil:new Date("2099-01-01"),emergencyOrderAllowed:false },
  { _id:"2",materialId:"m",supplierId:"b",leadTimeDays:5,isPrimary:false,qualificationStatus:"APPROVED",sourcingRole:"SECONDARY",standardLeadTimeDays:5,emergencyOrderAllowed:true },
];
const summary=buildProcurementSummary(links,suppliers,new Date("2026-01-01"));
console.assert(summary?.supplierName==="A","주공급사 우선");
console.assert(summary?.normalDays===9&&summary.normalSource==="CURRENT","유효 현재 예상값 우선");
console.assert(summary?.safeDays===12,"최대 리드타임을 안전 기준으로 사용");
console.assert(summary?.alternatives[0].supplierName==="B"&&summary.alternatives[0].emergencyOrderAllowed,"승인 보조 공급사 대안");
console.assert(buildProcurementSummary(links.map(link=>({...link,qualificationStatus:"SUSPENDED"})),suppliers)===null,"미승인 공급사 제외");
console.assert(currentLeadTime({...links[0],currentExpectedValidUntil:new Date("2020-01-01")},new Date("2026-01-01")).days===7,"만료 현재값 제외");
console.log("✅ 조달 기준 선택 규칙 검증 통과");
