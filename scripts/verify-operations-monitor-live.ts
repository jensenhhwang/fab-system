import "dotenv/config";
import assert from "node:assert/strict";
import { getMongoClient } from "../src/lib/db";
import { operationCollections } from "../src/lib/operations-monitor-server";

async function main() {
  const { incidents, proposals, revisions, state } = await operationCollections();
  const [monitor, activeIncidentDocs, pendingProposals, recentProposals, revisionCount] = await Promise.all([
    state.findOne({ _id: "singleton" }),
    incidents.find({ scope: "LIVE", status: { $in: ["OBSERVED", "ANALYZED", "PROPOSED"] } }).toArray(),
    proposals.countDocuments({ scope: "LIVE", status: "PROPOSED" }),
    proposals.find({ scope: "LIVE" }).sort({ createdAt: -1 }).limit(10).toArray(),
    revisions.countDocuments({ scope: "LIVE" }),
  ]);
  assert.ok(monitor?.lastSuccessAt, "운영 모니터의 정상 스캔 이력이 없습니다.");
  assert.ok(Date.now() - monitor.lastSuccessAt.getTime() < 180_000, "운영 모니터 정상 스캔이 3분 이상 지연됐습니다.");

  const incidentById = new Map(activeIncidentDocs.map((incident) => [incident._id, incident]));
  console.log(JSON.stringify({
    monitor: {
      lastScanAt: monitor.lastScanAt?.toISOString() ?? null,
      lastSuccessAt: monitor.lastSuccessAt.toISOString(),
      lastError: monitor.lastError,
      leaseOwner: monitor.leaseOwner,
      leaseUntil: monitor.leaseUntil?.toISOString() ?? null,
    },
    activeIncidents: activeIncidentDocs.length,
    pendingProposals,
    revisionCount,
    proposals: recentProposals.map((proposal) => ({
      id: proposal._id,
      status: proposal.status,
      kind: proposal.kind,
      actionType: proposal.change.actionType,
      targetId: proposal.change.targetId,
      proposedByRole: proposal.proposedByRole,
      expectedEffects: proposal.expectedEffects,
      risks: proposal.risks,
      incident: proposal.incidentIds.map((id) => incidentById.get(id)).filter(Boolean).map((incident) => ({
        summary: incident?.summary,
        observationCount: incident?.observationCount,
        evidence: incident?.latestEvidence,
        releaseCondition: incident?.releaseCondition,
      })),
    })),
  }, null, 2));
}

main()
  .finally(async () => { await (await getMongoClient()).close(); })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
