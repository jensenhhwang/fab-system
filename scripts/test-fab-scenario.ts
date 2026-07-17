import { campusScenarioMetrics, FAB_SCENARIO, fabScenarioMetrics } from "../src/lib/fab-scenario";

const [m20, m21, m22] = FAB_SCENARIO.map(fabScenarioMetrics);
console.assert(Math.round(m20.effectiveWspm) === 38_250, "M20 유효 WSPM");
console.assert(Math.round(m21.effectiveWspm) === 66_240, "M21 유효 WSPM");
console.assert(Math.round(m22.effectiveWspm) === 79_200, "M22 유효 WSPM");
console.assert(Math.abs(m20.waferEquivalentSharePct - 8.5) < 0.01, "M20 설계비중");
const campus = campusScenarioMetrics();
console.assert(campus.nominalWspm === 230_000, "캠퍼스 명목 WSPM");
console.assert(Math.round(campus.effectiveWspm) === 183_690, "캠퍼스 유효 WSPM");
console.log("✅ fab scenario rules passed");
