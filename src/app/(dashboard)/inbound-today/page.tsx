export const dynamic = "force-dynamic";
import { collections } from "@/lib/db";
import InboundTodayClient from "./InboundTodayClient";

export default async function InboundTodayPage() {
  const { materials, warehouses } = await collections();
  const [materialDocs, warehouseDocs] = await Promise.all([
    materials.find({}).toArray(),
    warehouses.find({}).toArray(),
  ]);

  const matMap = Object.fromEntries(
    materialDocs.map((m) => [m._id, { _id: m._id, name: m.name, code: m.code, unit: m.unit }]),
  );
  const whMap = Object.fromEntries(
    warehouseDocs.map((w) => [w._id, { _id: w._id, name: w.name, code: w.code }]),
  );

  return (
    <InboundTodayClient
      matMap={JSON.parse(JSON.stringify(matMap))}
      whMap={JSON.parse(JSON.stringify(whMap))}
    />
  );
}
