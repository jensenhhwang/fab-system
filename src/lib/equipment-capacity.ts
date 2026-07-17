import "server-only";
import { collections } from "@/lib/db";
import type { EquipmentStatus } from "@/lib/db";
import type { FabId } from "@/lib/fab-domain";

export type ProcessEquipmentSummary = {
  processCode: string;
  total: number;
  byStatus: Record<EquipmentStatus, number>;
  availableCapacity: number;
  capacityUnit: "WAFER_DAY";
  source: "MODELED_BASELINE" | "MES_MASTER";
};

export async function getEquipmentCapacity(fabId: FabId): Promise<ProcessEquipmentSummary[]> {
  const { equipmentMaster } = await collections();
  const equipment = await equipmentMaster.find({ fabId }).sort({ processCode: 1, _id: 1 }).toArray();
  const summary = new Map<string, ProcessEquipmentSummary>();
  for (const tool of equipment) {
    const row = summary.get(tool.processCode) ?? {
      processCode: tool.processCode,
      total: 0,
      byStatus: { RUN: 0, IDLE: 0, PM: 0, DOWN: 0 },
      availableCapacity: 0,
      capacityUnit: tool.capacityUnit,
      source: tool.source,
    };
    row.total += 1;
    row.byStatus[tool.status] += 1;
    if (tool.status === "RUN" || tool.status === "IDLE") row.availableCapacity += tool.ratedCapacity * tool.oee;
    if (tool.source === "MES_MASTER") row.source = "MES_MASTER";
    summary.set(tool.processCode, row);
  }
  return [...summary.values()].map((row) => ({ ...row, availableCapacity: Math.round(row.availableCapacity) }));
}
