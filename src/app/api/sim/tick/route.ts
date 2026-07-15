import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json({ error: "자동 시뮬레이션 tick은 종료되었습니다. 운영 What-if를 사용하세요." }, { status: 410 });
}
