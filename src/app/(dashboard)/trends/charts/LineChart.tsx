"use client";

import { useId, useState } from "react";
import { linearScale, niceDomain, linePath } from "../chart-scale";
import { AXIS_INK, GRID_INK, MARKER_COLOR } from "./palette";

export type LineSeries = { key: string; label: string; color: string; points: (number | null)[] };

// 다계열 라인 + 기준선. 이중축은 만들지 않는다 — 단위가 다르면 차트를 나눈다.
export default function LineChart({
  series,
  xLabels,
  referencePct = null,
  unit = "%",
  height = 200,
  markers = [],
  gapBands = [],
}: {
  series: LineSeries[];
  xLabels: string[];
  referencePct?: number | null;
  unit?: string;
  height?: number;
  markers?: number[];
  gapBands?: [number, number][];
}) {
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = height;
  const PAD = { top: 12, right: 16, bottom: 26, left: 48 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const all = series.flatMap((s) => s.points.filter((p): p is number => p != null));
  const domain = niceDomain(referencePct != null ? [...all, referencePct] : all, { includeZero: true });
  const y = linearScale(domain, [PAD.top + plotH, PAD.top]);
  // 표본이 하나면 왼쪽 끝에 붙어 잘린 것처럼 보인다 — 가운데에 놓는다.
  const x = xLabels.length <= 1
    ? () => PAD.left + plotW / 2
    : linearScale([0, xLabels.length - 1], [PAD.left, PAD.left + plotW]);
  const ticks = [domain[0], (domain[0] + domain[1]) / 2, domain[1]];
  const labelEvery = Math.ceil(xLabels.length / 6) || 1;
  const slotW = plotW / Math.max(xLabels.length, 1);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${series.map((s) => s.label).join(", ")} 추이`}>
        <clipPath id={clipId}>
          <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
        </clipPath>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke={GRID_INK} strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill={AXIS_INK}>{Math.round(t)}</text>
          </g>
        ))}

        {/* 엔진이 멈춘 구간 — 스냅샷이 없는 날. 데이터가 0인 것과 없는 것을 구분한다. */}
        {gapBands.map(([from, to], i) => (
          <rect key={i} x={x(from)} y={PAD.top} width={Math.max(x(to) - x(from), 2)} height={plotH} fill={GRID_INK} opacity={0.5} />
        ))}

        {/* 정책 변경 지점 — 마스터가 바뀐 사건 */}
        {markers.map((m) => (
          <line key={m} x1={x(m)} x2={x(m)} y1={PAD.top} y2={PAD.top + plotH} stroke={MARKER_COLOR} strokeWidth={1} strokeDasharray="2 2" />
        ))}

        {referencePct != null && (
          <line x1={PAD.left} x2={PAD.left + plotW} y1={y(referencePct)} y2={y(referencePct)} stroke={AXIS_INK} strokeWidth={1} strokeDasharray="4 3" />
        )}

        <g clipPath={`url(#${clipId})`}>
          {series.map((s) => {
            // 결측(null)에서 선을 끊는다 — 이어 그리면 없는 날을 있는 것처럼 만든다.
            const runs: { x: number; y: number }[][] = [];
            let run: { x: number; y: number }[] = [];
            s.points.forEach((v, i) => {
              if (v == null) {
                if (run.length) runs.push(run);
                run = [];
                return;
              }
              run.push({ x: x(i), y: y(v) });
            });
            if (run.length) runs.push(run);
            return (
              <g key={s.key}>
                {runs.map((r, i) =>
                  // 이웃이 없는 점은 path로 그리면 아무것도 안 보인다 — 백필을 하지 않으므로
                  // 적재 초기 며칠이 정확히 이 상태다. 고립점은 점으로 찍는다.
                  r.length === 1 ? (
                    <circle key={i} cx={r[0].x} cy={r[0].y} r={3} fill={s.color} />
                  ) : (
                    <path key={i} d={linePath(r)} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  ),
                )}
                {hover != null && s.points[hover] != null && (
                  <circle cx={x(hover)} cy={y(s.points[hover]!)} r={4} fill={s.color} stroke="#FFFFFF" strokeWidth={2} />
                )}
              </g>
            );
          })}
        </g>

        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke={AXIS_INK} strokeWidth={1} />
        )}

        {xLabels.map((label, i) =>
          i % labelEvery === 0 ? (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={9} fill={AXIS_INK}>{label}</text>
          ) : null,
        )}

        {xLabels.map((_, i) => (
          <rect
            key={i}
            x={x(i) - slotW / 2}
            y={PAD.top}
            width={slotW}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[10px] font-bold text-[#333]">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
            {hover != null && s.points[hover] != null && (
              <span className="tabular-nums text-[#666]">{s.points[hover]}{unit}</span>
            )}
          </span>
        ))}
        {hover != null && <span className="text-[10px] font-bold text-[#999]">{xLabels[hover]}</span>}
      </div>
    </div>
  );
}
