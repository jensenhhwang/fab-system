import { NextResponse } from "next/server";
import { collections } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const { simCheckpoints } = await collections();
  const checkpoints = await simCheckpoints
    .find({}, { projection: { realLotStates: 0 } }) // lot 상세 제외, 날짜 목록만
    .sort({ simDate: -1 })
    .limit(90)
    .toArray();
  return NextResponse.json(checkpoints);
}
