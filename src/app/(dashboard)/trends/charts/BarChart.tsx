"use client";

import { useState } from "react";
import { linearScale, niceDomain } from "../chart-scale";
import { AXIS_INK, GRID_INK } from "./palette";

// 단일 계열 막대. 데이터 끝을 4px 라운드하고 막대 사이에 2px 표면 간격을 둔다.
// 계열이 하나면 범례 상자를 두지 않는다 — 아래 라벨이 계열 이름을 말한다.
export default function BarChart({
  values,
  xLabels,
  label,
  color,
  height = 160,
}: {
  values: number[];
  xLabels: string[];
  label: string;
  color: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = height;
  const PAD = { top: 12, right: 16, bottom: 26, left: 48 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const domain = niceDomain(values, { includeZero: true });
  const y = linearScale(domain, [PAD.top + plotH, PAD.top]);
  const slot = plotW / Math.max(values.length, 1);
  const barW = Math.max(slot - 2, 1); // 2px 표면 간격
  const labelEvery = Math.ceil(xLabels.length / 6) || 1;
  const base = y(domain[0]);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label} 추이`}>
        {[domain[0], domain[1]].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke={GRID_INK} strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill={AXIS_INK}>{Math.round(t)}</text>
          </g>
        ))}
        {values.map((v, i) => {
          const top = y(v);
          return (
            <rect
              key={i}
              x={PAD.left + i * slot + 1}
              y={Math.min(top, base)}
              width={barW}
              height={Math.max(Math.abs(base - top), 1)}
              rx={4}
              fill={color}
              opacity={hover == null || hover === i ? 1 : 0.45}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
        {xLabels.map((l, i) =>
          i % labelEvery === 0 ? (
            <text key={i} x={PAD.left + i * slot + barW / 2} y={H - 8} textAnchor="middle" fontSize={9} fill={AXIS_INK}>{l}</text>
          ) : null,
        )}
      </svg>
      <div className="mt-1 text-[10px] font-bold text-[#333]">
        <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: color }} />
        {label}
        {hover != null && <span className="ml-2 tabular-nums text-[#666]">{xLabels[hover]} · {values[hover]}</span>}
      </div>
    </div>
  );
}
