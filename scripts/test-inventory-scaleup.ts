import { calculateScaleUpRequirement, scaleUpReviewStatus } from "../src/lib/inventory-scaleup";

const shortage = calculateScaleUpRequirement({ currentQuantity: 80, activeInboundQuantity: 0, safetyStock: 100, dailyUsage: 20 });
console.assert(shortage.minimumTargetQuantity === 120, "안전재고 + 1일 수요 목표");
console.assert(shortage.replenishmentQuantity === 40 && shortage.projectedQuantity === 120, "부족량 보충");
const planned = calculateScaleUpRequirement({ currentQuantity: 80, activeInboundQuantity: 30, safetyStock: 100, dailyUsage: 20 });
console.assert(planned.replenishmentQuantity === 10, "기존 예정입고 중복 차감");
const policy = calculateScaleUpRequirement({ currentQuantity: 80, activeInboundQuantity: 0, safetyStock: 100, dailyUsage: 20, policyTargetQuantity: 200 });
console.assert(policy.targetQuantity === 200 && policy.replenishmentQuantity === 120, "승인 정책 목표 우선");
console.assert(scaleUpReviewStatus({ supplierApproved: true, policyStatus: "READY" }) === "READY", "즉시 계획");
console.assert(scaleUpReviewStatus({ supplierApproved: true, policyStatus: "BLOCKED_CAPACITY" }) === "CAPACITY_REVIEW", "Capacity 검토");
console.assert(scaleUpReviewStatus({ supplierApproved: false }) === "MASTER_DATA_REVIEW", "마스터 검토");
console.log("✅ inventory scale-up rules passed");
