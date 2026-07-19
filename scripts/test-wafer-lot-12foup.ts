import "dotenv/config";
import { randomUUID } from "crypto";
import assert from "node:assert/strict";
import { collections } from "../src/lib/db";
import { FOUP_CODES, listActiveLotStates, getOrCreateActiveLot, getLotRouteState, advanceLotStep } from "../src/lib/lot-route";

const ACTOR = "test-script:wafer-lot-12foup";

async function main() {
  const { workOrders, agentRuns } = await collections();

  // 1) 12개 FOUP 전부 활성 로트를 보장한다.
  const initialStates = await listActiveLotStates("M20", "HBM", ACTOR);
  assert.equal(initialStates.length, 12, "FOUP 12개 상태가 반환되어야 합니다");
  const returnedCodes = initialStates.map((s) => s.lot.foupCode).sort();
  assert.deepEqual(returnedCodes, [...FOUP_CODES].sort(), "FOUP-01~12 코드가 모두 존재해야 합니다");
  for (const state of initialStates) {
    assert.equal(state.totalSteps, 134, `${state.lot.foupCode} totalSteps는 HBM4 12-Hi 기준 134여야 합니다`);
  }
  console.log(`✅ 1) FOUP×12 활성 로트 확인 완료 (${returnedCodes.join(", ")})`);

  // 2) FOUP-05를 패키징 첫 스텝(절대 stepIndex 122)까지 전진시켜 M20 파일럿 워크오더 자동 생성을 확인한다.
  const targetFoup = "FOUP-05";
  const lot = await getOrCreateActiveLot("M20", "HBM", targetFoup, ACTOR);
  let state = await getLotRouteState(lot._id);
  const otherFoup = "FOUP-06";
  const otherLotBefore = await getOrCreateActiveLot("M20", "HBM", otherFoup, ACTOR);
  const otherStateBefore = await getLotRouteState(otherLotBefore._id);

  let iterations = 0;
  while (!state.isDone && state.currentStepIndex <= 122) {
    state = await advanceLotStep(lot._id, ACTOR, `${lot._id}:${randomUUID()}`);
    iterations++;
    if (iterations > 200) throw new Error("무한루프 방지: 반복 횟수 초과");
  }
  const lastEvent = state.history.at(-1);
  assert(lastEvent, "완료 이벤트가 있어야 합니다");
  assert.equal(lastEvent.nodeId, "packaging", "마지막 완료 스텝은 packaging 노드여야 합니다");
  assert.equal(lastEvent.visitIndex, 0, "패키징 첫 방문(visitIndex 0)이어야 합니다");
  assert.equal(lastEvent.stepIndex, 122, "패키징 첫 스텝의 절대 stepIndex는 122여야 합니다");
  console.log(`✅ 2) ${targetFoup} 패키징 첫 스텝(stepIndex=122) 도달 (${iterations}회 advance)`);

  // 패키징 진입 트리거가 만든 M20_PILOT 워크오더가 존재하고, orchestrateM20Agents가 실행되었는지 확인.
  const expectedRequestId = `WLOT-PACKAGING:${lot._id}:122`;
  const triggeredWorkOrder = await workOrders.findOne({ requestId: expectedRequestId });
  assert(triggeredWorkOrder, "패키징 진입으로 생성된 M20_PILOT 워크오더가 없습니다");
  assert.equal(triggeredWorkOrder.scope, "M20_PILOT");
  assert.equal(triggeredWorkOrder.fabId, "M20");
  const run = await agentRuns.findOne({ workOrderId: triggeredWorkOrder._id });
  assert(run, "orchestrateM20Agents가 실행되어 agentRuns가 기록되어야 합니다");
  console.log(`✅ 3) 패키징 진입 → M20_PILOT 워크오더(${triggeredWorkOrder._id}) 자동 생성 + 에이전트 실행 확인`);

  // 4) 다른 FOUP(FOUP-06)은 영향받지 않아야 한다 (완전히 독립적인 로트 원장).
  const otherStateAfter = await getLotRouteState(otherLotBefore._id);
  assert.equal(otherStateAfter.currentStepIndex, otherStateBefore.currentStepIndex, `${otherFoup}은 ${targetFoup} advance와 무관해야 합니다`);
  assert.equal(otherLotBefore._id, (await getOrCreateActiveLot("M20", "HBM", otherFoup, ACTOR))._id, `${otherFoup} 로트가 그대로 유지되어야 합니다`);
  console.log(`✅ 4) ${otherFoup}는 ${targetFoup}의 진행과 독립적으로 유지됨`);

  // 5) FOUP-05를 routeMaster 끝까지 완주시킨 뒤, 재조회 시 새 로트(25장 재적재)로 리셋되는지 확인한다.
  while (!state.isDone) {
    state = await advanceLotStep(lot._id, ACTOR, `${lot._id}:${randomUUID()}`);
    iterations++;
    if (iterations > 400) throw new Error("무한루프 방지: 반복 횟수 초과(완주 단계)");
  }
  assert.equal(state.isDone, true);
  assert.equal(state.currentStepIndex, 134);
  const restartedLot = await getOrCreateActiveLot("M20", "HBM", targetFoup, ACTOR);
  assert.notEqual(restartedLot._id, lot._id, "완주 후 재조회하면 새로운 로트(FOUP 리필)가 생성되어야 합니다");
  assert.equal(restartedLot.status, "IN_PROGRESS");
  const restartedState = await getLotRouteState(restartedLot._id);
  assert.equal(restartedState.currentStepIndex, 0, "새 로트는 스텝 0부터 다시 시작해야 합니다");
  console.log(`✅ 5) ${targetFoup} 완주 후 새 로트(${restartedLot._id})로 자동 리셋 확인 (25장 재적재 루프)`);

  console.log("🎉 12-FOUP 실시간 추적 + 패키징 진입 트리거 시나리오 전체 통과");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
