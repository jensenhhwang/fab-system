import assert from "node:assert/strict";
import { linearScale, niceDomain, linePath, policyChangePoints } from "../src/app/(dashboard)/trends/chart-scale";

const s = linearScale([0, 100], [0, 200]);
assert.equal(s(0), 0);
assert.equal(s(50), 100);
assert.equal(s(100), 200);

// 도메인 폭이 0이면 나눗셈이 터진다 — 범위 중앙으로 눕힌다.
const flat = linearScale([5, 5], [0, 200]);
assert.equal(flat(5), 100, "도메인 폭 0이면 범위 중앙");

// y축은 위아래가 뒤집힌다(SVG 좌표계).
const inv = linearScale([0, 10], [100, 0]);
assert.equal(inv(0), 100);
assert.equal(inv(10), 0);

assert.deepEqual(niceDomain([3, 7, 5]), [3, 7], "기본은 최소~최대");
assert.deepEqual(niceDomain([3, 7, 5], { includeZero: true }), [0, 7], "0 포함 요청 시 하한 0");
assert.deepEqual(niceDomain([]), [0, 1], "표본이 없으면 안전한 기본 도메인");
assert.deepEqual(niceDomain([4]), [4, 5], "단일 표본은 폭 0이 되지 않게 벌린다");
assert.deepEqual(niceDomain([0, 0, 0]), [0, 1], "전부 0이어도 폭 0을 만들지 않는다");

assert.equal(linePath([]), "", "점이 없으면 빈 path");
assert.equal(linePath([{ x: 1, y: 2 }]), "M 1 2", "점 하나는 M만");
assert.equal(linePath([{ x: 1, y: 2 }, { x: 3, y: 4 }]), "M 1 2 L 3 4");

// 정책 변경 마커 — R1·R2·R4는 마스터가 바뀔 때만 계단으로 변한다. 변한 지점만 세로선으로 찍는다.
const p = (r1: number, r2: number, r3: number, r4: number) => ({ policy: { r1, r2, r3, r4 } });
assert.deepEqual(policyChangePoints([]), [], "표본 없음");
assert.deepEqual(policyChangePoints([p(0, 0, 0, 0)]), [], "첫 점은 변화가 아니다");
assert.deepEqual(policyChangePoints([p(10, 0, 0, 0), p(10, 0, 0, 0)]), [], "그대로면 마커 없음");
assert.deepEqual(policyChangePoints([p(10, 0, 0, 0), p(0, 0, 0, 0)]), [1], "줄어든 지점에 마커");
assert.deepEqual(policyChangePoints([p(0, 0, 0, 0), p(0, 5, 0, 0), p(0, 5, 0, 2)]), [1, 2], "어느 규칙이든 변하면 마커");

console.log("✅ chart scale passed");
