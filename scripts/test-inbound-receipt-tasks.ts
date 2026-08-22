import assert from "node:assert/strict";
import {
  inboundReceiptTaskId,
  parseDateOnly,
  seoulDateKey,
} from "../src/lib/inbound-receipt-tasks";

assert.equal(
  inboundReceiptTaskId("PLAN-001", 2),
  "INBOUND-RECEIPT:PLAN-001:2",
  "계획과 차수로 결정적인 업무 ID를 만든다",
);

assert.equal(
  seoulDateKey(new Date("2026-08-02T15:00:00.000Z")),
  "2026-08-03",
  "서울 자정 경계를 기준으로 ETA 날짜를 판정한다",
);
assert.equal(
  seoulDateKey(new Date("2026-08-03T14:59:59.999Z")),
  "2026-08-03",
  "서울 영업일 종료 직전까지 같은 날짜다",
);

assert.equal(parseDateOnly("2026-08-03", "제조일")?.toISOString(), "2026-08-03T00:00:00.000Z");
assert.equal(parseDateOnly("", "제조일"), undefined);
assert.throws(() => parseDateOnly("2026-02-30", "제조일"), /올바르지 않습니다/);
assert.throws(() => parseDateOnly("08\/03\/2026", "제조일"), /형식이 올바르지 않습니다/);

console.log("✅ inbound receipt task rules passed");
