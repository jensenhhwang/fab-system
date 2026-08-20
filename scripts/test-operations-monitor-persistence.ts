import "dotenv/config";
import assert from "node:assert/strict";
import { getDb, getMongoClient } from "../src/lib/db";
import {
  detectOperationSignals,
  type OperationObservationInput,
} from "../src/lib/operations-monitor";
import {
  acquireOperationMonitorLease,
  ensureOperationMonitorIndexes,
  persistOperationSignals,
  releaseOperationMonitorLease,
} from "../src/lib/operations-monitor-server";

const scope = "TEST-OPMON";
const stateId = "TEST-OPMON-state";
const now = new Date("2026-08-20T12:00:00.000Z");
const observation: OperationObservationInput = {
  recordedAt: now,
  operatingEpochMs: 1_296_000_000,
  engine: { status: "RUNNING", secondsSinceTick: 10, tickInProgress: false, lifeSign: "ALIVE", minutesSinceOutput: 1 },
  materials: [{ materialId: "TEST-OPMON-MAT", code: "TEST-OPMON", state: "STOCKOUT", onHand: 0, coverageDays: 0, blockedLots: 4 }],
  procurement: { pendingApproval: 0, oldestPendingApprovalMinutes: 0, pendingOrders: [], openOrders: [] },
  inbound: { held: [] },
  production: { materialBlockedLots: 4, finishedGoodsHeldLots: 0 },
  warehouses: [],
  shipments: [],
  starvedMaterials: [],
  dataGaps: [],
};
const [signal] = detectOperationSignals(observation);

async function cleanup() {
  const db = await getDb();
  await Promise.all([
    db.collection<{ _id: string; scope: string }>("operationIncidents").deleteMany({ scope }),
    db.collection<{ _id: string; scope: string }>("operationLearningProposals").deleteMany({ scope }),
    db.collection<{ _id: string; scope: string }>("operationPolicyRevisions").deleteMany({ scope }),
    db.collection<{ _id: string }>("operationMonitorState").deleteOne({ _id: stateId }),
  ]);
}

async function main() {
  await cleanup();
  try {
    await ensureOperationMonitorIndexes();
    const db = await getDb();

    await persistOperationSignals([signal], { scope, now });
    await persistOperationSignals([signal], { scope, now: new Date(now.getTime() + 60_000) });

    const incidents = await db.collection<{ _id: string; scope: string; observationCount: number; status: string }>("operationIncidents").find({ scope }).toArray();
    assert.equal(incidents.length, 1, "같은 fingerprint는 incident 한 건이어야 한다");
    assert.equal(incidents[0].observationCount, 2);
    assert.equal(incidents[0].status, "PROPOSED", "반복 CRITICAL은 개선안으로 승격되어야 한다");

    const proposals = await db.collection<{ _id: string; scope: string; status: string }>("operationLearningProposals").find({ scope }).toArray();
    assert.equal(proposals.length, 1, "같은 incident의 개선안은 한 건이어야 한다");
    assert.equal(proposals[0].status, "PROPOSED");

    await persistOperationSignals([], { scope, now: new Date(now.getTime() + 120_000) });
    await persistOperationSignals([], { scope, now: new Date(now.getTime() + 180_000) });
    const recovered = await db.collection<{ _id: string; scope: string; status: string }>("operationIncidents").findOne({ scope });
    assert.equal(recovered?.status, "RECOVERED", "두 번 연속 정상 관측이면 복구되어야 한다");

    assert.equal(await acquireOperationMonitorLease("owner-a", now, { stateId }), true);
    assert.equal(await acquireOperationMonitorLease("owner-b", now, { stateId }), false);
    await releaseOperationMonitorLease("owner-a", { stateId });
    assert.equal(await acquireOperationMonitorLease("owner-b", now, { stateId }), true);

    console.log("✅ 운영 모니터 원장·lease 테스트 통과");
  } finally {
    await cleanup();
    await (await getMongoClient()).close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
