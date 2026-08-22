export type InboundReceiptTaskStatus =
  | "AWAITING_PHYSICAL_CONFIRMATION"
  | "AWAITING_RECONCILIATION"
  | "RECONCILED"
  | "BLOCKED"
  | "CANCELLED";

export type InboundReceiptTaskEvent = {
  type: "ETA_DUE" | "PHYSICAL_CONFIRMED" | "RECONCILED" | "BLOCKED" | "CANCELLED";
  actorRole: "SYSTEM" | "LOGISTICS" | "MATERIALS";
  actorId: string;
  at: Date;
  fromStatus?: InboundReceiptTaskStatus;
  toStatus: InboundReceiptTaskStatus;
  quantity?: number;
  requestId?: string;
  message: string;
};

export type PhysicalReceiptConfirmation = {
  quantity: number;
  warehouseId: string;
  slotId?: string;
  lotNo: string;
  manufactureDate?: Date;
  expiryDate?: Date;
  confirmedBy: string;
  confirmedAt: Date;
  requestId: string;
  requestHash: string;
};

export type ReceiptReconciliation = {
  lotId: string;
  movementId: string;
  reconciledBy: string;
  reconciledAt: Date;
  requestId: string;
};

export type InboundReceiptTaskDoc = {
  _id: string;
  inboundPlanId: string;
  planNo: string;
  sequence: number;
  materialId: string;
  unit: string;
  plannedDate: Date;
  expectedQuantity: number;
  status: InboundReceiptTaskStatus;
  version: number;
  physicalConfirmation?: PhysicalReceiptConfirmation;
  reconciliation?: ReceiptReconciliation;
  events: InboundReceiptTaskEvent[];
  createdAt: Date;
  updatedAt: Date;
};

export type InboundReceiptAutomationStateDoc = {
  _id: "singleton";
  cutoverDateKey: string;
  createdAt: Date;
  lastScanAt?: Date;
};

export function inboundReceiptTaskId(inboundPlanId: string, sequence: number): string {
  return `INBOUND-RECEIPT:${inboundPlanId}:${sequence}`;
}

export function seoulDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function parseDateOnly(value: unknown, label: string): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new Error(`${label}이 올바르지 않습니다.`);
  }
  return parsed;
}
