import assert from "node:assert/strict";
import { FAB_SCENARIO, fabScenarioMetrics, M20_PRODUCTION_SCENARIOS, targetWipCount } from "../src/lib/fab-scenario";

const m20 = FAB_SCENARIO.find((f) => f.id === "M20")!;
const cycleDays = M20_PRODUCTION_SCENARIOS.NORMAL.cycleTimeDays;
// utilizedWspm = 130,000 * 0.90 = 117,000 → dailyWaferStarts = 3,900 → dailyFoupStarts = 3,900/25 = 156/일 → ×105일
const target = targetWipCount(fabScenarioMetrics(m20).utilizedWspm, cycleDays);
assert.equal(target, 16_380, `M20 목표 WIP 계산이 어긋났습니다: ${target}`);
console.log(`✅ M20 목표 WIP = ${target} FOUP-eq (nominalWspm=${m20.nominalWspm}, utilization=${m20.utilization}, cycleDays=${cycleDays})`);

const half = targetWipCount(fabScenarioMetrics({ ...m20, utilization: 0.45 }).utilizedWspm, cycleDays);
assert.equal(half, Math.round(target / 2), "가동률이 절반이면 목표 WIP도 절반이어야 합니다");
console.log(`✅ 가동률 0.45일 때 목표 WIP = ${half} FOUP-eq (선형 비례 확인)`);
