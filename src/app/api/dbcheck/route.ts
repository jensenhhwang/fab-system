import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 임시 진단. 토큰 값은 절대 노출하지 않는다. 사용 후 삭제.
const SECRET = "dbcheck-9f4e1e-2026";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("k") !== SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = process.env.TURSO_DATABASE_URL ?? "";
  const token = process.env.TURSO_AUTH_TOKEN ?? "";
  const host = url.replace(/^libsql:\/\//, "");
  const body = JSON.stringify({
    baton: null,
    requests: [
      { type: "execute", stmt: { sql: "SELECT 1" } },
      { type: "close" },
    ],
  });

  const out: Record<string, unknown> = {
    hasUrl: !!url,
    hasToken: !!token,
    tokenLen: token.length,
    // 토큰 무결성 확인용: JWT 세그먼트 수(정상=3)와 앞/뒤 4자만
    tokenShape: token ? `${token.split(".").length}seg ${token.slice(0, 4)}..${token.slice(-4)}` : "none",
  };

  // 배포된 토큰으로 직접 raw 문자열 fetch (내 성공 curl과 동일)
  try {
    const r = await fetch(`https://${host}/v2/pipeline`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body,
    });
    out.rawFetch = { status: r.status, body: (await r.text()).slice(0, 160) };
  } catch (e) {
    out.rawFetch = { error: String(e) };
  }

  // Prisma 어댑터로 실제 쿼리 (실패 재현)
  try {
    out.prismaCount = await db.user.count();
  } catch (e) {
    out.prismaError = String(e).slice(0, 200);
  }

  return NextResponse.json(out);
}
