import { collections } from "@/lib/db";
import type { SimStateDoc } from "@/lib/db";
import { processTick, type MaterialUsage } from "@/lib/sim-engine";
import type { TickResult } from "@/lib/sim-engine";

export async function getOrInitSimState(): Promise<SimStateDoc> {
  const { simState } = await collections();
  const existing = await simState.findOne({ _id: "singleton" });
  if (existing) return existing;
  const initial: SimStateDoc = {
    _id: "singleton",
    status: "IDLE",
    simDate: new Date(),
    simStartDate: new Date(),
    realStartedAt: new Date(),
    speedMultiplier: 1,
  };
  await simState.insertOne(initial);
  return initial;
}

export async function executeTickAndPersist(): Promise<TickResult> {
  const { simState, inventoryLots, simPurchaseOrders, simEvents, inventoryMovements, processUsage, materials, simCheckpoints } =
    await collections();

  const state = await simState.findOne({ _id: "singleton" });
  if (!state) throw new Error("simState 없음");

  // 자재별 일일 소비량 집계
  const usages = await processUsage.find({ active: { $ne: false } }).toArray();
  const materialDocs = await materials.find({}).toArray();
  const matMap = new Map(materialDocs.map(m => [m._id, m]));

  const usageByMat = new Map<string, number>();
  for (const u of usages) {
    usageByMat.set(u.materialId, (usageByMat.get(u.materialId) ?? 0) + u.monthlyQty / 30);
  }

  const materialUsages: MaterialUsage[] = [];
  for (const [materialId, dailyQty] of usageByMat) {
    const mat = matMap.get(materialId);
    if (!mat || dailyQty <= 0) continue;
    materialUsages.push({
      materialId,
      category: mat.category,
      dailyQty,
      ropDays: mat.ropDays,
    });
  }

  const lots = await inventoryLots.find({ qualityStatus: "AVAILABLE" }).toArray();

  // 틱 실행 전: 실제 lot 상태를 체크포인트로 저장 (simDate = 이 날의 시작 상태)
  const realLots = lots.filter(l => !l.simulated);
  await simCheckpoints.replaceOne(
    { _id: state.simDate.toISOString() },
    {
      simDate: state.simDate,
      createdAt: new Date(),
      realLotStates: realLots.map(l => ({ lotId: l._id, availableQuantity: l.availableQuantity, qualityStatus: l.qualityStatus })),
    } as Parameters<typeof simCheckpoints.replaceOne>[1],
    { upsert: true }
  );
  // 90일 초과 체크포인트 정리
  const cutoff = new Date(state.simDate);
  cutoff.setDate(cutoff.getDate() - 90);
  await simCheckpoints.deleteMany({ simDate: { $lt: cutoff } });
  const activePOs = await simPurchaseOrders
    .find({ status: { $in: ["PENDING", "IN_TRANSIT"] } })
    .toArray();

  const result = processTick({
    simDate: state.simDate,
    materials: materialUsages,
    lots,
    activePOs,
  });

  // DB 반영
  const writes: Promise<unknown>[] = [];

  for (const u of result.lotUpdates) {
    const setDoc: Record<string, unknown> = { availableQuantity: u.newAvailable, updatedAt: new Date() };
    if (u.consumed) setDoc.qualityStatus = "CONSUMED";
    writes.push(inventoryLots.updateOne({ _id: u.id }, { $set: setDoc }));
  }

  for (const lot of result.newLots) {
    writes.push(inventoryLots.insertOne(lot));
  }

  for (const mv of result.newMovements) {
    writes.push(inventoryMovements.insertOne(mv));
  }

  for (const po of result.newPOs) {
    writes.push(simPurchaseOrders.insertOne(po));
  }

  for (const upd of result.updatedPOs) {
    const setFields: Record<string, unknown> = {};
    if (upd.status) setFields.status = upd.status;
    if (upd.delayDays !== undefined) setFields.delayDays = upd.delayDays;
    if (upd.actualArrival) setFields.actualArrival = upd.actualArrival;
    writes.push(simPurchaseOrders.updateOne({ _id: upd.id }, { $set: setFields }));
  }

  for (const ev of result.newEvents) {
    writes.push(simEvents.insertOne(ev));
  }

  // simDate +1일
  const nextDate = new Date(state.simDate);
  nextDate.setDate(nextDate.getDate() + 1);
  writes.push(simState.updateOne({ _id: "singleton" }, { $set: { simDate: nextDate } }));

  await Promise.all(writes);
  return result;
}
