import "dotenv/config";
import { collections } from "../src/lib/db";
import { M20_PRODUCTION_SCENARIOS } from "../src/lib/fab-scenario";
import { finishedGoodsPerWafer, FINISHED_GOODS_WAREHOUSE_ID } from "../src/lib/finished-goods";

// 완제품 창고 1개(WH-FG01)를 기존 8개 창고와 같은 warehouses 컬렉션에 등록한다.
// totalCapacity는 실측이 아니라 MODELED_BASELINE 계획값이다(다른 7개 창고와 동일한
// docs/warehouse-capacity-master.md 관례) — NORMAL 시나리오 웨이퍼 투입량 × 가동률 ×
// 웨이퍼당 완제품 환산으로 일일 산출량을 구하고, 5일치 버퍼로 잡았다.
async function main() {
  const { warehouses } = await collections();
  const existing = await warehouses.findOne({ _id: FINISHED_GOODS_WAREHOUSE_ID });
  if (existing) {
    console.log("[seed-fg-warehouse] 이미 존재합니다:", JSON.stringify(existing));
    return;
  }

  const { waferStartsPerMonth, utilization } = M20_PRODUCTION_SCENARIOS.NORMAL;
  const dailyOutput = (waferStartsPerMonth * utilization / 30) * finishedGoodsPerWafer();
  const totalCapacity = Math.round(dailyOutput * 5);

  await warehouses.insertOne({
    _id: FINISHED_GOODS_WAREHOUSE_ID, code: FINISHED_GOODS_WAREHOUSE_ID, name: "완제품 창고 (M20 HBM)",
    type: "FINISHED_GOODS", totalCapacity, unit: "STACK", capacityMode: "SPACE",
    temperature: "실온",
    notes: `MODELED_BASELINE 계획값 · 실측 시설 마스터로 교체 필요. NORMAL 시나리오 일산출(${Math.round(dailyOutput).toLocaleString()} STACK/일) × 5일 버퍼로 산정.`,
  });
  console.log(`[seed-fg-warehouse] 생성 완료: totalCapacity=${totalCapacity.toLocaleString()} STACK`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
