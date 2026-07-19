import assert from "node:assert/strict";
import {
  M20_MATERIAL_CONSUMPTION,
  m20MaterialDemandForScenario,
  m20ProcessUsageForScenario,
} from "../src/lib/material-consumption";

const normal = m20ProcessUsageForScenario("NORMAL");
assert.equal(normal.length, 49, "M20 공정별 원단위 행 수");
assert.equal(new Set(normal.map((row) => row.materialId)).size, 44, "M20 활성 자재 수");
assert.equal(M20_MATERIAL_CONSUMPTION.length, normal.length);

const n2Normal = m20MaterialDemandForScenario("NORMAL").find((row) => row.materialId === "GAS-001");
assert.equal(n2Normal?.monthlyQty, 124_852, "NORMAL N2 월소요량");

const arfNormal = normal.find((row) => row.materialId === "CHM-007");
const arfUplift = m20ProcessUsageForScenario("UPLIFT").find((row) => row.materialId === "CHM-007");
assert.equal(arfNormal?.monthlyQty, 1_547, "NORMAL ArF PR 월소요량");
assert.ok(Math.abs((arfUplift?.monthlyQty ?? 0) - 1_632.944444) < 0.000001, "UPLIFT ArF PR 월소요량");
assert.ok(Math.abs((arfNormal?.equivalentPerWafer ?? 0) * 117_000 - 1_547) < 0.000001, "ArF wafer당 원단위 연결");

const probeExpansion = m20MaterialDemandForScenario("EXPANSION").find((row) => row.materialId === "CSM-009");
assert.ok(Math.abs((probeExpansion?.monthlyQty ?? 0) - 19.066667) < 0.000001, "EXPANSION Probe Card 연속 환산량");

const baseDie = normal.find((row) => row.materialId === "PKG-LBD-001");
assert.equal(baseDie?.processCode, "P10");
assert.equal(baseDie?.operationCode, "BASE_DIE_ATTACH");
assert.equal(baseDie?.routeVersion, "ROUTE_MASTER_M20_HBM_V3");
assert.ok(Math.abs((baseDie?.monthlyQty ?? 0) - 6_401_515.151515) < 0.000001, "Base Die 99% 입고합격률 반영 연속 발주량");
assert.equal(new Set(normal.map((row) => row._id)).size, normal.length, "route/version/operation별 소비행 ID 유일");

console.log("✅ M20 production → per-wafer material consumption rules passed");
