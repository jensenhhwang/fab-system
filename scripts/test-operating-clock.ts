import assert from "node:assert/strict";
import {
  OPERATING_SPEED_MULTIPLIER,
  OPERATING_CATCH_UP_LIMIT_MS,
  advanceOperatingClock,
  operatingDaysToMs,
  operatingMsToDays,
  OPERATING_DAYS_PER_MONTH,
  operatingDayOf,
  operatingMonthOf,
  operatingDaysCompletedBetween,
} from "../src/lib/twin/operating-clock";

// RULES.md § Twin 운영시간
//   "기본이자 필수 운영시간 배속은 24×다. 실제 1시간이 지나면 운영시간 1일이 흐른다."
//   "기능별 독자 시계, 제품별 임의 배속, tick 횟수 기반 시간 진행을 만들지 않는다."
//
// 실측(2026-08-12) 위반 상태: M20 1,832× / M21 1,629× / M22 1,431×. 배속이 규칙의 76배인 데다
// 팹마다 달랐다. 원인은 시간이 `simDaysPerTick = cycleTimeDays / totalSteps`로 계산됐기 때문이다 —
// tick 한 번에 "route 한 스텝만큼"의 시간이 흐른다고 본 tick 횟수 기반 진행이라, 팹의 사이클타임과
// 스텝 수가 다르면 시간이 흐르는 속도 자체가 달라졌고 tick 간격이 흔들리면 배속도 같이 흔들렸다.
//
// 이 시계는 tick 횟수를 아예 보지 않는다. 실제 경과 벽시계 시간에만 24를 곱한다.

assert.equal(OPERATING_SPEED_MULTIPLIER, 24, "RULES.md가 정한 배속");

// 실제 1시간 = 운영시간 1일
{
  const wallStart = new Date("2026-08-12T00:00:00Z");
  const result = advanceOperatingClock({
    operatingEpochMs: 0,
    lastWallClock: wallStart,
    now: new Date("2026-08-12T01:00:00Z"), // 실제 1시간
  });
  assert.equal(operatingMsToDays(result.elapsedOperatingMs), 1, "실제 1시간 → 운영 1일");
  assert.equal(result.operatingEpochMs, operatingDaysToMs(1));
}

// tick이 몇 번 돌았는지는 시간에 영향을 주지 않는다 — 규칙이 금지한 "tick 횟수 기반 진행"을
// 구조적으로 못 하게 한다. 같은 30초를 한 번에 재든 세 번에 나눠 재든 결과가 같아야 한다.
{
  const t0 = new Date("2026-08-12T00:00:00Z");
  const once = advanceOperatingClock({ operatingEpochMs: 0, lastWallClock: t0, now: new Date("2026-08-12T00:00:30Z") });

  let split = { operatingEpochMs: 0, lastWallClock: t0 };
  for (const at of ["00:00:10", "00:00:20", "00:00:30"]) {
    const step = advanceOperatingClock({ ...split, now: new Date(`2026-08-12T${at}Z`) });
    split = { operatingEpochMs: step.operatingEpochMs, lastWallClock: step.nextWallClock };
  }
  assert.equal(split.operatingEpochMs, once.operatingEpochMs, "tick을 몇 번에 나눠도 흐른 운영시간은 같다");
}

// 팹·제품에 따라 달라지지 않는다 — 시계는 하나뿐이므로 입력에 fabId/product 자체가 없다.
// (타입상 받을 수 없다는 것이 곧 "제품별 임의 배속" 금지의 구현이다.)

// ── 정지 후 재개: catch-up 상한 ──────────────────────────────────────────────
// 서버가 오래 멈췄다 재개하면 그 공백 × 24가 한꺼번에 흐른다. 실제로 오늘 겪은 catch-up burst와
// 같은 종류의 사고다(라인 정지 → 재개 시 밀린 로트가 한 tick에 완료돼 EMA가 상한까지 폭주).
// 한 번에 반영할 운영시간에 상한을 둬서, 멈춰 있던 시간이 통째로 쏟아지지 않게 한다.
{
  const wallStart = new Date("2026-08-12T00:00:00Z");
  const result = advanceOperatingClock({
    operatingEpochMs: 0,
    lastWallClock: wallStart,
    now: new Date("2026-08-13T00:00:00Z"), // 실제 24시간 정지 → 그대로면 운영 24일
  });
  assert.equal(result.elapsedOperatingMs, OPERATING_CATCH_UP_LIMIT_MS, "상한까지만 흐른다");
  assert.ok(result.clampedCatchUp, "잘렸다는 사실을 호출자가 알 수 있어야 한다");
  // 벽시계 기준점은 now로 옮긴다 — 안 옮기면 다음 tick에도 같은 공백을 또 반영해 영원히 밀린다.
  assert.equal(result.nextWallClock.getTime(), new Date("2026-08-13T00:00:00Z").getTime());
}

