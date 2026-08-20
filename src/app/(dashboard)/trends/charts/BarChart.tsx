"use client";

import { useState } from "react";
import { linearScale, niceDomain } from "../chart-scale";
import { AXIS_INK, GRID_INK, MUTED_INK } from "./palette";

/** 컬럼 마크 — 데이터 끝(위)만 4px 라운드, 베이스라인은 각지게(dataviz marks-and-anatomy). */
function columnPath(x: number, top: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M ${x} ${top + h} L ${x} ${top + r} Q ${x} ${top} ${x + r} ${top} L ${x + w - r} ${top} Q ${x + w} ${top} ${x + w} ${top + r} L ${x + w} ${top + h} Z`;
}

// 단일 계열 컬럼. 계열이 하나면 범례 상자를 두지 않는다 — 제목이 이미 무엇인지 말한다.
export default function BarChart({
  values,
  xLabels,
  label,
  color,
  height = 150,
}: {
  values: number[];
  xLabels: string[];
  label: string;
  color: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 960;
  const H = height;
  const PAD = { top: 14, right: 56, bottom: 24, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const domain = niceDomain(values, { includeZero: true });
  const y = linearScale(domain, [PAD.top + plotH, PAD.top]);
  const slot = plotW / Math.max(values.length, 1);
  // 막대는 24px를 넘지 않는다 — 슬롯을 꽉 채우지 않고 남는 폭은 공기로 둔다.
  // 2px는 이웃 막대를 가르는 표면 간격.
  const barW = Math.min(Math.max(slot - 2, 1), 24);
  const barOffset = (slot - barW) / 2;
  const labelEvery = Math.ceil(xLabels.length / 6) || 1;
  const base = y(domain[0]);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label} 추이`}>
        {[domain[0], domain[1]].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke={GRID_INK} strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t) + 3} textAnchor="end" fontSize={10} fill={AXIS_INK} style={{ fontVariantNumeric: "tabular-nums" }}>
              {Math.round(t)}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const top = y(v);
          const h = Math.max(Math.abs(base - top), 1);
          return (
            <path
              key={i}
              d={columnPath(PAD.left + i * slot + barOffset, Math.min(top, base), barW, h)}
              fill={color}
              opacity={hover == null || hover === i ? 1 : 0.4}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
        {/* 값은 마지막 캡에만 — 모든 막대에 숫자를 붙이면 읽히지 않는다 */}
        {values.length > 0 && (
          <text
            x={PAD.left + (values.length - 1) * slot + barOffset + barW / 2}
            y={y(values[values.length - 1]) - 7}
            textAnchor="middle"
            fontSize={11}
            fontWeight={800}
            fill={MUTED_INK}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {values[values.length - 1]}
          </text>
        )}
        {xLabels.map((l, i) =>
          i % labelEvery === 0 ? (
            <text key={i} x={PAD.left + i * slot + barOffset + barW / 2} y={H - 7} textAnchor="middle" fontSize={10} fill={AXIS_INK}>{l}</text>
          ) : null,
        )}
      </svg>
      {hover != null && (
        <div className="mt-1 text-[11px] font-bold text-[#8A8580]" style={{ fontVariantNumeric: "tabular-nums" }}>
          {xLabels[hover]} · {values[hover]}
        </div>
      )}
    </div>
  );
}
