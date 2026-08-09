import "dotenv/config";
import { finishedGoodsPerWafer, finishedGoodsUnit, capacityGbPerUnit } from "../src/lib/finished-goods";

function approx(a: number, b: number, tol = 1) { return Math.abs(a - b) <= tol; }
function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); }

// HBM: 650/12*0.90 ≈ 48.75 stack/wafer (기존 동작 보존)
assert(approx(finishedGoodsPerWafer("HBM"), 48.75, 0.5), `HBM/wafer=${finishedGoodsPerWafer("HBM")}`);
// 무인자 호출도 HBM으로 동작(engine.ts 하위호환)
assert(approx(finishedGoodsPerWafer(), 48.75, 0.5), `HBM(무인자)/wafer=${finishedGoodsPerWafer()}`);
assert(finishedGoodsUnit("HBM") === "STACK", "HBM unit");
// DRAM: 759*0.98 ≈ 743.8 chip/wafer (문서 §M21)
assert(approx(finishedGoodsPerWafer("DRAM"), 743.8, 1), `DRAM/wafer=${finishedGoodsPerWafer("DRAM")}`);
assert(finishedGoodsUnit("DRAM") === "CHIP", "DRAM unit");
assert(capacityGbPerUnit("DRAM") === 16, "DRAM 16Gb");
// NAND: 1249*0.96 ≈ 1199 die/wafer (문서 §M22)
assert(approx(finishedGoodsPerWafer("NAND"), 1199, 2), `NAND/wafer=${finishedGoodsPerWafer("NAND")}`);
assert(finishedGoodsUnit("NAND") === "DIE", "NAND unit");
assert(capacityGbPerUnit("NAND") === 1_024, "NAND 1Tb");

console.log("✅ finished-goods conversion OK");
