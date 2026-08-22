import assert from "node:assert/strict";
import { planLotAdvance } from "../src/lib/lot-route";

// 집계 로트는 개별 정체성이 없다. 진행 결과는 (currentStepIndex, nextStepOperatingMs, waferQty)
// 세 값에만 의존하므로, 같은 조합은 한 번만 계산하고 updateMany로 묶어 쓸 수 있다.
// 실측 2026-08-22: M20 진행중 7,761 로트가 18조합에 몰려 있었다 — 쓰기 431배 감소.
//
// 이 함수는 "한 조합이 이번 tick에 어디까지 가는가"를 계산한다. DB를 만지지 않는다.

const DWELL = 1000;          // 스텝당 체류 운영ms
const TOTAL = 5;             // route 총 스텝

// 아직 도래 시각이 안 됐으면 움직이지 않는다
{
  const r = planLotAdvance({ currentStepIndex: 0, dueOperatingMs: 500, operatingEpochMs: 400, stepDwellMs: DWELL, totalSteps: TOTAL, maxSteps: 10 });
  assert.equal(r.movedSteps, 0);
  assert.equal(r.nextStepIndex, 0);
  assert.equal(r.nextDueOperatingMs, 500, "도래 시각을 바꾸지 않는다");
  assert.equal(r.done, false);
}

// 한 스텝 도래 → 한 칸 이동
{
  const r = planLotAdvance({ currentStepIndex: 0, dueOperatingMs: 100, operatingEpochMs: 100, stepDwellMs: DWELL, totalSteps: TOTAL, maxSteps: 10 });
  assert.equal(r.movedSteps, 1);
  assert.equal(r.nextStepIndex, 1);
  assert.equal(r.nextDueOperatingMs, 1100, "다음 도래는 체류시간만큼 뒤");
  assert.deepEqual(r.advancedFromSteps, [0], "0번 스텝을 완료하고 나갔다");
}

// 시간이 많이 흘렀으면 여러 칸을 간다
{
  const r = planLotAdvance({ currentStepIndex: 0, dueOperatingMs: 0, operatingEpochMs: 2500, stepDwellMs: DWELL, totalSteps: TOTAL, maxSteps: 10 });
  assert.equal(r.movedSteps, 3, "0→3 세 칸");
  assert.deepEqual(r.advancedFromSteps, [0, 1, 2]);
}

// maxSteps 상한을 넘지 않는다 — tick당 진행량을 묶어두는 안전장치
{
  const r = planLotAdvance({ currentStepIndex: 0, dueOperatingMs: 0, operatingEpochMs: 99_000, stepDwellMs: DWELL, totalSteps: TOTAL, maxSteps: 2 });
  assert.equal(r.movedSteps, 2);
}

// 마지막 스텝을 지나면 완료
{
  const r = planLotAdvance({ currentStepIndex: 4, dueOperatingMs: 0, operatingEpochMs: 5000, stepDwellMs: DWELL, totalSteps: TOTAL, maxSteps: 10 });
  assert.equal(r.done, true);
  assert.equal(r.nextStepIndex, TOTAL);
  assert.deepEqual(r.advancedFromSteps, [4]);
}

// 자재 차단이면 그 자리에서 멈추고 다음 도래를 미룬다
{
  const r = planLotAdvance({
    currentStepIndex: 1, dueOperatingMs: 0, operatingEpochMs: 5000, stepDwellMs: DWELL, totalSteps: TOTAL, maxSteps: 10,
    isBlockedAtStep: (step) => step === 1,
  });
  assert.equal(r.movedSteps, 0);
  assert.equal(r.materialHeld, true);
  assert.equal(r.nextDueOperatingMs, 5000 + DWELL, "차단되면 다음 tick에 다시 본다");
  assert.deepEqual(r.advancedFromSteps, []);
}

// 가다가 차단되면 간 만큼만 반영한다
{
  const r = planLotAdvance({
    currentStepIndex: 0, dueOperatingMs: 0, operatingEpochMs: 5000, stepDwellMs: DWELL, totalSteps: TOTAL, maxSteps: 10,
    isBlockedAtStep: (step) => step === 2,
  });
  assert.deepEqual(r.advancedFromSteps, [0, 1], "2번에서 막히기 전까지만");
  assert.equal(r.nextStepIndex, 2);
  assert.equal(r.materialHeld, true);
}

// 완제품 창고 초과면 마지막 스텝을 못 넘는다
{
  const r = planLotAdvance({
    currentStepIndex: 4, dueOperatingMs: 0, operatingEpochMs: 5000, stepDwellMs: DWELL, totalSteps: TOTAL, maxSteps: 10,
    finishedGoodsCapacityOver: true,
  });
  assert.equal(r.done, false);
  assert.equal(r.finishedGoodsHeld, true);
  assert.deepEqual(r.advancedFromSteps, []);
}

console.log("✅ lot advance group passed");
