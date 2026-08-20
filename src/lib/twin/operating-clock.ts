// 공통 Twin 운영시계 — RULES.md § Twin 운영시간의 구현.
//
//   "모든 생산·시뮬레이션 기능은 공통 Twin 운영시계를 사용한다."
//   "기본이자 필수 운영시간 배속은 24×다. 실제 1시간이 지나면 운영시간 1일이 흐른다."
//   "기능별 독자 시계, 제품별 임의 배속, tick 횟수 기반 시간 진행을 만들지 않는다."
//
// ── 왜 필요했나 ────────────────────────────────────────────────────────────────
// 이전에는 시간이 `simDaysPerTick = cycleTimeDays / totalSteps`로 계산됐다. "tick 한 번에 route
// 한 스텝만큼의 시간이 흐른다"는 tick 횟수 기반 진행이라, 두 가지가 동시에 깨졌다:
//   ① 팹마다 시간이 다르게 흘렀다 — 사이클타임과 스텝 수가 다르니 배속도 달라진다
//      (실측 2026-08-12: M20 1,832× / M21 1,629× / M22 1,431×).
//   ② tick 간격이 흔들리면 배속도 같이 흔들렸다 — 설정은 5초인데 실측 26.5초였고, 그 어긋남이
//      "발주 리드타임이 설정의 19%로 작동"·"승인 SLA 60분이 운영 103일" 같은 사고로 이어졌다.
//
// 이 시계는 tick 횟수를 보지 않는다. 실제 경과 벽시계 시간에만 24를 곱한다. 그래서 tick이
// 빨라지든 느려지든, 팹이 몇 개든 운영시간은 항상 같은 속도로 흐른다.
//
// ── 벽시계와 운영시간의 구분 ──────────────────────────────────────────────────
// 운영시간을 쓰는 것: WIP 진행, 자재 소모, 재보충·발주 ETA, 최종테스트, 자동출하, 계약기간 집계.
// 벽시계를 쓰는 것: createdAt, 승인 시각, 사용자 조치, 감사 로그, 인증·세션 만료, 외부 수신 시각.
// 후자는 "실제로 일어난 사실"이므로 절대 가속하지 않는다. 필드명으로 구분한다 —
// 운영시간은 `operating*`, 벽시계는 `recordedAt`/`createdAt` 계열.

export const OPERATING_SPEED_MULTIPLIER = 24;

/** 운영시간 1일의 ms. 실제 시간과 같은 눈금을 쓰되 흐르는 속도만 24배다. */
const MS_PER_OPERATING_DAY = 86_400_000;

// 서버가 오래 멈췄다 재개하면 그 공백 × 24가 한꺼번에 흐른다. 그대로 두면 밀린 WIP이 한 tick에
// 완료되면서 소모·EMA·발주가 동시에 폭주한다 — 오늘 겪은 catch-up burst와 같은 종류의 사고다.
// 한 번에 반영할 운영시간의 상한을 둔다(운영 1일 = 실제 1시간 정지까지는 그대로 따라잡는다).
export const OPERATING_CATCH_UP_LIMIT_MS = MS_PER_OPERATING_DAY;

export function operatingDaysToMs(days: number): number {
  return days * MS_PER_OPERATING_DAY;
}

export function operatingMsToDays(ms: number): number {
  return ms / MS_PER_OPERATING_DAY;
}

/** 운영시간 d일에 대응하는 실제 벽시계 ms. 화면에 "실제로 얼마나 기다려야 하나"를 쓸 때 사용한다. */
export function operatingDaysToWallMs(days: number): number {
  return operatingDaysToMs(days) / OPERATING_SPEED_MULTIPLIER;
}

export type OperatingClockAdvance = {
  /** 갱신된 운영 절대시각(ms) */
  operatingEpochMs: number;
  /** 이번에 흐른 운영시간(ms) */
  elapsedOperatingMs: number;
  /** 다음 계산의 기준이 될 벽시계 시각 */
  nextWallClock: Date;
  /** catch-up 상한에 걸려 잘렸는지 */
  clampedCatchUp: boolean;
};

