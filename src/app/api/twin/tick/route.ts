import { NextRequest, NextResponse } from "next/server";
import { executeTwinTick } from "@/lib/twin/engine";
import { operatingMsToDays } from "@/lib/twin/operating-clock";
import { getOrInitTwinState } from "@/lib/twin/state";

// 외부 스케줄러가 때리는 tick 엔드포인트.
//
// 왜 필요했나 — 엔진은 지금까지 instrumentation의 self-scheduling setTimeout 체인으로만 돌았다.
// 그건 **살아있는 Node 프로세스**를 전제하는데, 서버리스(Vercel)에서는 인스턴스가 내려가면
// 체인도 같이 죽는다. 워밍된 동안 몇 번 돌다 조용히 멈추므로, 멈춘 걸 알 방법조차 없다.
//
// 운영시계가 tick 횟수가 아니라 **벽시계 경과 × 24**로 흐르기 때문에(RULES.md § Twin 운영시간)
// 호출 간격이 5초든 60초든 시간은 같은 속도로 간다 — 1분 간격이면 한 번에 운영 24분이 흐른다.
// 리드타임 21 운영일은 어느 쪽이든 실제 21시간이다. 간격이 벌어지면 시간이 아니라 **해상도**만
// 굵어진다(WIP이 더 큰 덩어리로 진행).
//
// 로컬 스케줄러와 동시에 켜져 있어도 안전하다 — Mongo 락이 겹침을 막고 뒤늦은 쪽은
// skipped: "LOCKED"로 돌아간다(§twin/state.ts acquireTwinLock).
export const dynamic = "force-dynamic";

// tick 실측 23~45초. Vercel Pro 기본 300초 안에 들어가지만 여유를 명시해 둔다.
export const maxDuration = 300;

/**
 * 인증 — Vercel Cron은 CRON_SECRET이 설정돼 있으면 `Authorization: Bearer <secret>`을 붙여 보낸다.
 * 외부 cron 서비스도 같은 헤더를 쓰면 된다. 시크릿이 없는 배포에서는 엔드포인트를 열지 않는다 —
 * tick은 재고를 깎고 발주를 내보내는 쓰기 작업이라 공개되면 안 된다.
 */
function authorize(req: NextRequest): { ok: true } | { ok: false; res: NextResponse } {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return { ok: false, res: NextResponse.json({ error: "CRON_SECRET 미설정 — tick 엔드포인트가 비활성화돼 있습니다." }, { status: 503 }) };
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ok: true };
}

async function runTick() {
  const startedAt = Date.now();
  const result = await executeTwinTick();
  const state = await getOrInitTwinState();
  return NextResponse.json({
    skipped: result.skipped ?? null,
    durationMs: Date.now() - startedAt,
    operatingDay: Math.floor(operatingMsToDays(state.operatingEpochMs ?? 0)),
    // 벽시계 사실 기록 — 가속하지 않는다
    lastTickAt: state.lastTickAt,
    advanced: result.advanced,
    newPOs: result.newPOs,
    receipts: result.receipts,
    held: result.held,
    blocked: result.blocked,
    autoShipped: result.autoShipped,
    finishedGoodsAdded: result.finishedGoodsAdded,
  });
}

/** Vercel Cron은 GET으로 호출한다. */
export async function GET(req: NextRequest) {
  const auth = authorize(req);
  if (!auth.ok) return auth.res;
  return runTick();
}

/** 외부 cron 서비스·수동 트리거용. */
export async function POST(req: NextRequest) {
  const auth = authorize(req);
  if (!auth.ok) return auth.res;
  return runTick();
}
