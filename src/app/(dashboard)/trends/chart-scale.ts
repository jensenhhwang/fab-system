// 차트 좌표 변환 순수 함수. 차트 라이브러리를 넣지 않으므로(package.json 의존성 동결)
// 스케일과 path 생성을 직접 갖는다. React를 import하지 않아 tsx로 바로 테스트된다.

/** 선형 스케일. 도메인 폭이 0이면 범위 중앙으로 눕힌다 — 표본이 하나뿐인 날 NaN이 나오지 않게. */
export function linearScale(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (span === 0) return () => (r0 + r1) / 2;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** 표본에서 안전한 도메인을 만든다. 빈 배열·단일 표본·전부 동일값에서도 폭이 0이 되지 않는다. */
export function niceDomain(values: number[], opts: { includeZero?: boolean } = {}): [number, number] {
  if (values.length === 0) return [0, 1];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (opts.includeZero) min = Math.min(0, min);
  if (min === max) max = min + 1;
  return [min, max];
}

/** SVG 폴리라인 path. 결측 구간은 호출자가 배열을 끊어 넘긴다. */
export function linePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  const [head, ...rest] = points;
  return `M ${head.x} ${head.y}` + rest.map((p) => ` L ${p.x} ${p.y}`).join("");
}

/**
 * 정책 위반 건수가 바뀐 지점의 인덱스.
 *
 * R1·R2·R4는 자재·창고 마스터가 바뀔 때만 값이 변한다 — 연속 곡선이 아니라 사건이다.
 * "ROP 37종을 고쳤더니 이후 결품 곡선이 꺾였는가"를 한 화면에서 읽게 하는 장치다.
 */
export function policyChangePoints(
  points: { policy: { r1: number; r2: number; r3: number; r4: number } }[],
): number[] {
  const marks: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].policy;
    const b = points[i].policy;
    if (a.r1 !== b.r1 || a.r2 !== b.r2 || a.r3 !== b.r3 || a.r4 !== b.r4) marks.push(i);
  }
  return marks;
}
