import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 임시 진단 엔드포인트. 토큰 값은 절대 노출하지 않는다. 사용 후 삭제.
const SECRET = "diag-9f4e1e-2026";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("k") !== SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = process.env.TURSO_DATABASE_URL ?? "";
  const token = process.env.TURSO_AUTH_TOKEN ?? "";
  const host = url.replace(/^libsql:\/\//, "");
  const pipeline = `https://${host}/v2/pipeline`;
  const body = JSON.stringify({
    baton: null,
    requests: [
      { type: "execute", stmt: { sql: "SELECT 1" } },
      { type: "close" },
    ],
  });

  const result: Record<string, unknown> = {
    hasUrl: !!url,
    hasToken: !!token,
    tokenLen: token.length,
    urlHost: host.slice(0, 20),
  };

  // 1) 문자열 url + 문자열 body 로 raw fetch (내 curl과 동일)
  try {
    const r = await fetch(pipeline, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body,
    });
    result.rawStringFetch = { status: r.status, ok: r.ok, text: (await r.text()).slice(0, 120) };
  } catch (e) {
    result.rawStringFetch = { error: String(e) };
  }

  // 2) Request 객체로 fetch (libsql 이 하는 방식)
  try {
    const reqObj = new Request(pipeline, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body,
    });
    const r = await fetch(reqObj);
    result.requestObjFetch = { status: r.status, ok: r.ok, text: (await r.text()).slice(0, 120) };
  } catch (e) {
    result.requestObjFetch = { error: String(e) };
  }

  // 3) Prisma 어댑터로 실제 쿼리
  try {
    const count = await db.user.count();
    result.prismaCount = count;
  } catch (e) {
    result.prismaError = String(e);
  }

  return NextResponse.json(result);
}
