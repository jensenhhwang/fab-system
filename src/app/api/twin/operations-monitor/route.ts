import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { operationCollections } from "@/lib/operations-monitor-server";
import type { OperationMonitorView } from "@/lib/operations-monitor";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const { incidents, proposals, revisions, state } = await operationCollections();
  const [incidentDocs, proposalDocs, revisionDocs, monitorState] = await Promise.all([
    incidents.find({
      scope: "LIVE",
      status: { $in: ["OBSERVED", "ANALYZED", "PROPOSED"] },
    }).sort({ severity: -1, lastObservedAt: -1 }).limit(100).toArray(),
    proposals.find({
      scope: "LIVE",
      status: { $in: ["PROPOSED", "APPROVED", "APPLYING", "ACTIVE", "FAILED"] },
    }).sort({ createdAt: -1 }).limit(100).toArray(),
    revisions.find({ scope: "LIVE" }).sort({ recordedAt: -1 }).limit(20).toArray(),
    state.findOne({ _id: "singleton" }),
  ]);
  const activeIncidentIds = new Set(incidentDocs.map((incident) => incident._id));
  const visibleProposalDocs = proposalDocs.filter((proposal) => (
    proposal.status !== "PROPOSED"
    || proposal.incidentIds.some((incidentId) => activeIncidentIds.has(incidentId))
  ));

  const body: OperationMonitorView = {
    generatedAt: new Date().toISOString(),
    canDecide: access.user.role === "ADMIN",
    incidents: incidentDocs.map((incident) => ({
      id: incident._id,
      kind: incident.kind,
      severity: incident.severity,
      status: incident.status,
      summary: incident.summary,
      affectedRoles: incident.affectedRoles,
      firstObservedAt: incident.firstObservedAt.toISOString(),
      lastObservedAt: incident.lastObservedAt.toISOString(),
      observationCount: incident.observationCount,
      latestEvidence: incident.latestEvidence,
      releaseCondition: incident.releaseCondition,
      proposalId: incident.proposalId,
    })),
    proposals: visibleProposalDocs.map((proposal) => ({
      id: proposal._id,
      kind: proposal.kind,
      status: proposal.status,
      proposedByRole: proposal.proposedByRole,
      change: proposal.change,
      expectedEffects: proposal.expectedEffects,
      risks: proposal.risks,
      validationPlan: proposal.validationPlan,
      rollbackPlan: proposal.rollbackPlan,
      createdAt: proposal.createdAt.toISOString(),
      decidedAt: proposal.decidedAt?.toISOString() ?? null,
      decisionReason: proposal.decisionReason,
      applyResult: proposal.applyResult,
    })),
    revisions: revisionDocs.map((revision) => ({
      id: revision._id,
      proposalId: revision.proposalId,
      decision: revision.decision,
      decidedBy: revision.decidedBy,
      decidedAt: revision.decidedAt.toISOString(),
      reason: revision.reason,
      previousVersion: revision.previousVersion,
      newVersion: revision.newVersion,
      applyResult: revision.applyResult,
      verificationResult: revision.verificationResult,
    })),
    monitor: monitorState ? {
      lastScanAt: monitorState.lastScanAt?.toISOString() ?? null,
      lastSuccessAt: monitorState.lastSuccessAt?.toISOString() ?? null,
      lastError: monitorState.lastError,
    } : null,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
