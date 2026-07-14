import { collections } from "@/lib/db";
import MesClient from "./MesClient";

export const dynamic = "force-dynamic";

export default async function MesPage() {
  const { workOrders } = await collections();

  const initialWorkOrders = await workOrders
    .find({})
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();

  return (
    <MesClient
      initialWorkOrders={JSON.parse(JSON.stringify(initialWorkOrders))}
    />
  );
}
