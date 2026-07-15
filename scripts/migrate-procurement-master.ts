import { collections } from "../src/lib/db";

async function main() {
  const { materialSuppliers } = await collections(); const links = await materialSuppliers.find({}).toArray(); let updated = 0;
  for (const link of links) {
    const result = await materialSuppliers.updateOne({ _id: link._id }, { $set: {
      standardLeadTimeDays: link.standardLeadTimeDays ?? link.leadTimeDays,
      qualificationStatus: link.qualificationStatus ?? "APPROVED",
      sourcingRole: link.sourcingRole ?? (link.isPrimary ? "PRIMARY" : "SECONDARY"),
      emergencyOrderAllowed: link.emergencyOrderAllowed ?? false, updatedAt: new Date(),
    } });
    updated += result.modifiedCount;
  }
  await materialSuppliers.createIndex({ materialId: 1, supplierId: 1 }, { unique: true });
  console.log(`✅ 조달 기준 ${updated}/${links.length}건 마이그레이션 완료`); process.exit(0);
}
main().catch(error => { console.error(error); process.exit(1); });
