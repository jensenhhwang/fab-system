import { randomUUID } from "crypto";
import type { InventoryLotDoc, SimPurchaseOrderDoc, SimEventDoc } from "@/lib/db";

export type MaterialUsage = {
  materialId: string;
  category: string;
  dailyQty: number;
  ropDays: number;
};

export type TickInput = {
  simDate: Date;
  materials: MaterialUsage[];
  lots: InventoryLotDoc[];
  activePOs: SimPurchaseOrderDoc[];
};

export type LotUpdate = { id: string; newAvailable: number; consumed: boolean };
export type NewLot = Omit<InventoryLotDoc, "_id"> & { _id: string; simulated: true };
export type NewPO = SimPurchaseOrderDoc & { simulated: true };
export type UpdatedPO = { id: string; status?: SimPurchaseOrderDoc["status"]; delayDays?: number; actualArrival?: Date };
export type NewMovement = { _id: string; materialId: string; type: "RECEIPT"; quantity: number; lotId: string; reason: string; userId: string; createdAt: Date; simulated: true };

export type TickResult = {
  lotUpdates: LotUpdate[];
  newLots: NewLot[];
  newMovements: NewMovement[];
  newPOs: NewPO[];
  updatedPOs: UpdatedPO[];
  newEvents: SimEventDoc[];
};

