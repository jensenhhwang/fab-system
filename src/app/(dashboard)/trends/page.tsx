export const dynamic = "force-dynamic";

import { collections } from "@/lib/db";
import { OPERATING_SPEED_MULTIPLIER } from "@/lib/twin/operating-clock";
import TrendsClient from "./TrendsClient";

export default async function TrendsPage() {
  const { twinDailySnapshots } = await collections();
  const first = await twinDailySnapshots.find({}).sort({ operatingDay: 1 }).limit(1).next();

  return (
    <>
      <div className="mb-1 text-2xl font-extrabold tracking-tight">운영 트렌드</div>
      <div className="mb-6 text-sm text-[#999]">
        설계 기준선 대비 편차 · 운영일 축 기본 (실제 1시간 = 운영 1일, {OPERATING_SPEED_MULTIPLIER}×) ·{" "}
        {first
          ? `적재 시작 운영 ${first.operatingDay}일차 (${new Date(first.recordedAt).toLocaleDateString("ko-KR")})`
          : "아직 적재된 스냅샷이 없다 — 운영일이 한 번 넘어가면 첫 점이 생긴다"}
      </div>
      <TrendsClient />
    </>
  );
}
