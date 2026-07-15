import type { MaterialSupplierDoc, SupplierDoc } from "@/lib/db";

export type ProcurementAlternative = { supplierId: string; supplierName: string; role: "PRIMARY" | "SECONDARY"; standardDays: number | null; emergencyOrderAllowed: boolean };
export type ProcurementSummary = {
  supplierId: string; supplierName: string; normalDays: number | null; safeDays: number | null;
  normalSource: "CURRENT" | "STANDARD" | "LEGACY" | "MISSING"; rangeComplete: boolean;
  alternatives: ProcurementAlternative[];
};

export function standardLeadTime(link: MaterialSupplierDoc): number | null { return link.standardLeadTimeDays ?? link.leadTimeDays ?? null; }
export function currentLeadTime(link: MaterialSupplierDoc, now = new Date()): { days: number | null; source: ProcurementSummary["normalSource"] } {
  const currentValid = link.currentExpectedLeadTimeDays != null && link.currentExpectedValidUntil != null && new Date(link.currentExpectedValidUntil) >= now;
  if (currentValid) return { days: link.currentExpectedLeadTimeDays ?? null, source: "CURRENT" };
  if (link.standardLeadTimeDays != null) return { days: link.standardLeadTimeDays, source: "STANDARD" };
  if (link.leadTimeDays != null) return { days: link.leadTimeDays, source: "LEGACY" };
  return { days: null, source: "MISSING" };
}

export function buildProcurementSummary(links: MaterialSupplierDoc[], suppliers: SupplierDoc[], now = new Date()): ProcurementSummary | null {
  const supplierMap = new Map(suppliers.map(supplier => [supplier._id, supplier.name]));
  const approved = links.filter(link => link.qualificationStatus === "APPROVED");
  if (!approved.length) return null;
  const sorted = [...approved].sort((a, b) => {
    const roleA = (a.sourcingRole ?? (a.isPrimary ? "PRIMARY" : "SECONDARY")) === "PRIMARY" ? 0 : 1;
    const roleB = (b.sourcingRole ?? (b.isPrimary ? "PRIMARY" : "SECONDARY")) === "PRIMARY" ? 0 : 1;
    return roleA - roleB || (currentLeadTime(a, now).days ?? 9999) - (currentLeadTime(b, now).days ?? 9999);
  });
  const selected = sorted[0]; const normal = currentLeadTime(selected, now);
  return {
    supplierId: selected.supplierId, supplierName: supplierMap.get(selected.supplierId) ?? selected.supplierId,
    normalDays: normal.days, safeDays: selected.maxLeadTimeDays ?? null, normalSource: normal.source,
    rangeComplete: selected.minLeadTimeDays != null && selected.maxLeadTimeDays != null,
    alternatives: sorted.slice(1).map(link => ({ supplierId: link.supplierId, supplierName: supplierMap.get(link.supplierId) ?? link.supplierId,
      role: link.sourcingRole ?? (link.isPrimary ? "PRIMARY" : "SECONDARY"), standardDays: standardLeadTime(link), emergencyOrderAllowed: link.emergencyOrderAllowed ?? false })),
  };
}
