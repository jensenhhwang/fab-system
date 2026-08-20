"use client";

import { linearScale, niceDomain, linePath } from "../chart-scale";
import { AXIS_INK } from "./palette";

// 창고 8개를 한 화면에 놓기 위한 small multiples 한 칸.
// 계열이 8개면 categorical 색 한계를 넘으므로 색으로 구분하지 않고 칸으로 나눈다.
export default function Sparkline({
  values,
  label,
  thresholds = [],
}: {
  values: number[];
  label: string;
  thresholds?: { value: number; color: string; label: string }[];
}) {
  const W = 200;
  const H = 56;
  const PAD = 6;
  const domain = niceDomain([...values, ...thresholds.map((t) => t.value)], { includeZero: true });
  const y = linearScale(domain, [H - PAD, PAD]);
  const x = linearScale([0, Math.max(values.length - 1, 1)], [PAD, W - PAD]);
  const last = values.length ? values[values.length - 1] : null;

  return (
    <div className="rounded-lg border bg-white px-2 py-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-bold text-[#333]">{label}</span>
        <span className="tabular-nums text-[11px] font-black text-[#141413]">
          {last != null ? `${Math.round(last)}%` : "—"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label} 점유율 추이`}>
        {thresholds.map((t) => (
          <line
            key={t.label}
            x1={PAD}
            x2={W - PAD}
            y1={y(t.value)}
            y2={y(t.value)}
            stroke={t.color}
            strokeWidth={1}
            strokeDasharray="3 2"
          />
        ))}
        <path
          d={linePath(values.map((v, i) => ({ x: x(i), y: y(v) })))}
          fill="none"
          stroke={AXIS_INK}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
