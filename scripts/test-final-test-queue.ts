import assert from "node:assert/strict";
import { applyFinalTestQueue, FINAL_TEST_DURATION_DAYS } from "../src/lib/finished-goods";
import { operatingDaysToMs } from "../src/lib/twin/operating-clock";

// I1: 패키징(WIP 완료)이 끝났다고 바로 완제품 재고가 되면 안 된다 — 실제로는 최종테스트를
// 통과해야 판매 가능 재고가 된다(업계 관행). 새 수율을 만들지 않고(이미 assemblyYield가
// 반영돼있음) "시간 지연" 게이트만 추가한다.
// 2026-08-12: 대기 시간의 기준을 tick 파생 simMsPerDay에서 공통 운영시계로 바꿨다
// (RULES.md § Twin 운영시간 — 기능별 독자 시계 금지). 최종테스트 대기는 운영시간으로 흐른다.
const T0 = operatingDaysToMs(100); // 임의의 운영시각 출발점
const TEST_MS = operatingDaysToMs(FINAL_TEST_DURATION_DAYS);

// 1) 처음 완료분이 들어오면 즉시 재고로 안 잡히고 대기열에 쌓인다
{
  const r = applyFinalTestQueue({
    operatingEpochMs: T0, pendingTestQuantity: 0, pendingTestReadyOperatingMs: null,
    newlyCompletedQuantity: 100,
  });
  assert.equal(r.releasedQuantity, 0, "처음 완료분은 바로 재고로 안 풀려야 한다");
  assert.equal(r.nextPendingTestQuantity, 100, "대기열에 쌓여야 한다");
  assert.ok(r.nextPendingTestReadyOperatingMs != null, "테스트 완료 예정 시각이 잡혀야 한다");
  assert.equal(r.nextPendingTestReadyOperatingMs, T0 + TEST_MS, "예정 시각 = 지금 운영시각 + 테스트 소요 운영시간");
}

// 2) 대기 중에 추가로 완료되면 같은 배치에 누적된다(예정 시각은 안 바뀜)
{
  const readyAt = T0 + TEST_MS;
  const r = applyFinalTestQueue({
    operatingEpochMs: T0 + 1000, pendingTestQuantity: 100, pendingTestReadyOperatingMs: readyAt,
    newlyCompletedQuantity: 50,
  });
  assert.equal(r.releasedQuantity, 0, "아직 예정 시각 전이면 안 풀린다");
  assert.equal(r.nextPendingTestQuantity, 150, "같은 배치에 누적돼야 한다");
  assert.equal(r.nextPendingTestReadyOperatingMs, readyAt, "예정 시각은 안 바뀌어야 한다");
}

// 3) 예정 시각이 지나면 쌓인 만큼 전부 재고로 풀린다
{
  const readyAt = T0 + TEST_MS;
  const r = applyFinalTestQueue({
    operatingEpochMs: readyAt + 1, pendingTestQuantity: 150, pendingTestReadyOperatingMs: readyAt,
    newlyCompletedQuantity: 0,
  });
  assert.equal(r.releasedQuantity, 150, "예정 시각이 지나면 쌓인 전량이 풀려야 한다");
  assert.equal(r.nextPendingTestQuantity, 0, "풀린 뒤엔 대기열이 비어야 한다");
  assert.equal(r.nextPendingTestReadyOperatingMs, null, "풀린 뒤엔 예정 시각도 지워져야 한다");
}

// 4) 풀리는 것과 동시에 새로 완료된 게 있으면, 그건 다음 배치로 새로 대기열에 들어간다
{
  const readyAt = T0 + TEST_MS;
  const nowOperating = readyAt + 1;
  const r = applyFinalTestQueue({
    operatingEpochMs: nowOperating, pendingTestQuantity: 150, pendingTestReadyOperatingMs: readyAt,
    newlyCompletedQuantity: 30,
  });
  assert.equal(r.releasedQuantity, 150, "기존 배치는 풀려야 한다");
  assert.equal(r.nextPendingTestQuantity, 30, "새 완료분은 다음 배치로 새로 쌓여야 한다");
  assert.equal(r.nextPendingTestReadyOperatingMs, nowOperating + TEST_MS, "새 배치의 예정 시각이 새로 잡혀야 한다");
}

// 5) 아무 일도 없으면(완료도 없고 대기열도 비어있으면) 아무것도 안 바뀐다
{
  const r = applyFinalTestQueue({ operatingEpochMs: T0 + 500, pendingTestQuantity: 0, pendingTestReadyOperatingMs: null, newlyCompletedQuantity: 0 });
  assert.equal(r.releasedQuantity, 0);
  assert.equal(r.nextPendingTestQuantity, 0);
  assert.equal(r.nextPendingTestReadyOperatingMs, null);
}

console.log("✅ 완제품 최종테스트 게이트(applyFinalTestQueue) 테스트 통과");
