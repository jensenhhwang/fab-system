import "dotenv/config";
import { collections } from "../src/lib/db";
import { M20_PRODUCTION_SCENARIOS } from "../src/lib/fab-scenario";
import { finishedGoodsPerWafer } from "../src/lib/finished-goods";
import { TIER_SHARE } from "../src/lib/customer-contracts";

// H1: 이미 시드된 5개 가상 고객사(contractedMonthlyQty 필드 도입 전)에 월 계약물량을 채운다.
// 배분 비율은 customer-contracts.ts가 단일 출처다(시드·출하 스크립트와 공유).

async function main() {
  const { customers } = await collections();
  const { waferStartsPerMonth, utilization } = M20_PRODUCTION_SCENARIOS.NORMAL;
  const monthlyOutput = waferStartsPerMonth * utilization * finishedGoodsPerWafer();

  for (const [customerId, share] of Object.entries(TIER_SHARE)) {
    const contractedMonthlyQty = Math.round(monthlyOutput * share);
    const result = await customers.updateOne(
      { _id: customerId, contractedMonthlyQty: { $exists: false } },
      { $set: { contractedMonthlyQty } },
    );
    console.log(customerId, "contractedMonthlyQty=", contractedMonthlyQty, "modified=", result.modifiedCount);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
