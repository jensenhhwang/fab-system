import assert from "node:assert/strict";
import { FAB_SCENARIO, targetWipCount } from "../src/lib/fab-scenario";
import { M20_CYCLE_DAYS } from "../src/lib/lot-route";

const m20 = FAB_SCENARIO.find((f) => f.id === "M20")!;
// utilizedWspm = 130,000 * 0.90 = 117,000 → dailyWaferStarts = 3,900 → dailyFoupStarts = 3,900/25 = 156/일 → ×105일
const target = targetWipCount(m20, M20_CYCLE_DAYS);
assert.equal(target, 16_380, `M20 목표 WIP 계산이 어긋났습니다: ${target}`);
console.log(`✅ M20 목표 WIP = ${target}개 (nominalWspm=${m20.nominalWspm}, utilization=${m20.utilization}, cycleDays=${M20_CYCLE_DAYS})`);

const half = targetWipCount({ ...m20, utilization: 0.45 }, M20_CYCLE_DAYS);
assert.equal(half, Math.round(target / 2), "가동률이 절반이면 목표 WIP도 절반이어야 합니다");
console.log(`✅ 가동률 0.45일 때 목표 WIP = ${half}개 (선형 비례 확인)`);
