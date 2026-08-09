import "dotenv/config";
import { getProductionConfig, FAB_PRODUCTION_REGISTRY } from "../src/lib/fab-production-config";
import { M20_TARGET_OCCUPIED_FOUP, M20_DAILY_LOT_RELEASE } from "../src/lib/foup-wip-model";

function assert(cond: boolean, msg: string) { if (!cond) throw new Error(`FAIL: ${msg}`); }

// M20 config는 기존 M20 상수를 바이트 단위로 보존해야 한다(회귀 방지).
const hbm = getProductionConfig("M20", "HBM")!;
assert(hbm.dailyLotRelease === M20_DAILY_LOT_RELEASE, "HBM dailyLotRelease 보존");
assert(hbm.targetOccupiedFoup === M20_TARGET_OCCUPIED_FOUP, "HBM targetOccupied 보존");
assert(hbm.outputModel.unit === "STACK", "HBM unit=STACK");

// DRAM/NAND는 foup-wip-master.md 연동 값.
const dram = getProductionConfig("M21", "DRAM")!;
assert(dram.outputModel.unit === "CHIP", "DRAM unit=CHIP");
assert(dram.targetOccupiedFoup === 17_173, "DRAM occupied=17173 (문서 §M21)");
assert(dram.cycleTimeDays === 80, "DRAM cycle=80");
assert(dram.dailyLotRelease > 0, "DRAM dailyLotRelease>0");
const nand = getProductionConfig("M22", "NAND")!;
assert(nand.outputModel.capacityGbPerUnit === 1_024, "NAND 1Tb/die");
assert(nand.targetOccupiedFoup === 18_720, "NAND occupied=18720 (문서 §M22)");
assert(nand.cycleTimeDays === 150, "NAND cycle=150 (문서 §M22)");

// 잘못된 fab/product 조합은 null.
assert(getProductionConfig("M20", "DRAM") === null, "M20:DRAM 조합 무효");
assert(Object.keys(FAB_PRODUCTION_REGISTRY).length === 3, "3제품 등록");

console.log("✅ fab-production-config OK");
