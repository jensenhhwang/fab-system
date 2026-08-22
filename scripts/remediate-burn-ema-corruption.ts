import "dotenv/config";
import { collections } from "../src/lib/db";
import { m20MaterialDemandForScenario } from "../src/lib/material-consumption";
import { M20_MATERIAL_CONSUMPTION } from "../src/lib/material-consumption";

// avgDailyBurn EMA 부트스트랩 무클리핑 버그(수정 완료 — src/lib/twin/inbound.ts) 때문에
// 이미 오염된 상태를 정리한다:
// 1) avgDailyBurn을 설계기준 수요(NORMAL 시나리오)로 리셋 — 이제부턴 새 EMA 상한이 지켜준다.
// 2) 오염된 avgDailyBurn 기준으로 이미 나가서 INBOUND_HOLD에 걸려있는 과대발주는 REJECTED로
//    되돌린다 — 그대로 두면 나중에 사람이 "입고 반영"을 누르는 순간 창고가 다시 넘친다.
const apply = process.argv.includes("--apply");

async function main() {
  const { inventory, twinPurchaseOrders } = await collections();
  const demand = new Map(m20MaterialDemandForScenario("NORMAL").map((d) => [d.materialId, d.monthlyQty / 30]));
  const materialIds = [...new Set(M20_MATERIAL_CONSUMPTION.map((r) => r.materialId))];

  console.log(`[remediate-burn-ema] mode=${apply ? "APPLY" : "DRY-RUN"}`);
  console.log("--- avgDailyBurn 리셋 ---");
  for (const materialId of materialIds) {
    const rows = await inventory.find({ materialId }).toArray();
    const designDaily = demand.get(materialId) ?? 0;
    for (const row of rows) {
      if (Math.abs((row.avgDailyBurn ?? 0) - designDaily) < 0.01) continue;
      console.log(`  ${materialId}\tcurrent=${(row.avgDailyBurn ?? 0).toFixed(1)}\ttarget=${designDaily.toFixed(1)}`);
      if (apply) await inventory.updateOne({ _id: row._id }, { $set: { avgDailyBurn: designDaily } });
    }
  }

  console.log("--- 오염된 과대발주 REJECTED 처리 (INBOUND_HOLD만, RECEIVED는 건드리지 않음) ---");
  const held = await twinPurchaseOrders.find({ status: "INBOUND_HOLD", materialId: { $in: materialIds } }).toArray();
  for (const po of held) {
    console.log(`  ${po.materialId}\tqty=${Math.round(po.qty)}\tPO=${po._id}`);
    if (apply) {
      await twinPurchaseOrders.updateOne(
        { _id: po._id, status: "INBOUND_HOLD" },
        { $set: { status: "REJECTED", holdReason: "avgDailyBurn EMA 오염으로 인한 과대발주 — 정정 후 재발주 대기" } },
      );
    }
  }
  console.log(apply ? "[remediate-burn-ema] 적용 완료" : "[remediate-burn-ema] --apply로 재실행하면 반영됩니다");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
