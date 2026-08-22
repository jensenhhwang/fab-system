export const dynamic = "force-dynamic";

import { collections } from "@/lib/db";
import { getInventoryScaleUpOverview } from "@/lib/inventory-scaleup-service";
import ErpBridgeClient from "./ErpBridgeClient";

export default async function ErpBridgePage() {
  const { inboundPlans, materials, suppliers, materialSuppliers, warehouses } = await collections();
  const [plans, materialDocs, supplierDocs, links, warehouseDocs, scaleUpOverview] = await Promise.all([
    inboundPlans.find({}).sort({ plannedDate: 1, createdAt: -1 }).toArray(),
    materials.find({}).sort({ code: 1 }).toArray(),
    suppliers.find({}).sort({ name: 1 }).toArray(),
    materialSuppliers.find({}).toArray(),
    warehouses.find({}).toArray(),
    getInventoryScaleUpOverview(),
  ]);
  const matMap = Object.fromEntries(materialDocs.map((m) => [m._id, { _id: m._id, name: m.name, code: m.code, unit: m.unit }]));
  const whMap = Object.fromEntries(warehouseDocs.map((w) => [w._id, { _id: w._id, name: w.name, code: w.code }]));

  return <ErpBridgeClient
    initialPlans={JSON.parse(JSON.stringify(plans))}
    materials={JSON.parse(JSON.stringify(materialDocs))}
    suppliers={JSON.parse(JSON.stringify(supplierDocs))}
    supplierLinks={JSON.parse(JSON.stringify(links))}
    scaleUpOverview={JSON.parse(JSON.stringify(scaleUpOverview))}
    matMap={JSON.parse(JSON.stringify(matMap))}
    whMap={JSON.parse(JSON.stringify(whMap))}
  />;
}
