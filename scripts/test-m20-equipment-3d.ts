import assert from "node:assert/strict";
import { M20_DEFINED_EQUIPMENT_COUNTS } from "../src/lib/m20-equipment-capacity-plan";
import {
  buildDenseProcessEquipmentLayout,
  buildOhtAccessPoints,
  buildCampusEquipmentLayout,
  M20_3D_EQUIPMENT_TOTAL,
  M20_3D_MAX_PROCESS_EQUIPMENT,
  M20_DENSE_PROCESS_ZONES,
  ohtRouteDistance,
} from "../src/lib/equipment-3d-layout";

let renderedTotal = 0;
let bayTotal = 0;
const allDetailPositions = new Set<string>();
const expectedBayCounts: Record<string, number[]> = {
  P01: [9], P02: [20, 19, 19], P03: [17, 17, 16, 16], P04: [19, 19, 18],
  P05: [13], P06: [13], P07: [16, 16, 15, 15], P08: [12],
  P09: [4], P10: [18, 18],
};
for (const [processCode, count] of Object.entries(M20_DEFINED_EQUIPMENT_COUNTS)) {
  const zone = M20_DENSE_PROCESS_ZONES[processCode];
  const detailLayout = buildDenseProcessEquipmentLayout(count, zone.x, zone.z, 0.82, 0.72, 20, 2.3);
  const campusLayout = buildCampusEquipmentLayout(count);
  const detailPositions = new Set(detailLayout.equipment.map((tool) => `${tool.x}:${tool.z}`));
  const campusPositions = new Set(campusLayout.map((tool) => `${tool.x}:${tool.z}`));

  assert.equal(detailLayout.equipment.length, count, `${processCode} 상세 3D 전수배치`);
  assert.deepEqual(detailLayout.bays.map((bay) => bay.count), expectedBayCounts[processCode], `${processCode} 균등 bay 분할`);
  assert(detailLayout.bays.every((bay) => bay.count <= 20), `${processCode} bay당 최대 20대`);
  assert.equal(campusLayout.length, count, `${processCode} Campus 3D 전수배치`);
  assert.equal(detailPositions.size, count, `${processCode} 상세 3D 위치 중복 없음`);
  assert.equal(campusPositions.size, count, `${processCode} Campus 3D 위치 중복 없음`);
  assert.deepEqual(detailLayout.equipment.map((tool) => tool.index), Array.from({ length: count }, (_, index) => index));
  for (const tool of detailLayout.equipment) {
    const positionKey = `${tool.x}:${tool.z}`;
    assert(!allDetailPositions.has(positionKey), `${processCode}가 다른 공정 장비 위치와 충돌하지 않음`);
    allDetailPositions.add(positionKey);
  }
  renderedTotal += detailLayout.equipment.length;
  bayTotal += detailLayout.bays.length;
}

assert.equal(renderedTotal, M20_3D_EQUIPMENT_TOTAL);
assert.equal(bayTotal, 21);
assert.equal(Math.max(...Object.values(M20_DEFINED_EQUIPMENT_COUNTS)), M20_3D_MAX_PROCESS_EQUIPMENT);
assert.deepEqual(Object.values(M20_DEFINED_EQUIPMENT_COUNTS), [9, 58, 66, 56, 13, 13, 62, 12, 4, 36]);
assert(M20_DENSE_PROCESS_ZONES.P09.x < 0, "P09 테스트는 Back-end line 왼쪽");
assert(M20_DENSE_PROCESS_ZONES.P10.x > 0, "P10 패키징은 Back-end line 오른쪽");
assert.equal(M20_DENSE_PROCESS_ZONES.P09.z, M20_DENSE_PROCESS_ZONES.P10.z, "P09→P10은 같은 row의 짧은 handoff");

const hbmRoute = [
  "P01", "P03", "P04", "P05", "P02", "P07", "P03", "P04", "P06", "P07",
  "P03", "P04", "P06", "P07", "P03", "P04", "P06", "P07", "P03", "P04",
  "P06", "P02", "P08", "P09", "P10",
];
const legacyAccess = buildOhtAccessPoints({
  P01: { x: 0, z: -15.95 }, P02: { x: 0, z: -12.75 }, P03: { x: 0, z: -9.55 },
  P04: { x: 0, z: -6.35 }, P05: { x: 0, z: -3.15 }, P06: { x: 0, z: 3.15 },
  P07: { x: 0, z: 6.35 }, P08: { x: 0, z: 9.55 }, P09: { x: 0, z: 12.75 }, P10: { x: 0, z: 15.95 },
}, 0);
const denseDistance = ohtRouteDistance(hbmRoute, buildOhtAccessPoints(M20_DENSE_PROCESS_ZONES));
const legacyDistance = ohtRouteDistance(hbmRoute, legacyAccess);
assert(denseDistance < legacyDistance * 0.9, `OHT route distance 개선: ${legacyDistance} → ${denseDistance}`);

console.log(`✅ M20 3D verified: 329/329 · 21 bays · OHT/AGV route ${legacyDistance.toFixed(1)} → ${denseDistance.toFixed(1)}`);
