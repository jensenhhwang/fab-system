import "dotenv/config";
import { collections } from "../src/lib/db";

async function main() {
  const { inboundPlans } = await collections();
  await Promise.all([
    inboundPlans.createIndex({ planNo: 1 }, { unique: true }),
    inboundPlans.createIndex({ status: 1, plannedDate: 1 }),
    inboundPlans.createIndex({ materialId: 1, supplierId: 1, createdAt: -1 }),
    inboundPlans.createIndex({ scaleUpRequestId: 1 }),
  ]);
  console.log("✅ Planning Bridge 인덱스 생성 완료");
  process.exit(0);
}

main().catch(error => { console.error(error); process.exit(1); });
