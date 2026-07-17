import { canTransitionInboundPlan, inboundPlanProgress, parseInboundPlanInput } from "../src/lib/inbound-plans";

const valid = parseInboundPlanInput({ materialId: "MAT-1", supplierId: "SUP-1", plannedDate: "2026-07-20", plannedQuantity: 100, note: "test" });
if (!("value" in valid) || !valid.value) throw new Error("유효한 입고계획 입력 실패");
console.assert(valid.value.plannedQuantity === 100, "유효한 입고계획 입력");
console.assert("error" in parseInboundPlanInput({ materialId: "MAT-1", supplierId: "SUP-1", plannedDate: "bad", plannedQuantity: 100 }), "잘못된 날짜 차단");
console.assert("error" in parseInboundPlanInput({ materialId: "MAT-1", supplierId: "SUP-1", plannedDate: "2026-02-31", plannedQuantity: 100 }), "존재하지 않는 날짜 차단");
console.assert("error" in parseInboundPlanInput({ materialId: "MAT-1", supplierId: "SUP-1", plannedDate: "2026-07-20", plannedQuantity: 0 }), "0 이하 수량 차단");
console.assert(canTransitionInboundPlan("DRAFT", "CONFIRMED"), "초안 확정 허용");
console.assert(canTransitionInboundPlan("CONFIRMED", "COMPLETED"), "확정 완료 허용");
console.assert(!canTransitionInboundPlan("COMPLETED", "CONFIRMED"), "완료 계획 재확정 차단");
console.assert(!canTransitionInboundPlan("CANCELLED", "CONFIRMED"), "취소 계획 재확정 차단");
const partial = inboundPlanProgress({ plannedQuantity: 100, receivedQuantity: 40 });
console.assert(partial.remainingQuantity === 60 && partial.completionPct === 40, "부분입고 잔여 계산");
const over = inboundPlanProgress({ plannedQuantity: 100, receivedQuantity: 120 });
console.assert(over.remainingQuantity === 0 && over.completionPct === 100, "진행률 상한 적용");
console.log("✅ inbound plan rules passed");
