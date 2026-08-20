"use client";

import { useId, useState } from "react";
import { linearScale, niceDomain, linePath } from "../chart-scale";
import { AXIS_INK, GRID_INK, MARKER_COLOR, MUTED_INK, REFERENCE_INK, SURFACE } from "./palette";

export type LineSeries = { key: string; label: string; color: string; points: (number | null)[] };

// 다계열 라인 + 영역 워시 + 기준선. 이중축은 만들지 않는다 — 단위가 다르면 차트를 나눈다.
//
// 마크 규격(dataviz marks-and-anatomy): 선 2px round · 영역 채움은 계열 색 ~10% 워시 ·
// 끝점 마커 r≥4에 2px 표면 링 · 격자는 hairline 실선(점선 금지) · 라벨은 선별적으로 끝점에만.
export default function LineChart({
  series,
  xLabels,
  referencePct = null,
  referenceLabel,
  unit = "%",
  height = 190,
  markers = [],
  gapBands = [],
}: {
  series: LineSeries[];
  xLabels: string[];
  referencePct?: number | null;
  referenceLabel?: string;
  unit?: string;
  height?: number;
  markers?: number[];
  gapBands?: [number, number][];
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const W = 960;
  const H = height;
  const PAD = { top: 14, right: 56, bottom: 24, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const baseY = PAD.top + plotH;

  const all = series.flatMap((s) => s.points.filter((p): p is number => p != null));
  const domain = niceDomain(referencePct != null ? [...all, referencePct] : all, { includeZero: true });
  const y = linearScale(domain, [baseY, PAD.top]);
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
        <defs>
          <clipPath id={`clip${uid}`}>
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
          </clipPath>
          {series.map((s) => (
            <linearGradient key={s.key} id={`fill${uid}${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.16} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke={GRID_INK} strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t) + 3} textAnchor="end" fontSize={10} fill={AXIS_INK} style={{ fontVariantNumeric: "tabular-nums" }}>
              {Math.round(t)}
            </text>
          </g>
        ))}

        {/* 엔진이 멈춘 구간 — 스냅샷이 없는 날. 데이터가 0인 것과 없는 것을 구분한다. */}
        {gapBands.map(([from, to], i) => (
          <rect key={i} x={x(from)} y={PAD.top} width={Math.max(x(to) - x(from), 2)} height={plotH} fill={GRID_INK} opacity={0.6} />
        ))}

        {markers.map((m) => (
          <line key={m} x1={x(m)} x2={x(m)} y1={PAD.top} y2={baseY} stroke={MARKER_COLOR} strokeWidth={1} opacity={0.5} />
        ))}

        {referencePct != null && (
          <>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(referencePct)} y2={y(referencePct)} stroke={REFERENCE_INK} strokeWidth={1} />
            {referenceLabel && (
              <text x={PAD.left + plotW + 6} y={y(referencePct) + 3} fontSize={9} fontWeight={700} fill={MUTED_INK}>
                {referenceLabel}
              </text>
            )}
          </>
        )}

        <g clipPath={`url(#clip${uid})`}>
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
                  r.length > 1 ? (
                    <g key={i}>
                      <path d={`${linePath(r)} L ${r[r.length - 1].x} ${baseY} L ${r[0].x} ${baseY} Z`} fill={`url(#fill${uid}${s.key})`} />
                      <path d={linePath(r)} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    </g>
                  ) : (
                    // 이웃이 없는 점은 path로 그리면 아무것도 안 보인다 — 백필을 하지 않으므로
                    // 적재 초기 며칠이 정확히 이 상태다. 고립점은 규격 마커(r=4 + 2px 표면 링)로 찍는다.
                    <circle key={i} cx={r[0].x} cy={r[0].y} r={4} fill={s.color} stroke={SURFACE} strokeWidth={2} />
                  ),
                )}
                {hover != null && s.points[hover] != null && (
                  <circle cx={x(hover)} cy={y(s.points[hover]!)} r={4} fill={s.color} stroke={SURFACE} strokeWidth={2} />
                )}
              </g>
            );
          })}
        </g>

        {/* 끝점 직접 라벨 — 값을 모든 점에 붙이지 않고 마지막 값만 (선별적 라벨) */}
        {series.map((s) => {
          const lastIdx = s.points.reduce<number>((acc, v, i) => (v != null ? i : acc), -1);
          if (lastIdx < 0) return null;
          return (
            <text
              key={s.key}
              x={x(lastIdx) + 9}
              y={y(s.points[lastIdx]!) + 3}
              fontSize={10}
              fontWeight={800}
              fill={MUTED_INK}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {s.points[lastIdx]}{unit}
            </text>
          );
        })}

        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={baseY} stroke={AXIS_INK} strokeWidth={1} />}

        {xLabels.map((label, i) =>
          i % labelEvery === 0 ? (
            <text key={i} x={x(i)} y={H - 7} textAnchor="middle" fontSize={10} fill={AXIS_INK}>{label}</text>
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

      {series.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-[11px] font-bold text-[#4A453F]">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
              {hover != null && s.points[hover] != null && (
                <span className="text-[#8A8580]" style={{ fontVariantNumeric: "tabular-nums" }}>{s.points[hover]}{unit}</span>
              )}
            </span>
          ))}
          {hover != null && <span className="text-[11px] font-bold text-[#B5B0AA]">{xLabels[hover]}</span>}
        </div>
      )}
    </div>
  );
}
