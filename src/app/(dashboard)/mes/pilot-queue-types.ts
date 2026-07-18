import type { WorkOrderDoc, TransferOrderStatus } from "@/lib/db";

export type StallLevel = "normal" | "warn" | "critical";

export type PilotQueueItemView = {
  workOrder: WorkOrderDoc;
  transferStatus: TransferOrderStatus | null;
  statusSince: string;
  ageMs: number;
  stallLevel: StallLevel;
};

export const STALL_LABEL: Record<StallLevel, string> = {
  normal: "정상",
  warn: "주의",
  critical: "정체",
};

export function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  return `${hours}시간 ${minutes % 60}분 전`;
}
