import "dotenv/config";
import { advanceAggregateWip, getAggregateWipSummary } from "../src/lib/lot-route";

function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); }

async function main() {
  // M21/DRAM 요약이 occupiedTarget>0을 반환해야 한다(예전엔 무조건 0 early-return).
  const dramSummary = await getAggregateWipSummary("M21", "DRAM");
  assert(dramSummary.occupiedTarget === 17_173, `DRAM occupiedTarget=${dramSummary.occupiedTarget}`);

  // advance는 config를 찾고 route를 조회한다(로트 0이면 advanced=0이지만 크래시 없이).
  const res = await advanceAggregateWip("M21", "DRAM");
  assert(res.advanced >= 0 && typeof res.completedWaferQty === "number", "DRAM advance 정상 반환");

  // 무효 조합은 여전히 empty.
  const bad = await advanceAggregateWip("M20", "DRAM");
  assert(bad.advanced === 0 && bad.completed === 0, "M20:DRAM 무효 → empty");

  console.log("✅ aggregate WIP 일반화 OK");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