const LEAD_TIME_RANGE: Record<string, [number, number]> = {
  CHM: [7, 14],
  GAS: [3, 7],
  PKG: [5, 10],
};

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function getBaseLeadTime(category: string): number {
  const [lo, hi] = LEAD_TIME_RANGE[category] ?? [7, 7];
  return randInt(lo, hi);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isDue(po: SimPurchaseOrderDoc, simDate: Date): boolean {
  const due = addDays(po.expectedArrival, po.delayDays);
  return due <= simDate;
}

export function processTick(input: TickInput): TickResult {
  const { simDate, materials, lots, activePOs } = input;
  const now = new Date();

  const lotUpdates: LotUpdate[] = [];
  const newLots: NewLot[] = [];
  const newMovements: NewMovement[] = [];
  const newPOs: NewPO[] = [];
  const updatedPOs: UpdatedPO[] = [];
  const newEvents: SimEventDoc[] = [];

  // ① 소비 처리 — FEFO (expiryDate ASC, receivedAt ASC)
  const availableLots = lots
    .filter(l => l.qualityStatus === "AVAILABLE" && l.availableQuantity > 0)
    .sort((a, b) => {
      if (a.expiryDate && b.expiryDate) return a.expiryDate.getTime() - b.expiryDate.getTime();
      if (a.expiryDate) return -1;
      if (b.expiryDate) return 1;
      return a.receivedAt.getTime() - b.receivedAt.getTime();
    });

  // 소비 후 가용 수량 추적 (ROP 체크에도 사용)
  const lotAvail = new Map<string, number>(availableLots.map(l => [l._id, l.availableQuantity]));

  for (const mat of materials) {
    let remaining = mat.dailyQty;
    const matLots = availableLots.filter(l => l.materialId === mat.materialId);

    for (const lot of matLots) {
      if (remaining <= 0) break;
      const avail = lotAvail.get(lot._id) ?? 0;
      const consume = Math.min(avail, remaining);
      if (consume <= 0) continue;
      const newAvail = avail - consume;
      lotAvail.set(lot._id, newAvail);
      remaining -= consume;
      lotUpdates.push({ id: lot._id, newAvailable: newAvail, consumed: newAvail === 0 });
    }

    const totalAfter = matLots.reduce((s, l) => s + (lotAvail.get(l._id) ?? 0), 0);
    newEvents.push({
      _id: randomUUID(),
      simDate,
      type: "CONSUMPTION",
      materialId: mat.materialId,
      qty: mat.dailyQty,
      note: `일일 소비 ${mat.dailyQty.toFixed(1)} → 잔여 ${totalAfter.toFixed(1)}`,
      simulated: true,
    });

    if (totalAfter < mat.dailyQty * mat.ropDays) {
      newEvents.push({
        _id: randomUUID(),
        simDate,
        type: "STOCKOUT_RISK",
        materialId: mat.materialId,
        qty: totalAfter,
        note: `재고 위험: 잔여 ${totalAfter.toFixed(1)} / ROP ${(mat.dailyQty * mat.ropDays).toFixed(1)}`,
        simulated: true,
      });
    }
  }

  // ② ROP 체크 → 자동 발주
  for (const mat of materials) {
    const matLots = availableLots.filter(l => l.materialId === mat.materialId);
    const totalAvail = matLots.reduce((s, l) => s + (lotAvail.get(l._id) ?? 0), 0);
    const rop = mat.dailyQty * mat.ropDays;
    const hasPending = activePOs.some(
      po => po.materialId === mat.materialId &&
            (po.status === "PENDING" || po.status === "IN_TRANSIT")
    );
    if (totalAvail < rop && !hasPending) {
      const baseLead = getBaseLeadTime(mat.category);
      const jitter = 0.8 + Math.random() * 0.4;
      const leadDays = Math.round(baseLead * jitter);
      const orderQty = Math.round(Math.max(mat.dailyQty * mat.ropDays * 3, 10));
      const poId = `PO-${Date.now()}-${mat.materialId}`;
      const expectedArrival = addDays(simDate, leadDays);
      newPOs.push({
        _id: poId,
        materialId: mat.materialId,
        qty: orderQty,
        status: "IN_TRANSIT",
        createdSimDate: simDate,
        expectedArrival,
        leadTimeDays: leadDays,
        delayDays: 0,
        simulated: true,
      });
      newEvents.push({
        _id: randomUUID(),
        simDate,
        type: "PO_CREATED",
        materialId: mat.materialId,
        qty: orderQty,
        poId,
        note: `자동 발주 ${orderQty} → 예정 D+${leadDays}`,
        simulated: true,
      });
    }
  }

  // ③ GR 처리 — 도착 예정인 IN_TRANSIT PO
  const duePoIds = new Set<string>();
  for (const po of activePOs) {
    if (po.status !== "IN_TRANSIT") continue;
    if (!isDue(po, simDate)) continue;
    duePoIds.add(po._id);
    const lotId = randomUUID();
    newLots.push({
      _id: lotId,
      materialId: po.materialId,
      lotNo: `SIM-${po._id}`,
      quantity: po.qty,
      availableQuantity: po.qty,
      receivedAt: simDate,
      qualityStatus: "AVAILABLE",
      updatedAt: now,
      simulated: true,
    });
    newMovements.push({
      _id: randomUUID(),
      materialId: po.materialId,
      type: "RECEIPT",
      quantity: po.qty,
      lotId,
      reason: `GR: ${po._id}`,
      userId: "simulator",
      createdAt: now,
      simulated: true,
    });
    updatedPOs.push({ id: po._id, status: "RECEIVED", actualArrival: simDate });
    newEvents.push({
      _id: randomUUID(),
      simDate,
      type: "GR_ARRIVED",
      materialId: po.materialId,
      qty: po.qty,
      poId: po._id,
      note: `GR 도착 ${po.qty} (${po._id})`,
      simulated: true,
    });
  }

  // ④ 랜덤 이벤트 — 아직 도착 안 한 IN_TRANSIT PO
  const pendingPos = activePOs.filter(po => po.status === "IN_TRANSIT" && !duePoIds.has(po._id));
  for (const po of pendingPos) {
    const r = Math.random();
    if (r < 0.01) {
      // 1% PO 취소 + 재발주
      updatedPOs.push({ id: po._id, status: "CANCELLED" });
      newEvents.push({ _id: randomUUID(), simDate, type: "PO_CANCELLED", materialId: po.materialId, poId: po._id, note: `PO 취소 → 재발주`, simulated: true });
      const leadDays = getBaseLeadTime(materials.find(m => m.materialId === po.materialId)?.category ?? "");
      const retryId = `PO-RETRY-${Date.now()}-${po.materialId}`;
      newPOs.push({ _id: retryId, materialId: po.materialId, qty: po.qty, status: "IN_TRANSIT", createdSimDate: simDate, expectedArrival: addDays(simDate, leadDays), leadTimeDays: leadDays, delayDays: 0, simulated: true });
    } else if (r < 0.03) {
      // 2% 부분 입고
      const ratio = 0.6 + Math.random() * 0.2;
      const partQty = Math.round(po.qty * ratio);
      const remQty = po.qty - partQty;
      const lotId = randomUUID();
      newLots.push({ _id: lotId, materialId: po.materialId, lotNo: `SIM-PARTIAL-${Date.now()}`, quantity: partQty, availableQuantity: partQty, receivedAt: simDate, qualityStatus: "AVAILABLE", updatedAt: now, simulated: true });
      newMovements.push({ _id: randomUUID(), materialId: po.materialId, type: "RECEIPT", quantity: partQty, lotId, reason: `부분 GR: ${po._id}`, userId: "simulator", createdAt: now, simulated: true });
      updatedPOs.push({ id: po._id, status: "RECEIVED", actualArrival: simDate });
      const remLeadDays = getBaseLeadTime(materials.find(m => m.materialId === po.materialId)?.category ?? "");
      const remId = `PO-REM-${Date.now()}-${po.materialId}`;
      newPOs.push({ _id: remId, materialId: po.materialId, qty: remQty, status: "IN_TRANSIT", createdSimDate: simDate, expectedArrival: addDays(simDate, remLeadDays), leadTimeDays: remLeadDays, delayDays: 0, simulated: true });
      newEvents.push({ _id: randomUUID(), simDate, type: "PARTIAL_GR", materialId: po.materialId, qty: partQty, poId: po._id, note: `부분 입고 ${partQty}/${po.qty} (${Math.round(ratio * 100)}%)`, simulated: true });
    } else if (r < 0.08) {
      // 5% 공급 지연
      const delayAdd = randInt(2, 5);
      updatedPOs.push({ id: po._id, delayDays: (po.delayDays || 0) + delayAdd });
      newEvents.push({ _id: randomUUID(), simDate, type: "DELAY", materialId: po.materialId, poId: po._id, note: `공급 지연 +${delayAdd}일`, simulated: true });
    }
  }

  return { lotUpdates, newLots, newMovements, newPOs, updatedPOs, newEvents };
}
