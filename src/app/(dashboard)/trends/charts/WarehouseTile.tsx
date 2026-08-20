"use client";

import { useId } from "react";
import Link from "next/link";
import { linearScale, niceDomain, linePath } from "../chart-scale";
import { DEEMPHASIS_INK, PRIMARY_INK, SURFACE } from "./palette";

/**
 * 창고 한 칸 — 미터(현재 점유율) + 임계 눈금, 표본이 쌓이면 추이선을 덧붙인다.
 *
 * 창고가 8개라 categorical 색 한계를 넘으므로 색으로 계열을 구분하지 않고 칸으로 나눈다
 * (small multiples). 여기서 색은 계열 식별이 아니라 **상태**다 — 어느 임계를 넘었는가.
 *
 * 점유율은 0~100% 고정 스케일이라 미터가 맞는 형태다. 점 하나짜리 스파크라인은 임계선만
 * 떠 있어 장식처럼 읽혔다(dataviz: 값이 하나면 숫자와 미터가 곧 차트).
 */
export default function WarehouseTile({
  values,
  label,
  href,
  thresholds = [],
}: {
  values: number[];
  label: string;
  /** 창고 상세로 내려가는 경로 — 트렌드가 막다른 길이 되지 않게 한다(점진적 공개). */
  href?: string;
  thresholds?: { value: number; color: string; label: string }[];
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const last = values.length ? values[values.length - 1] : null;
  const breached = last == null ? null : [...thresholds].sort((a, b) => b.value - a.value).find((t) => last >= t.value);
  const accent = breached?.color ?? "#0E9B8A";
  const trackMax = 100;

  const W = 200;
  const H = 30;
  const PAD = 3;
  const domain = niceDomain(values, { includeZero: true });
  const y = linearScale(domain, [H - PAD, PAD]);
  const x = values.length <= 1 ? () => W / 2 : linearScale([0, values.length - 1], [PAD, W - PAD]);
  const pts = values.map((v, i) => ({ x: x(i), y: y(v) }));

  const cls = `block rounded-xl border border-[#EDEAE7] bg-white px-3 py-2.5${href ? " transition-colors hover:border-[#C9C4BE]" : ""}`;
  const body = (
    <>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-bold text-[#4A453F]">{label}</span>
        <span className="text-[16px] font-extrabold leading-none" style={{ color: breached ? accent : PRIMARY_INK }}>
          {last != null ? `${Math.round(last)}%` : "—"}
        </span>
      </div>

      {/* 미터 — 채움이 심각도를 나르고, 빈 트랙은 같은 램프의 옅은 단계다 */}
      <div className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#F0EDEA]">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(Math.max(last ?? 0, 0), trackMax)}%`, backgroundColor: accent }}
        />
        {thresholds.map((t) => (
          <span
            key={t.label}
            className="absolute top-0 h-full w-px"
            style={{ left: `${t.value}%`, backgroundColor: t.color, opacity: 0.55 }}
          />
        ))}
      </div>

      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[9px] font-bold" style={{ color: breached ? accent : "#B5B0AA" }}>
          {breached ? `${breached.label} 초과` : "정상"}
        </span>
        {values.length > 1 && (
          <svg viewBox={`0 0 ${W} ${H}`} width={92} height={16} aria-hidden="true">
            <defs>
              <linearGradient id={`wh${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={0.18} />
                <stop offset="100%" stopColor={accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={`${linePath(pts)} L ${pts[pts.length - 1].x} ${H} L ${pts[0].x} ${H} Z`} fill={`url(#wh${uid})`} />
            <path d={linePath(pts)} fill="none" stroke={DEEMPHASIS_INK} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={4} fill={accent} stroke={SURFACE} strokeWidth={2} />
          </svg>
        )}
      </div>
    </>
  );

  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}
