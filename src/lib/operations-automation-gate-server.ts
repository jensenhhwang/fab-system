// Twin(김구매/이자재/최생산/박물류 게이팅)의 자동 연쇄 실행을 통제하던 재가동 봉인.
// 레거시 M20_PILOT 오케스트레이터(orchestrateM20Agents)는 2026-08-05에 완전히
// 제거됐다 — 이제 이 게이트는 Twin 하나만 통제한다. 역할별 Executor(자율등급
// 승인대기·입고보류·자재 서킷브레이커)와 감사 추적이 구현·검증되어 같은 날
// 사용자 승인으로 해제했다. 문제가 생기면 이 함수를 다시 false로 되돌려
// 즉시 재봉인할 수 있다.
export const OPERATION_ROLE_OWNERS = {
  PROCUREMENT: "김구매",
  MATERIALS: "이자재",
  PRODUCTION: "최생산",
  LOGISTICS: "박물류",
} as const;

export const ROLE_AUTOMATION_GATE_CODE = "TWIN_ROLE_ORCHESTRATION_NOT_READY";

export function isRoleAutomationReady(): boolean {
  return true;
}
