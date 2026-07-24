import assert from "node:assert/strict";
import "dotenv/config";
import { getOrInitTwinState, acquireTwinLock, releaseTwinLock } from "../src/lib/twin/state";

async function main() {
  const state = await getOrInitTwinState();
  assert.equal(state._id, "singleton", "싱글턴 상태");
  assert.ok(state.tickIntervalMs > 0, "tick 간격 기본값");
  assert.equal(state.speedMultiplier, 1, "배속 기본 1");

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
