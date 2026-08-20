import { createHash, randomUUID } from "node:crypto";
import type { Collection } from "mongodb";
import { getDb } from "@/lib/db";
import {
  detectOperationSignals,
  OPERATION_MONITOR_POLICY_VERSION,
  proposalDraftFor,
  type EvidenceValue,
  type OperationProposalChange,
  type OperationRole,
  type OperationSignal,
  type OperationSignalKind,
  type OperationSeverity,
} from "@/lib/operations-monitor";
import { buildOperationObservation } from "@/lib/operations-observation-server";

export type OperationIncidentStatus = "OBSERVED" | "ANALYZED" | "PROPOSED" | "RECOVERED";
export type OperationProposalStatus =
  | "PROPOSED"
  | "APPROVED"
  | "REJECTED"
  | "APPLYING"
  | "ACTIVE"
  | "FAILED"
  | "ROLLED_BACK"
  | "VERIFIED";
export type OperationRevisionDecision = "APPROVED" | "REJECTED";

export interface OperationIncidentDoc {
  _id: string;
  scope: string;
  fingerprint: string;
  kind: OperationSignalKind;
  severity: OperationSeverity;
  status: OperationIncidentStatus;
  summary: string;
  affectedRoles: OperationRole[];
  policyVersions: string[];
  firstObservedAt: Date;
  lastObservedAt: Date;
  recordedAt: Date;
  operatingEpochMs: number;
  observationCount: number;
  normalObservationCount: number;
  latestEvidence: Record<string, EvidenceValue>;
  worstEvidence: Record<string, EvidenceValue>;
  releaseCondition: string;
  proposalId: string | null;
  recoveredAt: Date | null;
}

export interface OperationLearningProposalDoc {
  _id: string;
  scope: string;
  incidentIds: string[];
  kind: OperationSignalKind;
  status: OperationProposalStatus;
  proposedByRole: OperationRole;
  change: OperationProposalChange;
  expectedEffects: string[];
  risks: string[];
  evidenceRefs: string[];
  validationPlan: string[];
  rollbackPlan: string[];
  previewHash: string;
  policyVersion: string;
  createdAt: Date;
  updatedAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  decisionReason: string | null;
  applyResult: Record<string, EvidenceValue> | null;
  requestId: string | null;
}

export interface OperationPolicyRevisionDoc {
  _id: string;
  scope: string;
  proposalId: string;
  decision: OperationRevisionDecision;
  decidedBy: string;
  decidedAt: Date;
  recordedAt: Date;
  reason: string;
  previousVersion: string;
  newVersion: string | null;
  applyResult: Record<string, EvidenceValue> | null;
  verificationResult: Record<string, EvidenceValue> | null;
}

export interface OperationMonitorStateDoc {
  _id: string;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  lastScanAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
}

type OperationCollections = {
  incidents: Collection<OperationIncidentDoc>;
  proposals: Collection<OperationLearningProposalDoc>;
  revisions: Collection<OperationPolicyRevisionDoc>;
  state: Collection<OperationMonitorStateDoc>;
};

const LEASE_MS = 5 * 60_000;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isDuplicateKey(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: number }).code === 11000,
  );
}

export async function operationCollections(): Promise<OperationCollections> {
  const db = await getDb();
  return {
    incidents: db.collection<OperationIncidentDoc>("operationIncidents"),
    proposals: db.collection<OperationLearningProposalDoc>("operationLearningProposals"),
    revisions: db.collection<OperationPolicyRevisionDoc>("operationPolicyRevisions"),
    state: db.collection<OperationMonitorStateDoc>("operationMonitorState"),
  };
}

export async function ensureOperationMonitorIndexes(): Promise<void> {
  const { incidents, proposals, revisions } = await operationCollections();
  await Promise.all([
    incidents.createIndex({ scope: 1, fingerprint: 1 }, { unique: true }),
    incidents.createIndex({ scope: 1, status: 1, severity: 1, lastObservedAt: -1 }),
    proposals.createIndex({ scope: 1, incidentIds: 1, status: 1 }),
    proposals.createIndex({ scope: 1, status: 1, createdAt: -1 }),
    revisions.createIndex({ scope: 1, proposalId: 1, recordedAt: -1 }),
  ]);
}

