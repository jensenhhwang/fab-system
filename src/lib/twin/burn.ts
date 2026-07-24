// stepIndex → 그 스텝(공정)에서 소모되는 자재 목록.
export type StepConsumption = Map<number, { materialId: string; equivalentPerWafer: number }[]>;

export function buildStepConsumption(
  visits: { stepIndex: number; processCode: string }[],
  rows: { materialId: string; processCode: string; equivalentPerWafer: number }[],
): StepConsumption {
  const byProcess = new Map<string, { materialId: string; equivalentPerWafer: number }[]>();
  for (const row of rows) {
    const list = byProcess.get(row.processCode) ?? [];
    list.push({ materialId: row.materialId, equivalentPerWafer: row.equivalentPerWafer });
    byProcess.set(row.processCode, list);
  }
  const result: StepConsumption = new Map();
  for (const visit of visits) {
    const consumers = byProcess.get(visit.processCode);
    if (consumers && consumers.length > 0) result.set(visit.stepIndex, consumers);
  }
  return result;
}

// advancedFromStepIndex: 이번 tick에 각 stepIndex를 "완료하고" 다음 스텝으로 넘어간 웨이퍼 수.
export function computeBurn(
  advancedFromStepIndex: Record<number, number>,
  stepConsumption: StepConsumption,
): Map<string, number> {
  const burn = new Map<string, number>();
  for (const [stepIndexStr, wafers] of Object.entries(advancedFromStepIndex)) {
    if (!wafers) continue;
    const consumers = stepConsumption.get(Number(stepIndexStr));
    if (!consumers) continue;
    for (const { materialId, equivalentPerWafer } of consumers) {
      burn.set(materialId, (burn.get(materialId) ?? 0) + wafers * equivalentPerWafer);
    }
  }
  return burn;
}
