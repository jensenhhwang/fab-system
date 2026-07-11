import { PrismaClient } from "@/generated/prisma/client";
// Vercel serverless: WebSocket 대신 fetch 기반 HTTP 사용
import { PrismaLibSql } from "@prisma/adapter-libsql/web";

function createAdapter() {
  if (process.env.TURSO_DATABASE_URL) {
    return new PrismaLibSql({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  // fallback to local SQLite for development without Turso
  const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");
  const path = require("path");
  const dbPath = path.resolve(process.cwd(), "dev.db");
  return new PrismaBetterSqlite3({ url: `file:${dbPath}` });
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = globalForPrisma.prisma ?? new PrismaClient({ adapter: createAdapter() } as any);

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