export async function acquireOperationMonitorLease(
  owner: string,
  now: Date,
  options: { stateId?: string } = {},
): Promise<boolean> {
  const { state } = await operationCollections();
  const stateId = options.stateId ?? "singleton";
  try {
    const claimed = await state.findOneAndUpdate(
      {
        _id: stateId,
        $or: [
          { leaseUntil: { $lte: now } },
          { leaseUntil: null },
          { leaseUntil: { $exists: false } },
          { leaseOwner: owner },
        ],
      },
      {
        $setOnInsert: {
          lastSuccessAt: null,
          lastError: null,
        },
        $set: {
          leaseOwner: owner,
          leaseUntil: new Date(now.getTime() + LEASE_MS),
          lastScanAt: now,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    return claimed?.leaseOwner === owner;
  } catch (error) {
    if (isDuplicateKey(error)) return false;
    throw error;
  }
}

export async function releaseOperationMonitorLease(
  owner: string,
  options: { stateId?: string; succeededAt?: Date; error?: string | null } = {},
): Promise<void> {
  const { state } = await operationCollections();
  const update: Record<string, unknown> = {
    leaseOwner: null,
    leaseUntil: null,
  };
  if (options.succeededAt) {
    update.lastSuccessAt = options.succeededAt;
    update.lastError = null;
  } else if (options.error) {
    update.lastError = options.error;
  }
  await state.updateOne(
    { _id: options.stateId ?? "singleton", leaseOwner: owner },
    { $set: update },
  );
}

export type PersistOperationSignalsResult = {
  observed: number;
  recovered: number;
  proposed: number;
};

export async function persistOperationSignals(
  signals: OperationSignal[],
  options: { scope?: string; now?: Date; recoverMissing?: boolean } = {},
): Promise<PersistOperationSignalsResult> {
  const scope = options.scope ?? "LIVE";
  const now = options.now ?? new Date();
  const { incidents, proposals } = await operationCollections();
  const activeIncidentIds: string[] = [];
  let proposed = 0;

  for (const signal of signals) {
    const incidentId = hash(`${scope}:${signal.fingerprint}`);
    activeIncidentIds.push(incidentId);
    const existing = await incidents.findOne({ _id: incidentId, scope });
    if (!existing) {
      try {
        await incidents.insertOne({
          _id: incidentId,
          scope,
          fingerprint: signal.fingerprint,
          kind: signal.kind,
          severity: signal.severity,
          status: "OBSERVED",
          summary: signal.summary,
          affectedRoles: signal.affectedRoles,
          policyVersions: [signal.policyVersion],
          firstObservedAt: signal.recordedAt,
          lastObservedAt: signal.recordedAt,
          recordedAt: signal.recordedAt,
          operatingEpochMs: signal.operatingEpochMs,
          observationCount: 1,
          normalObservationCount: 0,
          latestEvidence: signal.evidence,
          worstEvidence: signal.evidence,
          releaseCondition: signal.releaseCondition,
          proposalId: null,
          recoveredAt: null,
        });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
      }
    } else {
      await incidents.updateOne(
        { _id: incidentId, scope },
        {
          $set: {
            severity: signal.severity,
            status: existing.status === "RECOVERED" ? "OBSERVED" : existing.status,
            summary: signal.summary,
            affectedRoles: signal.affectedRoles,
            lastObservedAt: signal.recordedAt,
            recordedAt: signal.recordedAt,
            operatingEpochMs: signal.operatingEpochMs,
            latestEvidence: signal.evidence,
            releaseCondition: signal.releaseCondition,
            normalObservationCount: 0,
            recoveredAt: null,
          },
          $addToSet: { policyVersions: signal.policyVersion },
          $inc: { observationCount: 1 },
        },
      );
    }

    const current = await incidents.findOne({ _id: incidentId, scope });
    if (!current) continue;
    if (current.status === "OBSERVED" && current.observationCount >= 2) {
      await incidents.updateOne({ _id: incidentId, scope }, { $set: { status: "ANALYZED" } });
      current.status = "ANALYZED";
    }

    const draft = proposalDraftFor(signal);
    if (draft && current.proposalId) {
      const refreshedPreviewHash = hash(JSON.stringify({ change: draft.change, evidenceRefs: draft.evidenceRefs }));
      await proposals.updateOne(
        { _id: current.proposalId, scope, status: "PROPOSED" },
        {
          $set: {
            change: draft.change,
            expectedEffects: draft.expectedEffects,
            risks: draft.risks,
            evidenceRefs: draft.evidenceRefs,
            validationPlan: draft.validationPlan,
            rollbackPlan: draft.rollbackPlan,
            previewHash: refreshedPreviewHash,
            updatedAt: now,
          },
        },
      );
      continue;
    }
    if (current.observationCount < 2 || !draft) continue;
    const proposalId = hash(`${scope}:${incidentId}:${draft.change.actionType}:${signal.policyVersion}`);
    const previewHash = hash(JSON.stringify({ change: draft.change, evidenceRefs: draft.evidenceRefs }));
    await proposals.updateOne(
      { _id: proposalId, scope },
      {
        $setOnInsert: {
          incidentIds: [incidentId],
          kind: draft.kind,
          status: "PROPOSED",
          proposedByRole: draft.proposedByRole,
          change: draft.change,
          expectedEffects: draft.expectedEffects,
          risks: draft.risks,
          evidenceRefs: draft.evidenceRefs,
          validationPlan: draft.validationPlan,
          rollbackPlan: draft.rollbackPlan,
          previewHash,
          policyVersion: signal.policyVersion,
          createdAt: now,
          decidedAt: null,
          decidedBy: null,
          decisionReason: null,
          applyResult: null,
          requestId: null,
        },
        $set: { updatedAt: now },
      },
      { upsert: true },
    );
    await incidents.updateOne(
      { _id: incidentId, scope },
      { $set: { status: "PROPOSED", proposalId } },
    );
    proposed += 1;
  }

  const missingFilter = activeIncidentIds.length > 0 ? { _id: { $nin: activeIncidentIds } } : {};
  const missing = options.recoverMissing === false ? [] : await incidents.find({
      scope,
      status: { $in: ["OBSERVED", "ANALYZED", "PROPOSED"] },
      ...missingFilter,
    }).toArray();
  let recovered = 0;
  for (const incident of missing) {
    const normalObservationCount = incident.normalObservationCount + 1;
    if (normalObservationCount >= 2) {
      await incidents.updateOne(
        { _id: incident._id, scope, status: incident.status },
        { $set: { status: "RECOVERED", normalObservationCount, recoveredAt: now } },
      );
      recovered += 1;
    } else {
      await incidents.updateOne(
        { _id: incident._id, scope, status: incident.status },
        { $set: { normalObservationCount } },
      );
    }
  }

  return { observed: signals.length, recovered, proposed };
}

export type OperationMonitorScanResult = PersistOperationSignalsResult & {
  skipped: boolean;
  reason: "OK" | "LEASE_HELD" | "MONITOR_FAILURE";
  recordedAt: string;
  signalCount: number;
  error: string | null;
};

function failureSignal(now: Date, error: string): OperationSignal {
  const targetId = "OPERATION_OBSERVATION";
  const fingerprint = hash(`MONITOR_FAILURE:${targetId}:${OPERATION_MONITOR_POLICY_VERSION}`);
  return {
    kind: "MONITOR_FAILURE",
    targetId,
    fingerprint,
    policyVersion: OPERATION_MONITOR_POLICY_VERSION,
    severity: "CRITICAL",
    affectedRoles: ["MATERIALS", "PRODUCTION", "LOGISTICS", "PROCUREMENT"],
    summary: "운영 모니터가 공통 스냅샷을 만들지 못했습니다.",
    evidence: { error },
    releaseCondition: "DB 연결과 관측 쿼리를 복구해야 합니다.",
    recordedAt: now,
    operatingEpochMs: 0,
  };
}

export async function runOperationMonitorScan(
  options: { now?: Date; owner?: string } = {},
): Promise<OperationMonitorScanResult> {
  const now = options.now ?? new Date();
  const owner = options.owner ?? `operations-monitor:${randomUUID()}`;
  const acquired = await acquireOperationMonitorLease(owner, now);
  if (!acquired) {
    return {
      skipped: true,
      reason: "LEASE_HELD",
      recordedAt: now.toISOString(),
      signalCount: 0,
      observed: 0,
      recovered: 0,
      proposed: 0,
      error: null,
    };
  }

  try {
    const observation = await buildOperationObservation(now);
    const signals = detectOperationSignals(observation);
    const persisted = await persistOperationSignals(signals, { now });
    await releaseOperationMonitorLease(owner, { succeededAt: new Date() });
    return {
      ...persisted,
      skipped: false,
      reason: "OK",
      recordedAt: observation.recordedAt.toISOString(),
      signalCount: signals.length,
      error: null,
    };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    const persisted = await persistOperationSignals([failureSignal(now, error)], {
      now,
      recoverMissing: false,
    }).catch(() => ({ observed: 0, recovered: 0, proposed: 0 }));
    await releaseOperationMonitorLease(owner, { error }).catch(() => {});
    return {
      ...persisted,
      skipped: false,
      reason: "MONITOR_FAILURE",
      recordedAt: now.toISOString(),
      signalCount: 1,
      error,
    };
  }
}