// 상한 이내면 자르지 않는다.
{
  const result = advanceOperatingClock({
    operatingEpochMs: 0,
    lastWallClock: new Date("2026-08-12T00:00:00Z"),
    now: new Date("2026-08-12T00:30:00Z"),
  });
  assert.equal(result.clampedCatchUp, false);
  assert.equal(operatingMsToDays(result.elapsedOperatingMs), 0.5, "실제 30분 → 운영 반나절");
}

// ── 시계가 뒤로 가면 시간을 되돌리지 않는다 ───────────────────────────────────
// NTP 보정이나 서버 간 시계 차이로 now가 과거일 수 있다. 운영시각이 뒤로 가면 이미 지난 ETA가
// 다시 미래가 되어 입고가 취소되는 것처럼 보인다.
{
  const result = advanceOperatingClock({
    operatingEpochMs: operatingDaysToMs(10),
    lastWallClock: new Date("2026-08-12T01:00:00Z"),
    now: new Date("2026-08-12T00:59:00Z"), // 1분 과거
  });
  assert.equal(result.elapsedOperatingMs, 0, "뒤로 가면 흐르지 않는다");
  assert.equal(result.operatingEpochMs, operatingDaysToMs(10), "운영시각은 유지");
  assert.equal(result.nextWallClock.getTime(), new Date("2026-08-12T01:00:00Z").getTime(), "기준점도 되돌리지 않는다");
}

// 최초 부팅(기준 벽시계 없음)은 시간을 흘리지 않고 기준점만 잡는다.
{
  const now = new Date("2026-08-12T00:00:00Z");
  const result = advanceOperatingClock({ operatingEpochMs: 0, lastWallClock: null, now });
  assert.equal(result.elapsedOperatingMs, 0, "첫 tick은 기준점만 잡는다");
  assert.equal(result.nextWallClock.getTime(), now.getTime());
}

// ── 단위 변환 ────────────────────────────────────────────────────────────────
assert.equal(operatingDaysToMs(1), 86_400_000, "운영 1일 = 86,400,000 운영ms (실제와 같은 눈금)");
assert.equal(operatingMsToDays(86_400_000), 1);
assert.equal(operatingMsToDays(operatingDaysToMs(3.5)), 3.5, "왕복 변환이 보존돼야 한다");

// 운영 1일에 대응하는 실제 시간은 1시간이다 — 규칙의 핵심 문장을 그대로 검증한다.
assert.equal(operatingDaysToMs(1) / OPERATING_SPEED_MULTIPLIER, 3_600_000, "운영 1일 = 실제 1시간");

// ── 운영일·운영월 버킷 ────────────────────────────────────────────────────────
// 계약 월량(contractedMonthlyQty)은 운영 1개월치이고 자동출하도 운영일 기준으로 나간다.
// 집계 창이 벽시계 달력 월이면 분자에 운영 24개월치가 쌓인다(실측 2026-08-18: DRAM 6.5배).
assert.equal(OPERATING_DAYS_PER_MONTH, 30, "운영월은 30일 — auto-shipment.DAYS_PER_MONTH와 같다");

assert.equal(operatingDayOf(0), 0, "운영 0일차");
assert.equal(operatingDayOf(operatingDaysToMs(1) - 1), 0, "1일 직전은 아직 0일차");
assert.equal(operatingDayOf(operatingDaysToMs(1)), 1, "정확히 1일이면 1일차");
assert.equal(operatingDayOf(operatingDaysToMs(9.04)), 9, "9.04일차 → 9");
assert.equal(operatingDayOf(-1), 0, "음수는 0으로 막는다");

assert.equal(operatingMonthOf(0), 0, "운영 0개월차");
assert.equal(operatingMonthOf(operatingDaysToMs(29.99)), 0, "30일 직전은 0개월차");
assert.equal(operatingMonthOf(operatingDaysToMs(30)), 1, "30일이면 1개월차");
assert.equal(operatingMonthOf(operatingDaysToMs(719)), 23, "719일 → 23개월차");
assert.equal(operatingMonthOf(-1), 0, "음수는 0으로 막는다");

// 경계 통과 판정 — 이 tick에 "완료된" 운영일 목록. 스냅샷은 완료된 날만 확정한다.
assert.deepEqual(
  operatingDaysCompletedBetween(operatingDaysToMs(9.1), operatingDaysToMs(9.6)), [],
  "같은 운영일 안에서는 완료된 날이 없다",
);
assert.deepEqual(
  operatingDaysCompletedBetween(operatingDaysToMs(9.6), operatingDaysToMs(10.2)), [9],
  "9일차를 넘기면 9일차가 완료된다",
);
assert.deepEqual(
  operatingDaysCompletedBetween(operatingDaysToMs(9.6), operatingDaysToMs(12.1)), [9, 10, 11],
  "catch-up으로 여러 날을 건너뛰면 그 사이 날이 모두 완료된다",
);
assert.deepEqual(
  operatingDaysCompletedBetween(operatingDaysToMs(10.2), operatingDaysToMs(9.6)), [],
  "시각이 뒤로 가면 아무것도 완료되지 않는다",
);

console.log("✅ Twin 운영시계 테스트 통과");