// 입력에 fabId·product가 없다는 것이 곧 "제품별 임의 배속" 금지의 구현이다 — 팹을 알 수 없으니
// 팹마다 다른 속도를 만들 수가 없다.
export function advanceOperatingClock(input: {
  operatingEpochMs: number;
  /** 직전에 이 시계를 갱신한 벽시계 시각. 최초 부팅이면 null */
  lastWallClock: Date | null;
  now: Date;
}): OperatingClockAdvance {
  const { operatingEpochMs, lastWallClock, now } = input;

  // 최초 부팅 — 흘릴 과거가 없으므로 기준점만 잡는다.
  if (!lastWallClock) {
    return { operatingEpochMs, elapsedOperatingMs: 0, nextWallClock: now, clampedCatchUp: false };
  }

  const wallElapsedMs = now.getTime() - lastWallClock.getTime();
  // NTP 보정·서버 간 시계 차이로 now가 과거일 수 있다. 운영시각이 뒤로 가면 이미 지난 ETA가
  // 다시 미래가 되어 입고가 취소된 것처럼 보이므로, 되돌리지 않고 그대로 둔다.
  if (wallElapsedMs <= 0) {
    return { operatingEpochMs, elapsedOperatingMs: 0, nextWallClock: lastWallClock, clampedCatchUp: false };
  }

  const rawOperatingMs = wallElapsedMs * OPERATING_SPEED_MULTIPLIER;
  const clampedCatchUp = rawOperatingMs > OPERATING_CATCH_UP_LIMIT_MS;
  const elapsedOperatingMs = clampedCatchUp ? OPERATING_CATCH_UP_LIMIT_MS : rawOperatingMs;

  return {
    operatingEpochMs: operatingEpochMs + elapsedOperatingMs,
    elapsedOperatingMs,
    // 잘렸더라도 기준점은 now로 옮긴다 — 안 옮기면 다음 tick에도 같은 공백을 또 반영해 영원히 밀린다.
    nextWallClock: now,
    clampedCatchUp,
  };
}

/**
 * 운영 1개월의 일수. `auto-shipment.ts`의 `DAYS_PER_MONTH`와 같은 값이어야 한다 —
 * 자동출하가 `contractedMonthlyQty / DAYS_PER_MONTH × 운영일수`로 나가므로, 이행률 집계 창이
 * 다른 기준을 쓰면 분모와 분자의 축이 갈라진다.
 */
export const OPERATING_DAYS_PER_MONTH = 30;

/** 운영 절대일. 스냅샷의 키이자 트렌드 x축의 눈금이다. */
export function operatingDayOf(operatingEpochMs: number): number {
  return Math.max(0, Math.floor(operatingEpochMs / MS_PER_OPERATING_DAY));
}

/** 운영 절대월. 계약 이행률처럼 "월" 단위 약정을 집계할 때의 창이다. */
export function operatingMonthOf(operatingEpochMs: number): number {
  return Math.max(0, Math.floor(operatingDayOf(operatingEpochMs) / OPERATING_DAYS_PER_MONTH));
}

/**
 * prev → next 사이에 **완료된** 운영일 목록(오름차순).
 *
 * 진행 중인 날은 포함하지 않는다 — 하루가 끝나야 그 날의 집계가 확정되기 때문이다.
 * catch-up으로 여러 날을 건너뛴 경우 그 사이 날을 모두 돌려주므로, 호출자가 빠짐없이 적재할 수 있다.
 */
export function operatingDaysCompletedBetween(prevOpMs: number, nextOpMs: number): number[] {
  const from = operatingDayOf(prevOpMs);
  const to = operatingDayOf(nextOpMs);
  if (to <= from) return [];
  const days: number[] = [];
  for (let d = from; d < to; d++) days.push(d);
  return days;
}
