import assert from "node:assert/strict";
import { jitteredLastEventAt, DESYNC_EXTRA_DELAY_CHANCE } from "../src/lib/lot-route";

// 회귀 배경: tick 간격(5s)과 AUTO_ADVANCE_INTERVAL_MS(5s)가 같아서, 한 번이라도 같은 tick에
// 같이 처리된 로트들은 그 순간부터 영원히 동기화된 채로 움직인다(자재 소모/발주가 tick마다
// 거대하게 몰림 → 창고 초과). 매 advance/release마다 소확률로 한 tick 더 미뤄서, 뭉친 무리가
// 시간이 지나면서 서서히 흩어지게 한다.

const now = new Date("2026-08-02T00:00:00.000Z");
const interval = 5_000;

// rand가 임계값보다 작으면(지연 당첨) 정확히 한 tick(interval) 지연된다
assert.equal(
  jitteredLastEventAt(now, interval, 0).getTime(),
  now.getTime() + interval,
  "rand=0이면 무조건 지연 당첨이어야 한다",
);

// rand가 임계값 이상이면 지연 없이 그대로다(정상 페이스 유지가 대다수여야 평균 처리량이 안 죽는다)
assert.equal(
  jitteredLastEventAt(now, interval, 0.999).getTime(),
  now.getTime(),
  "rand가 확률 임계값 이상이면 지연이 없어야 한다",
);

// 경계값: 확률 임계값 바로 아래/위
assert.equal(
  jitteredLastEventAt(now, interval, DESYNC_EXTRA_DELAY_CHANCE - 0.0001).getTime(),
  now.getTime() + interval,
  "임계값 바로 아래는 지연 당첨",
);
assert.equal(
  jitteredLastEventAt(now, interval, DESYNC_EXTRA_DELAY_CHANCE).getTime(),
  now.getTime(),
  "임계값과 같거나 크면 지연 없음",
);

// 평균 처리량이 크게 죽지 않도록 확률은 너무 크면 안 된다(예: 30% 미만)
assert.ok(DESYNC_EXTRA_DELAY_CHANCE > 0 && DESYNC_EXTRA_DELAY_CHANCE < 0.3, "지연 확률이 평균 처리량을 크게 해치면 안 된다");

console.log("✅ 로트 동기화 해소(desync) 지터 계산 테스트 통과");
