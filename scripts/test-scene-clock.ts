import assert from "node:assert/strict";
import { calculateServerOffset, sceneReferenceTime } from "../src/lib/scene-clock";

const clientReceivedAt = Date.parse("2026-07-17T03:00:05.000Z");
const offset = calculateServerOffset("2026-07-17T03:00:00.000Z", clientReceivedAt);
assert.equal(offset, -5_000, "서버와 브라우저의 시각 차이를 오프셋으로 보정해야 한다");
assert.equal(sceneReferenceTime({ mode: "LIVE", clientNowMs: clientReceivedAt + 10_000, serverOffsetMs: offset, pausedAtMs: null }), Date.parse("2026-07-17T03:00:10.000Z"));
const pausedAt = Date.parse("2026-07-17T03:00:12.000Z");
assert.equal(sceneReferenceTime({ mode: "PAUSED", clientNowMs: clientReceivedAt + 999_000, serverOffsetMs: offset, pausedAtMs: pausedAt }), pausedAt, "PAUSED에서는 브라우저 시간이 지나도 기준 시각이 고정되어야 한다");
assert.equal(calculateServerOffset("invalid", clientReceivedAt), 0, "잘못된 서버 시각은 안전한 0 오프셋으로 처리해야 한다");

console.log("✅ Campus SceneClock server offset, LIVE, PAUSED rules passed");
