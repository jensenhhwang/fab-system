export const dynamic = "force-dynamic";
import { collections } from "@/lib/db";
import WmsClient from "./WmsClient";

export default async function WmsPage() {
  const { inventoryLots, inventoryMovements, materials, warehouses } = await collections();

  const [lots, movements, materialDocs, warehouseDocs] = await Promise.all([
    inventoryLots.find({ qualityStatus: "AVAILABLE" }).sort({ expiryDate: 1, receivedAt: 1 }).toArray(),
    inventoryMovements
      .find({ type: { $in: ["RECEIPT", "ISSUE"] } })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray(),
    materials.find({}).toArray(),
    warehouses.find({}).toArray(),
  ]);

  const matMap = Object.fromEntries(materialDocs.map((m) => [m._id, m]));
  const whMap = Object.fromEntries(warehouseDocs.map((w) => [w._id, w]));

  return (
    <WmsClient
      lots={JSON.parse(JSON.stringify(lots))}
      movements={JSON.parse(JSON.stringify(movements))}
      matMap={JSON.parse(JSON.stringify(matMap))}
      whMap={JSON.parse(JSON.stringify(whMap))}
    />
  );
}
