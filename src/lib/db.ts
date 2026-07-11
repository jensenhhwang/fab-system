import { PrismaClient } from "@/generated/prisma/client";
// Vercel serverless: WebSocket 대신 fetch 기반 HTTP 사용
import { PrismaLibSql } from "@prisma/adapter-libsql/web";

// libsql은 `fetch(Request객체)`로 호출하는데, Next.js가 패치한 globalThis.fetch가
// Request 객체를 new Request(url,{body})로 재조립하며 바디를 손상시켜 Turso가 400을 낸다.
// 성공하는 수동 curl(문자열 url + 평범한 헤더 객체 + 문자열 바디)과 100% 동일하게
// 풀어서 넘겨 패치 로직의 손상 분기를 회피한다.
const libsqlFetch: typeof globalThis.fetch = async (input, init) => {
  if (
    input &&
    typeof input === "object" &&
    "text" in input &&
    typeof (input as Request).text === "function" &&
    "url" in input
  ) {
    const req = input as Request;
    const bodyText = await req.text(); // 문자열 바디 (curl과 동일)
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => { headers[k] = v; });
    return globalThis.fetch(req.url, {
      method: req.method,
      headers,
      body: bodyText.length ? bodyText : undefined,
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
