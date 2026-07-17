export const dynamic = "force-dynamic";

import { collections } from "@/lib/db";
import { getInventoryScaleUpOverview } from "@/lib/inventory-scaleup-service";
import ErpBridgeClient from "./ErpBridgeClient";

export default async function ErpBridgePage() {
  const { inboundPlans, materials, suppliers, materialSuppliers } = await collections();
  const [plans, materialDocs, supplierDocs, links, scaleUpOverview] = await Promise.all([
    inboundPlans.find({}).sort({ plannedDate: 1, createdAt: -1 }).toArray(),
    materials.find({}).sort({ code: 1 }).toArray(),
    suppliers.find({}).sort({ name: 1 }).toArray(),
    materialSuppliers.find({}).toArray(),
    getInventoryScaleUpOverview(),
  ]);

  return <ErpBridgeClient
    initialPlans={JSON.parse(JSON.stringify(plans))}
    materials={JSON.parse(JSON.stringify(materialDocs))}
    suppliers={JSON.parse(JSON.stringify(supplierDocs))}
    supplierLinks={JSON.parse(JSON.stringify(links))}
    scaleUpOverview={JSON.parse(JSON.stringify(scaleUpOverview))}
  />;
}
