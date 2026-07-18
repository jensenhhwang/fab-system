import { randomUUID } from "crypto";
import { collections } from "@/lib/db";
import type { MaterialRerouteDoc } from "@/lib/db";
import type { FabId } from "@/lib/fab-domain";

// 중앙 창고 재고(InventoryDoc)는 fabId 없이 공용 풀로 관리됩니다.
// 따라서 "당겨쓰기"는 실물 자재를 이동시키는 트랜잭션이 아니라,
// 어느 팹에 우선순위를 두기로 했는지 기록하는 의사결정 감사 로그입니다.

export async function listReroutes(date: string): Promise<MaterialRerouteDoc[]> {
  const { materialReroutes } = await collections();
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(`${date}T23:59:59.999Z`);
  return materialReroutes.find({ decidedAt: { $gte: start, $lte: end } }).sort({ decidedAt: -1 }).toArray();
}

export async function createReroute(input: {
  materialId: string;
  fromFabId: FabId;
  toFabId: FabId;
  quantity: number;
  unit: string;
  reason?: string;
  decidedBy: string;
}): Promise<MaterialRerouteDoc> {
  if (input.fromFabId === input.toFabId) throw new Error("같은 팹으로는 재배정할 수 없습니다.");
  if (!(input.quantity > 0)) throw new Error("재배정 수량은 0보다 커야 합니다.");
  const { materials, materialReroutes } = await collections();
  const material = await materials.findOne({ _id: input.materialId });
  if (!material) throw new Error("자재를 찾을 수 없습니다.");

  const doc: MaterialRerouteDoc = {
    _id: randomUUID(),
    materialId: input.materialId,
    fromFabId: input.fromFabId,
    toFabId: input.toFabId,
    quantity: input.quantity,
    unit: input.unit,
    reason: input.reason,
    decidedBy: input.decidedBy,
    decidedAt: new Date(),
  };
  await materialReroutes.insertOne(doc);
  return doc;
}
