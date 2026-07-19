import "server-only";

import { collections } from "@/lib/db";
import type { FabId } from "@/lib/fab-domain";
import { FAB_SCENARIO, type FabScenario } from "@/lib/fab-scenario";

export async function getLiveFabScenario(fabId: FabId): Promise<FabScenario> {
  const base = FAB_SCENARIO.find((entry) => entry.id === fabId);
  if (!base) throw new Error(`알 수 없는 fabId: ${fabId}`);
  const { fabScenarios } = await collections();
  const doc = await fabScenarios.findOne({ _id: fabId });
  if (!doc) return base;
  return { ...base, utilization: doc.utilization };
}

export async function setFabUtilization(fabId: FabId, utilization: number, actorId: string): Promise<FabScenario> {
  if (!Number.isFinite(utilization) || utilization <= 0 || utilization > 1) {
    throw new Error("가동률은 0 초과 1 이하여야 합니다.");
  }
  const base = FAB_SCENARIO.find((entry) => entry.id === fabId);
  if (!base) throw new Error(`알 수 없는 fabId: ${fabId}`);
  const { fabScenarios } = await collections();
  const now = new Date();
  await fabScenarios.updateOne(
    { _id: fabId },
    { $set: { product: base.product, utilization, updatedAt: now, updatedBy: actorId } },
    { upsert: true },
  );
  return { ...base, utilization };
}
