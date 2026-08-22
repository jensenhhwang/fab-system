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
  // equivalentPerWafer는 "월 총소요량 ÷ 월 웨이퍼 투입수"다(§material-consumption.ts) —
  // 웨이퍼 1장이 route를 **완주하는 동안 쓰는 총량**이지 방문 1회당 양이 아니다.
  // 반도체 route는 같은 공정을 여러 번 지나므로(M22는 256 스텝 중 P02가 162회) 방문마다
  // 전액을 부과하면 그 횟수만큼 과소모된다. 방문 수로 나눠, route를 완주한 웨이퍼의 총
  // 소모가 원단위와 정확히 일치하게 한다.
  const visitCount = new Map<string, number>();
  for (const visit of visits) visitCount.set(visit.processCode, (visitCount.get(visit.processCode) ?? 0) + 1);

  const result: StepConsumption = new Map();
  for (const visit of visits) {
    const consumers = byProcess.get(visit.processCode);
    if (!consumers || consumers.length === 0) continue;
    const times = visitCount.get(visit.processCode) ?? 1;
    result.set(
      visit.stepIndex,
      consumers.map((c) => ({ materialId: c.materialId, equivalentPerWafer: c.equivalentPerWafer / times })),
    );
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
