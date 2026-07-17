import type { FabId } from "@/lib/fab-domain";
import type { TransferOrderStatus } from "@/lib/db";

export type TransferPositionMode = "PLANNED" | "STATIC" | "ETA_ESTIMATE" | "TELEMETRY_LIVE" | "DELAYED";

export type LiveTransfer = {
  id: string;
  allocationId: string;
  workOrderId?: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  category: string;
  fabId: FabId;
  quantity: number;
  unit: string;
  fromFacilityId: string;
  toFacilityId: string;
  fromLocationId?: string;
  toLocationId?: string;
  lotId?: string;
  handlingUnitId?: string;
  status: TransferOrderStatus;
  requestedAt: string;
  pickedAt?: string;
  stagedAt?: string;
  departedAt?: string;
  eta?: string;
  receivedAt?: string;
  deliveredAt?: string;
  telemetryAt?: string;
  lastPosition?: { x: number; y: number; z: number; progress?: number };
  version: number;
  updatedAt: string;
};

export type TransferPosition = {
  progress: number;
  mode: TransferPositionMode;
  moving: boolean;
  telemetryPosition?: { x: number; y: number; z: number };
};

export const TRANSFER_NEXT_STATUS: Record<TransferOrderStatus, readonly TransferOrderStatus[]> = {
  CREATED: ["PICKING", "CANCELLED"],
  PICKING: ["STAGED", "CANCELLED"],
  STAGED: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["RECEIVED"],
  RECEIVED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

export function canTransitionTransfer(from: TransferOrderStatus, to: TransferOrderStatus) {
  return TRANSFER_NEXT_STATUS[from].includes(to);
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function positionForTransfer(transfer: LiveTransfer, nowMs: number): TransferPosition {
  if (transfer.status === "CREATED") return { progress: 0, mode: "PLANNED", moving: false };
  if (transfer.status === "PICKING") return { progress: 0, mode: "STATIC", moving: false };
  if (transfer.status === "STAGED") return { progress: 0.08, mode: "STATIC", moving: false };
  if (transfer.status === "RECEIVED") return { progress: 0.94, mode: "STATIC", moving: false };
  if (transfer.status === "DELIVERED") return { progress: 1, mode: "STATIC", moving: false };
  if (transfer.status === "CANCELLED") return { progress: 0, mode: "STATIC", moving: false };

  const telemetryAt = transfer.telemetryAt ? new Date(transfer.telemetryAt).getTime() : null;
  const telemetryAge = telemetryAt === null ? null : nowMs - telemetryAt;
  const telemetryFresh = telemetryAge !== null && telemetryAge >= -5_000 && telemetryAge <= 15_000;
  if (telemetryFresh && transfer.lastPosition) {
    return {
      progress: clamp(transfer.lastPosition.progress ?? 0),
      mode: "TELEMETRY_LIVE",
      moving: true,
      telemetryPosition: {
        x: transfer.lastPosition.x,
        y: transfer.lastPosition.y,
        z: transfer.lastPosition.z,
      },
    };
  }

  const departedAt = transfer.departedAt ? new Date(transfer.departedAt).getTime() : NaN;
  const eta = transfer.eta ? new Date(transfer.eta).getTime() : NaN;
  if (Number.isFinite(departedAt) && Number.isFinite(eta) && eta > departedAt) {
    const progress = clamp((nowMs - departedAt) / (eta - departedAt));
    return {
      progress,
      mode: nowMs > eta ? "DELAYED" : "ETA_ESTIMATE",
      moving: progress > 0 && progress < 1,
    };
  }
  return { progress: 0.08, mode: "DELAYED", moving: false };
}

export const POSITION_MODE_LABEL: Record<TransferPositionMode, string> = {
  PLANNED: "계획",
  STATIC: "원장 상태",
  ETA_ESTIMATE: "ETA 예상 위치",
  TELEMETRY_LIVE: "LIVE 위치",
  DELAYED: "갱신·도착 지연",
};

export const TRANSFER_STATUS_LABEL: Record<TransferOrderStatus, string> = {
  CREATED: "요청 생성",
  PICKING: "피킹 중",
  STAGED: "출고 대기",
  IN_TRANSIT: "이송 중",
  RECEIVED: "Fab 도착",
  DELIVERED: "인계 완료",
  CANCELLED: "취소",
};
