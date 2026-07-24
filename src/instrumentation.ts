// Next.js 부팅 시 1회 실행되는 서버 인스트루멘테이션 훅.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startTwinScheduler } = await import("@/lib/twin/scheduler");
  startTwinScheduler();
}
