import { PrismaClient } from "@/generated/prisma/client";
// Vercel serverless: WebSocket 대신 fetch 기반 HTTP 사용
import { PrismaLibSql } from "@prisma/adapter-libsql/web";

// libsql은 `fetch(Request객체)` 형태로 호출한다. 그런데 Next.js가 패치한
// globalThis.fetch는 Request 객체가 들어오면 내부적으로 new Request(url, { body })로
// 재조립하는데, 이 과정에서 libsql이 넣은 바이트 배열 바디가 손상되어 Turso가
// HTTP 400을 반환한다. 이를 피하기 위해 Request를 (문자열 url, 구체적 바디)로
// 풀어서 넘기는 커스텀 fetch를 사용한다.
const libsqlFetch: typeof globalThis.fetch = async (input, init) => {
  if (
    input &&
    typeof input === "object" &&
    "arrayBuffer" in input &&
    typeof (input as Request).arrayBuffer === "function" &&
    "url" in input
  ) {
    const req = input as Request;
    const body = await req.arrayBuffer();
    return globalThis.fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: body.byteLength ? body : undefined,
    });
  }
  return globalThis.fetch(input, init);
};

function createAdapter() {
  if (process.env.TURSO_DATABASE_URL) {
    return new PrismaLibSql({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
      fetch: libsqlFetch,
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
