import type { RouteVisit } from "@/lib/route-master";

export const FOUP_WIP_MASTER_VERSION = "FOUP_WIP_MASTER_M20_V1" as const;
export const FOUP_WIP_BOOTSTRAP_VERSION = "FOUP_WIP_STEADY_STATE_M20_V1" as const;
export const FOUP_WIP_DWELL_MODEL = "SIMPLIFIED_UNIFORM_DWELL" as const;
export const M20_TARGET_PHYSICAL_FOUP = 15_600;
export const M20_TARGET_OCCUPIED_FOUP = 14_040;
export const M20_TARGET_RESERVE_FOUP = 1_560;
export const M20_WATCHED_LOT_COUNT = 12;
export const M20_DAILY_LOT_RELEASE = 156;
export const M20_WAFER_FOUP_DWELL_DAYS = 90;
export const M20_DOWNSTREAM_WIP_EQUIVALENT = 2_340;
export const M20_END_TO_END_WIP_EQUIVALENT = 16_380;
export const M20_WAFERS_PER_FOUP = 25;

const DAY_MS = 86_400_000;

export type FoupFleetProjection = {
  bootstrapVersion: typeof FOUP_WIP_BOOTSTRAP_VERSION;
  manifestStatus: "NOT_APPLIED" | "PREPARING" | "ACTIVE" | "FAILED";
  source: "MODELED_BASELINE";
  accuracy: {
    count: "LEDGER_EXACT";
    position: "ZONE_DERIVED";
    visualization: "WATCHED_LIVE_ONLY";
  };
  target: {
    physicalFleet: number;
    occupied: number;
    reserve: number;
    watched: number;
    dailyRelease: number;
    downstreamWipEquivalent: number;
    endToEndWipEquivalent: number;
  };
  actual: {
    physicalFleet: number;
    occupied: number;
    reserve: number;
    watched: number;
    activeLots: number;
    activeAssignments: number;
  };
  zoneCounts: Record<string, number>;
  reserveStateCounts: Record<string, number>;
  downstreamStatus: "NOT_BOOTSTRAPPED";
};

export type M20SteadyStateSlot = {
  slotIndex: number;
  releaseAt: Date;
  nextTransitionAt: Date;
  currentStepIndex: number;
  currentNodeId: string;
  currentProcessCode: string;
};

export function nextKstMidnight(reference: Date): Date {
  const kstMs = reference.getTime() + 9 * 60 * 60 * 1_000;
  const kst = new Date(kstMs);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1) - 9 * 60 * 60 * 1_000);
}

export function buildM20SteadyStateSlots(bootstrapEndAt: Date, preDicingVisits: readonly RouteVisit[]): M20SteadyStateSlot[] {
  if (preDicingVisits.length === 0) throw new Error("P10.DICING 이전 Route visit가 없습니다.");
  const startAtMs = bootstrapEndAt.getTime() - M20_WAFER_FOUP_DWELL_DAYS * DAY_MS;
  const slotDurationMs = M20_WAFER_FOUP_DWELL_DAYS * DAY_MS / M20_TARGET_OCCUPIED_FOUP;

  return Array.from({ length: M20_TARGET_OCCUPIED_FOUP }, (_, slotIndex) => {
    const releaseAtMs = startAtMs + slotIndex * slotDurationMs;
    const ageRatio = Math.min(0.999999, Math.max(0, (bootstrapEndAt.getTime() - releaseAtMs) / (M20_WAFER_FOUP_DWELL_DAYS * DAY_MS)));
    const currentStepIndex = Math.min(preDicingVisits.length - 1, Math.floor(ageRatio * preDicingVisits.length));
    const visit = preDicingVisits[currentStepIndex];
    const nextBoundaryRatio = (currentStepIndex + 1) / preDicingVisits.length;
    const nextTransitionAt = new Date(releaseAtMs + nextBoundaryRatio * M20_WAFER_FOUP_DWELL_DAYS * DAY_MS);
    return {
      slotIndex,
      releaseAt: new Date(releaseAtMs),
      nextTransitionAt,
      currentStepIndex,
      currentNodeId: visit.nodeId,
      currentProcessCode: visit.processCode,
    };
  });
}

export function modeledFoupCode(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence <= 0) throw new Error("FOUP sequence는 양의 정수여야 합니다.");
  return `FOUP-M20-${String(sequence).padStart(5, "0")}`;
}

export function modeledWaferLotId(releaseAt: Date, dailySequence: number): string {
  const kst = new Date(releaseAt.getTime() + 9 * 60 * 60 * 1_000);
  const date = `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, "0")}${String(kst.getUTCDate()).padStart(2, "0")}`;
  return `WLOT-M20-${date}-${String(dailySequence).padStart(3, "0")}`;
}
