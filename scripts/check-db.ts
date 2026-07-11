import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql/web";

async function main() {
  const adapter = new PrismaLibSql({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = new PrismaClient({ adapter } as any);

  const user = await db.user.findUnique({ where: { email: "admin@fab.skh" } });
  if (user) {
    console.log("✅ 유저 존재:", { email: user.email, name: user.name, pwLen: user.password.length });
  } else {
    console.log("❌ 유저 없음: admin@fab.skh");
  }

  const count = await db.user.count();
  console.log("총 유저 수:", count);

  await db.$disconnect();
}

main().catch(console.error);
