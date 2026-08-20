import assert from "node:assert/strict";
import "dotenv/config";
import { getOrInitTwinState, acquireTwinLock, releaseTwinLock } from "../src/lib/twin/state";

async function main() {
  const state = await getOrInitTwinState();
  assert.equal(state._id, "singleton", "싱글턴 상태");
  assert.ok(state.tickIntervalMs > 0, "tick 간격 기본값");
  // 사문화 필드 회귀 방지 — speedMultiplier는 운영시계가 읽지 않는데 화면이 "1×"로 표시하고
  // 있었다(M20NodeDensityCard). 배속의 진실원은 OPERATING_SPEED_MULTIPLIER 하나다.
  assert.equal(
    (state as unknown as Record<string, unknown>).speedMultiplier, undefined,
    "speedMultiplier는 twin state에 남아 있으면 안 된다",
  );

  const a = await acquireTwinLock("owner-A", 10_000);
  assert.equal(a, true, "첫 락 획득 성공");
  const b = await acquireTwinLock("owner-B", 10_000);
  assert.equal(b, false, "락 점유 중 재획득 실패");
  await releaseTwinLock("owner-A");
  const c = await acquireTwinLock("owner-B", 10_000);
  assert.equal(c, true, "해제 후 획득 성공");
  await releaseTwinLock("owner-B");
  console.log("✅ twin state passed");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
