import assert from "node:assert/strict";
import { canTransitionTransfer, positionForTransfer, type LiveTransfer } from "../src/lib/live-transfer";

const base: LiveTransfer = {
  id: "TO-1",
  allocationId: "ALLOC-1",
  materialId: "MAT-1",
  materialCode: "CHM-001",
  materialName: "대표 케미컬",
  category: "CHM",
  fabId: "M20",
  quantity: 100,
  unit: "kg",
  fromFacilityId: "MWH-01",
  toFacilityId: "FAB-M20",
  status: "CREATED",
  requestedAt: "2026-07-17T00:00:00.000Z",
  version: 0,
  updatedAt: "2026-07-17T00:00:00.000Z",
};

const t0 = Date.parse("2026-07-17T00:00:00.000Z");
const created = positionForTransfer(base, t0 + 60_000);
assert.deepEqual(created, { progress: 0, mode: "PLANNED", moving: false }, "요청 생성 전후로 캐리어가 임의 이동하면 안 된다");

const transit: LiveTransfer = {
  ...base,
  status: "IN_TRANSIT",
  departedAt: "2026-07-17T00:00:00.000Z",
  eta: "2026-07-17T00:10:00.000Z",
};
assert.equal(positionForTransfer(transit, t0 + 300_000).progress, 0.5, "ETA 중간 시각은 경로 중간이어야 한다");

const afterEta = positionForTransfer(transit, t0 + 900_000);
assert.equal(afterEta.progress, 1, "ETA 이후에는 목적지에서 멈춰야 한다");
assert.equal(afterEta.mode, "DELAYED", "도착 이벤트가 없으면 지연으로 표시해야 한다");
assert.equal(afterEta.moving, false, "목적지에서 다시 출발하는 루프가 없어야 한다");

const delivered: LiveTransfer = { ...transit, status: "DELIVERED", deliveredAt: "2026-07-17T00:10:00.000Z" };
assert.equal(positionForTransfer(delivered, t0 + 86_400_000).progress, 1, "완료 이송은 시간이 지나도 출발점으로 돌아가면 안 된다");

const telemetry: LiveTransfer = {
  ...transit,
  telemetryAt: "2026-07-17T00:05:00.000Z",
  lastPosition: { x: 0, y: 0, z: 0, progress: 1.7 },
};
const livePosition = positionForTransfer(telemetry, t0 + 305_000);
assert.equal(livePosition.progress, 1, "실측 진행률은 0~1로 제한해야 한다");
assert.equal(livePosition.mode, "TELEMETRY_LIVE", "15초 이내 실측값을 ETA보다 우선해야 한다");
assert.deepEqual(livePosition.telemetryPosition, { x: 0, y: 0, z: 0 }, "실측 좌표를 3D 위치에 전달해야 한다");

const futureTelemetry: LiveTransfer = {
  ...telemetry,
  telemetryAt: "2026-07-17T01:05:00.000Z",
};
assert.equal(positionForTransfer(futureTelemetry, t0 + 305_000).mode, "ETA_ESTIMATE", "먼 미래 시각의 telemetry를 LIVE로 오인하면 안 된다");

const simultaneous = [
  transit,
  { ...transit, id: "TO-2", departedAt: "2026-07-17T00:02:00.000Z", eta: "2026-07-17T00:12:00.000Z", fabId: "M21" as const },
  { ...base, id: "TO-3", status: "STAGED" as const, fabId: "M22" as const },
].map((transfer) => positionForTransfer(transfer, t0 + 300_000));
assert.deepEqual(simultaneous.map((position) => position.progress), [0.5, 0.3, 0.08], "동시 이송은 각 주문의 시간·상태로 독립 계산해야 한다");

assert.equal(canTransitionTransfer("STAGED", "IN_TRANSIT"), true, "정상 순방향 전이를 허용해야 한다");
assert.equal(canTransitionTransfer("IN_TRANSIT", "PICKING"), false, "역방향 상태 전이를 거부해야 한다");
assert.equal(canTransitionTransfer("DELIVERED", "IN_TRANSIT"), false, "완료 주문을 재순환시키면 안 된다");

console.log("✅ live transfer state, concurrency, and no-loop rules passed");
