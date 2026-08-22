import assert from "node:assert/strict";
import { computeAggregateReleasePlan } from "../src/lib/lot-route";

// 회귀 배경: MODELED_FOUP 코호트 14,040개가 전부 DONE으로 소진된 뒤 재투입 로직이 없어
// Twin이 5일간 "RUNNING"으로 보이면서 실제로는 burn/PO가 완전히 멈췄던 버그.
// advanceAggregateWip는 기존 IN_PROGRESS 로트만 진행시키므로, 완료된 만큼 새 로트를
// step 0으로 계속 투입하는 별도 로직이 필요하다 — 그 투입량 계산의 순수 함수 회귀 가드.

// 기본: 하루 156개 배출 목표 × tick당 0.75 sim-day = tick당 117개, room이 충분하면 그대로 방출.
{
  const { releaseCount, nextCarry } = computeAggregateReleasePlan({
    dailyRate: 156, simDays: 0.75, carry: 0, currentOccupied: 0, targetOccupied: 14_040,
  });
  assert.equal(releaseCount, 117, "tick당 방출량은 dailyRate*simDays의 정수부여야 한다");
  assert.ok(nextCarry >= 0 && nextCarry < 1, `carry는 0~1 미만 소수부만 남아야 한다 (got ${nextCarry})`);
}

// 소수부 누적: 매 tick 미달분이 carry에 쌓이다가 1을 넘으면 방출에 반영돼야 한다 (드리프트 방지)
{
  let carry = 0;
  let totalReleased = 0;
  for (let i = 0; i < 10; i++) {
    const plan = computeAggregateReleasePlan({
      dailyRate: 1, simDays: 0.3, carry, currentOccupied: 0, targetOccupied: 1_000_000,
    });
    carry = plan.nextCarry;
    totalReleased += plan.releaseCount;
  }
  // 10 tick * 0.3 = 3.0 → 정확히 3개가 방출되어야 함(반올림 손실 없이 누적 보존)
  assert.equal(totalReleased, 3, `carry 누적 없이는 방출량이 드리프트한다 (got ${totalReleased})`);
}

// 목표치(room) 도달 시 초과 방출 금지 — 이미 가득 찬 상태에서 완료분 없이는 방출하지 않는다
{
  const { releaseCount } = computeAggregateReleasePlan({
    dailyRate: 156, simDays: 0.75, carry: 0, currentOccupied: 14_040, targetOccupied: 14_040,
  });
  assert.equal(releaseCount, 0, "occupied가 이미 target과 같으면 방출량은 0이어야 한다");
}

// room이 요청량보다 적으면 room만큼만 방출하고, 초과분 소수부는 버려서(carry 폭증 방지) 나중에 급증 안 함
{
  const { releaseCount, nextCarry } = computeAggregateReleasePlan({
    dailyRate: 156, simDays: 0.75, carry: 0, currentOccupied: 14_040 - 5, targetOccupied: 14_040,
  });
  assert.equal(releaseCount, 5, "room이 5면 최대 5개만 방출해야 한다");
  assert.ok(nextCarry < 1, `room 초과분이 carry에 그대로 누적되면 안 된다 (got ${nextCarry})`);
}

console.log("✅ twin WIP 재투입 계산 순수 함수 테스트 통과");
