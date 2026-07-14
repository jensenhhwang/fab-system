export const dynamic = "force-dynamic";
import { collections } from "@/lib/db";
import WmsClient from "./WmsClient";

export default async function WmsPage() {
  const { inventoryLots, inventoryMovements, materials, warehouses, simState: simStateColl } = await collections();

  const [lots, movements, materialDocs, warehouseDocs, simStateDoc] = await Promise.all([
    inventoryLots.find({ qualityStatus: "AVAILABLE" }).sort({ expiryDate: 1, receivedAt: 1 }).toArray(),
    inventoryMovements
      .find({ type: { $in: ["RECEIPT", "ISSUE"] } })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray(),
    materials.find({}).toArray(),
    warehouses.find({}).toArray(),
    simStateColl.findOne({ _id: "singleton" }),
  ]);

  const matMap = Object.fromEntries(materialDocs.map((m) => [m._id, m]));
  const whMap = Object.fromEntries(warehouseDocs.map((w) => [w._id, w]));

  return (
    <>
      {simStateDoc?.status === "RUNNING" && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-xl text-sm font-medium w-fit">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          시뮬레이션 진행 중 · {new Date(simStateDoc.simDate).toLocaleDateString("ko-KR")}
        </div>
      )}
      <WmsClient
        lots={JSON.parse(JSON.stringify(lots))}
        movements={JSON.parse(JSON.stringify(movements))}
        matMap={JSON.parse(JSON.stringify(matMap))}
        whMap={JSON.parse(JSON.stringify(whMap))}
      />
    </>
  );
}
