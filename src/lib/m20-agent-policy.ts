export const M20_AGENT_POLICY_VERSION = "M20_AGENT_POLICY_V1" as const;

export const M20_PROCUREMENT_POLICY_V1 = {
  materialId: "PKG-001",
  supplierId: "sup-m20-emc-model",
  supplierName: "M20 EMC 기준 공급사 (모델)",
  moq: 1_000,
  orderMultiple: 500,
  leadTimeDays: 21,
  unitPrice: 18_200,
  currency: "KRW" as const,
  source: "HARD_CODED_MODEL" as const,
  effectiveFrom: "2026-07-17",
} as const;

export type ProcurementCalculationInput = {
  onHand: number;
  activeReservations: number;
  confirmedInbound: number;
  safetyStock: number;
  dailyUsage: number;
  leadTimeDays: number;
  moq: number;
  orderMultiple: number;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export function calculateM20Procurement(input: ProcurementCalculationInput) {
  const projectedAvailable = round2(input.onHand - input.activeReservations + input.confirmedInbound);
  const policyTarget = round2(input.safetyStock + input.dailyUsage * input.leadTimeDays);
  const shortage = round2(Math.max(0, policyTarget - projectedAvailable));
  const minimumOrder = shortage > 0 ? Math.max(input.moq, shortage) : 0;
  const quantity = minimumOrder > 0
    ? Math.ceil(minimumOrder / input.orderMultiple) * input.orderMultiple
    : 0;
  return { projectedAvailable, policyTarget, shortage, quantity };
}
