"use client";

import { linearScale, niceDomain, linePath } from "../chart-scale";
import { SURFACE, MUTED_INK, DEEMPHASIS_INK } from "./palette";

// 스탯 타일 계약(dataviz marks-and-anatomy §Figures):
//   label(문장형, 콜론 없음) · value(비례 숫자체, 자동 축약) · delta(부호+기준기간) · trend(스파크라인)
//
// 막대 하나짜리 막대차트는 안티패턴이다 — "숫자가 곧 차트"인 경우 타일로 쓴다.
// 적재 초기에는 표본이 1개뿐이라 이 타일들이 화면의 주된 정보가 된다.
export default function StatTile({
  label,
  value,
  unit,
  delta,
  deltaLabel,
  deltaGoodWhen = "down",
  trend = [],
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: number | null;
  deltaLabel?: string;
  deltaGoodWhen?: "up" | "down";
  trend?: number[];
  accent: string;
}) {
  const W = 120;
  const H = 28;
  const domain = niceDomain(trend, { includeZero: true });
  const y = linearScale(domain, [H - 2, 2]);
  const x = trend.length <= 1 ? () => W / 2 : linearScale([0, trend.length - 1], [0, W]);
  const pts = trend.map((v, i) => ({ x: x(i), y: y(v) }));

  // 방향 × 그 방향이 좋은가 → 색. 상태색은 여기서만 쓰고 계열 색으로는 쓰지 않는다.
  const deltaTone =
    delta == null || delta === 0
      ? MUTED_INK
      : (delta > 0) === (deltaGoodWhen === "up")
        ? "#00875A"
        : "#EA002C";

  return (
    <div className="rounded-2xl border border-[#EDEAE7] bg-white px-4 py-3">
      <div className="text-[11px] font-bold text-[#8A8580]">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        {/* 비례 숫자체 — 큰 독립 숫자에 tabular-nums를 쓰면 헐거워 보인다 */}
        <span className="text-[26px] font-extrabold leading-none tracking-tight text-[#141413]">{value}</span>
        {unit && <span className="text-[12px] font-bold text-[#8A8580]">{unit}</span>}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="text-[10px] font-bold" style={{ color: deltaTone }}>
          {delta == null ? "—" : `${delta > 0 ? "▲" : delta < 0 ? "▼" : "="} ${Math.abs(delta)}`}
          {deltaLabel && <span className="ml-1 font-medium text-[#B5B0AA]">{deltaLabel}</span>}
        </span>
        {/* 표본이 1개면 추이 슬롯을 비운다 — 점 하나는 추세가 아니다 */}
        {trend.length > 1 && (
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="shrink-0" aria-hidden="true">
            <defs>
              <linearGradient id={`tile-${label}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={0.14} />
                <stop offset="100%" stopColor={accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={`${linePath(pts)} L ${pts[pts.length - 1].x} ${H} L ${pts[0].x} ${H} Z`} fill={`url(#tile-${label})`} />
            <path d={linePath(pts)} fill="none" stroke={DEEMPHASIS_INK} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={4} fill={accent} stroke={SURFACE} strokeWidth={2} />
          </svg>
        )}
      </div>
    </div>
  );
}
