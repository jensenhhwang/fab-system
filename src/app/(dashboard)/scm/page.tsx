export const dynamic = "force-dynamic";

import { collections } from "@/lib/db";
import ProcurementMasterClient from "./ProcurementMasterClient";

export default async function Page() {
  const { materials, suppliers, materialSuppliers } = await collections();
  const [materialDocs, supplierDocs, links] = await Promise.all([
    materials.find({}).sort({ code: 1 }).toArray(), suppliers.find({}).sort({ name: 1 }).toArray(), materialSuppliers.find({}).sort({ materialId: 1, isPrimary: -1 }).toArray(),
  ]);
  return <ProcurementMasterClient initialMaterials={materialDocs} initialSuppliers={supplierDocs} initialLinks={links.map(link => ({ ...link, currentExpectedValidUntil: link.currentExpectedValidUntil?.toISOString() ?? null, updatedAt: link.updatedAt?.toISOString() }))}/>;
}
