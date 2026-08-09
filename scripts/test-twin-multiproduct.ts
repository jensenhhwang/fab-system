import "dotenv/config";
import { executeTwinTick } from "../src/lib/twin/engine";
import { collections } from "../src/lib/db";

function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); }

async function main() {
  const { finishedGoods, wipStepBuckets } = await collections();
  // step-bucket이라 near-final 스텝의 WIP가 매 tick 완제품이 되므로 소수 tick으로 충분히 검증된다.
  // now를 sim-시간으로 크게 벌려 final test 대기열이 풀리게 한다. 라이브 스케줄러와 락 경합 시 재시도.
  const TARGET_TICKS = 2;
  let done = 0;
  let attempts = 0;
  while (done < TARGET_TICKS && attempts < 200) {
    attempts++;
    const r = await executeTwinTick(new Date(Date.now() + done * 6_700_000));
    if (r.skipped === "LOCKED") { await new Promise((res) => setTimeout(res, 300)); continue; }
    if (r.skipped) throw new Error(`tick skipped=${r.skipped} (Twin RUNNING·역할게이트 확인)`);
    done++;
  }
  if (done < TARGET_TICKS) throw new Error(`틱을 충분히 못 돌림: ${done}/${TARGET_TICKS} (attempts=${attempts})`);
  const dram = await finishedGoods.findOne({ _id: "M21__DRAM__WH-FG01" });
  const nand = await finishedGoods.findOne({ _id: "M22__NAND__WH-FG01" });
  const hbm = await finishedGoods.findOne({ _id: "M20__HBM__WH-FG01" });
  assert(!!dram, "DRAM 완제품 문서 생성");
  assert(!!nand, "NAND 완제품 문서 생성");
  assert(!!hbm, "HBM 완제품 문서 유지");
  assert(dram!.unit === "CHIP", `DRAM unit=${dram!.unit}`);
  assert(nand!.unit === "DIE", `NAND unit=${nand!.unit}`);
  const dramTotal = (dram!.quantity ?? 0) + (dram!.pendingTestQuantity ?? 0);
  const nandTotal = (nand!.quantity ?? 0) + (nand!.pendingTestQuantity ?? 0);
  assert(dramTotal > 0, `DRAM 산출>0 (=${dramTotal})`);
  assert(nandTotal > 0, `NAND 산출>0 (=${nandTotal})`);
  // step-bucket WIP가 문서 목표를 유지하는지(재투입으로 고갈되지 않음)
  const dramBucket = await wipStepBuckets.findOne({ _id: "M21__DRAM" });
  const nandBucket = await wipStepBuckets.findOne({ _id: "M22__NAND" });
  assert((dramBucket?.counts.reduce((s, c) => s + c, 0) ?? 0) > 0, "DRAM step-bucket WIP 유지");
  assert((nandBucket?.counts.reduce((s, c) => s + c, 0) ?? 0) > 0, "NAND step-bucket WIP 유지");
  console.log(`✅ 다제품 틱 OK — HBM=${Math.round(hbm!.quantity)}, DRAM=${Math.round(dram!.quantity)}(+대기 ${Math.round(dram!.pendingTestQuantity ?? 0)}), NAND=${Math.round(nand!.quantity)}(+대기 ${Math.round(nand!.pendingTestQuantity ?? 0)})`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
