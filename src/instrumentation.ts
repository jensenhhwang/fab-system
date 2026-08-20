// Next.js 부팅 시 1회 실행되는 서버 인스트루멘테이션 훅.
//
// 각 스케줄러를 독립적으로 기동한다. 예전에는 두 동적 import를 모두 await한 뒤에 둘을 호출해서,
// 뒤쪽 import가 부팅 시 던지면 트윈 스케줄러가 **아예 시작되지 않았다** — 그리고 그 실패는
// 조용했다. 2026-08-12 22:35부터 08-18까지 132시간 동안 tick이 0회였던 사고의 유력한 경로다.
// 하나가 죽어도 나머지는 뜨고, 죽은 쪽은 이름과 함께 로그에 남는다.
async function startScheduler(name: string, start: () => Promise<() => void>): Promise<void> {
  try {
    const fn = await start();
    fn();
    console.log(`[instrumentation] ${name} 기동`);
  } catch (err) {
    console.error(`[instrumentation] ${name} 기동 실패 — 이 스케줄러 없이 계속 진행한다:`, err);
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // startProductionExecutionScheduler는 2026-08-12에 제거했다 — M21/M22 WIP을 굴리는 엔진이
  // twin(advanceStepBucketWip)과 이 스케줄러 둘로 갈라져 있었고, 화면(node-density)은 자재 소모·
  // 완제품 적립과 연결되지 않은 후자를 읽고 있었다(실측: M21 19,626 vs twin 17,173, M22 21,600 vs
  // 18,720). twin이 3제품 루프로 일반화(2026-08-09)되면서 역할이 중복됐는데 남아 있던 잔재다.
  // 정본은 twin 하나로 통일한다.
  await Promise.all([
    startScheduler("twin", async () => (await import("@/lib/twin/scheduler")).startTwinScheduler),
    startScheduler("inbound-receipt-task", async () => (await import("@/lib/inbound-receipt-task-scheduler")).startInboundReceiptTaskScheduler),
    startScheduler("operations-monitor", async () => (await import("@/lib/operations-monitor-scheduler")).startOperationMonitorScheduler),
  ]);
}
