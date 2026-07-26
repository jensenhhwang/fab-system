import "dotenv/config";
import { MongoClient } from "mongodb";
import { DEMO_ACCOUNTS } from "../src/lib/demo-accounts";

const LEGACY_NAMES: Record<(typeof DEMO_ACCOUNTS)[number]["email"], string> = {
  "admin@fab.skh": "황지훈",
  "materials@fab.skh": "김재현",
  "production@fab.skh": "이수진",
  "logistics@fab.skh": "박민준",
};

const apply = process.argv.includes("--apply");
const uri = process.env.DATABASE_URL;

if (!uri) {
  throw new Error("DATABASE_URL 미설정 (MongoDB 연결 문자열 필요)");
}

const client = new MongoClient(uri);

async function main() {
  await client.connect();
  const db = client.db();
  const users = db.collection<{
    _id: string;
    email: string;
    name: string;
    role: string;
  }>("users");
  const risks = db.collection<{ owner?: string }>("risks");
  const emails = DEMO_ACCOUNTS.map((account) => account.email);
  const currentUsers = await users
    .find({ _id: { $in: emails } })
    .project({ _id: 1, email: 1, name: 1, role: 1 })
    .toArray();

  const currentById = new Map(currentUsers.map((user) => [user._id, user]));
  const missing = emails.filter((email) => !currentById.has(email));
  if (missing.length > 0) {
    throw new Error(`데모 사용자 누락: ${missing.join(", ")}`);
  }

  const mismatched = DEMO_ACCOUNTS.filter((account) => {
    const current = currentById.get(account.email);
    return current?.email !== account.email || current?.role !== account.role;
  });
  if (mismatched.length > 0) {
    throw new Error(`데모 사용자 식별자/권한 불일치: ${mismatched.map((account) => account.email).join(", ")}`);
  }

  for (const account of DEMO_ACCOUNTS) {
    const current = currentById.get(account.email);
    console.log(`${account.email}: ${current?.name} → ${account.name}`);
  }

  if (!apply) {
    console.log("DRY RUN: 변경 없음. 실제 적용은 npm run db:migrate-demo-user-names -- --apply");
    return;
  }

  const userResult = await users.bulkWrite(
    DEMO_ACCOUNTS.map((account) => ({
      updateOne: {
        filter: { _id: account.email, email: account.email, role: account.role },
        update: { $set: { name: account.name } },
      },
    })),
  );

  let riskModifiedCount = 0;
  for (const account of DEMO_ACCOUNTS) {
    const legacyName = LEGACY_NAMES[account.email];
    const result = await risks.updateMany(
      { owner: legacyName },
      { $set: { owner: account.name } },
    );
    riskModifiedCount += result.modifiedCount;
  }

  console.log(`완료: 사용자 ${userResult.modifiedCount}건, 리스크 담당자 ${riskModifiedCount}건 변경`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.close();
  });
