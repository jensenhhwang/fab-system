import "dotenv/config";
import assert from "node:assert/strict";
import { collections } from "../src/lib/db";
import { ensureAggregateWip } from "../src/lib/lot-route";

const ACTOR = "test-script:ensure-aggregate-wip";

async function main() {
  const { waferLots } = await collections();
  await waferLots.deleteMany({ fabId: "M20", product: "HBM", cohort: "AGGREGATE" });

  const result = await ensureAggregateWip("M20", "HBM", ACTOR);
  assert(result.targetWip > 0, "목표 WIP은 0보다 커야 합니다");
  assert(result.created > 0, "최초 호출은 부족분을 채워야 합니다");
  console.log(`✅ 1) 목표=${result.targetWip} 생성=${result.created}`);

  const lots = await waferLots.find({ fabId: "M20", product: "HBM", cohort: "AGGREGATE" }).toArray();
  assert.equal(lots.length, result.created);
  for (const lot of lots) {
    assert.equal(lot.status, "IN_PROGRESS");
    assert(typeof lot.currentStepIndex === "number" && lot.currentStepIndex >= 0, "currentStepIndex가 있어야 합니다");
    assert(lot.currentNodeId, "currentNodeId가 있어야 합니다");
    assert(lot.lastEventAt, "lastEventAt이 있어야 합니다");
  }
  console.log(`✅ 2) 생성된 ${lots.length}개 로트 모두 currentStepIndex/currentNodeId/lastEventAt 보유`);

  const distinctSteps = new Set(lots.map((l) => l.currentStepIndex)).size;
  assert(distinctSteps > 1, "웜스타트는 균등 랜덤 분포라 여러 스텝에 흩어져야 합니다");
  console.log(`✅ 3) ${distinctSteps}개의 서로 다른 스텝에 분포(웜스타트 확인)`);

  const { workOrders } = await collections();
  const aggregatePackagingWOs = await workOrders.countDocuments({ scope: "M20_PILOT", lotId: { $in: lots.map((l) => l._id) } });
  assert.equal(aggregatePackagingWOs, 0, "AGGREGATE 코호트는 패키징 진입해도 M20 파일럿 워크오더를 만들면 안 됩니다");
  console.log("✅ 4) AGGREGATE 코호트는 M20_PILOT 워크오더를 생성하지 않음 확인");

  // 실제 M20 목표(16,380개)는 배치 상한(1,000개)보다 훨씬 커서 한 번의 호출로는 절대 채워지지 않는다.
  // "목표 도달 후엔 추가 생성을 멈춘다"는 별도 로직을 여러 번 폴링해서 검증하는 대신,
  // 여기서는 목표치 부근까지 직접 시드해서 그 경계 조건만 싸게 확인한다(전체 수렴 과정은 Task 10 e2e에서 검증).
  await waferLots.insertMany(Array.from({ length: Math.max(0, result.targetWip - result.created) }, (_, i) => ({
    _id: `WLOT:M20:HBM:AGG:seed-topoff-${i}`, fabId: "M20" as const, product: "HBM" as const,
    routeMasterId: "M20:HBM", foupCode: `FOUP-WIP-SEED-${i}`, status: "IN_PROGRESS" as const, cohort: "AGGREGATE" as const,
    currentStepIndex: 0, currentNodeId: "seed", lastEventAt: new Date(), createdBy: ACTOR, createdAt: new Date(), updatedAt: new Date(),
  })));
  const second = await ensureAggregateWip("M20", "HBM", ACTOR);
  assert.equal(second.created, 0, "목표치에 도달한 뒤엔 재호출이 추가 생성을 하면 안 됩니다");
  console.log("✅ 5) 목표 도달 후 재호출 시 추가 생성 없음(직접 top-off로 경계 조건 재현)");

  await waferLots.deleteMany({ fabId: "M20", product: "HBM", cohort: "AGGREGATE" });
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
