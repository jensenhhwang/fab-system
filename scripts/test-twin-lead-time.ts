import assert from "node:assert/strict";
import { getBaseLeadTime, LEAD_TIME_RANGE } from "../src/lib/twin/lead-time";

assert.equal(getBaseLeadTime("CHM"), 11, "CHM 평균 리드타임 (7+14)/2 반올림");
assert.equal(getBaseLeadTime("GAS"), 5, "GAS 평균 리드타임 (3+7)/2");
assert.equal(getBaseLeadTime("PKG"), 8, "PKG 평균 리드타임 (5+10)/2 반올림");
assert.equal(getBaseLeadTime("UNKNOWN"), 7, "미정의 카테고리 기본 7일");
assert.deepEqual(LEAD_TIME_RANGE.CHM, [7, 14], "CHM 범위");

console.log("✅ twin lead-time passed");
