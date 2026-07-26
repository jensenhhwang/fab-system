export const dynamic = "force-dynamic";

import VerificationClient from "./VerificationClient";
import {
  getInventoryVerificationSummary,
  listInventoryVerificationCases,
} from "@/lib/inventory-verification-server";

export default async function InventoryVerificationPage() {
  const [page, summary] = await Promise.all([
    listInventoryVerificationCases({ limit: 100 }),
    getInventoryVerificationSummary(),
  ]);
  return <VerificationClient initialItems={page.items} initialSummary={summary} />;
}
