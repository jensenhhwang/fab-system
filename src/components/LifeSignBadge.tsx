"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { BlockReason, LifeSignLevel } from "@/lib/twin/tick-diagnosis";

// 전역 생명신호 배지 — 예전엔 헤더에 "DATA CONNECTED"가 하드코딩돼 있어서, 팹이 며칠째
// 아무것도 못 만들고 있어도 초록불이 계속 뛰고 있었다(실관측: 08-09 10:01 이후 자재 소모 0건).
// 이제 tick이 도는지가 아니라 산출이 나오는지를 보여준다. 펄스는 살아있을 때만 켠다.

type Health = {
  lifeSign: { level: LifeSignLevel; minutesSinceOutput: number | null };
  fulfillment: number | null;
  topBlockReason: BlockReason | null;
};

const STYLE: Record<LifeSignLevel, { bg: string; fg: string; dot: string; label: string; pulse: boolean }> = {
  ALIVE:    { bg: "#E6FAF1", fg: "#00875A", dot: "#00B96B", label: "산출 중",   pulse: true },
  DEGRADED: { bg: "#FFF4E5", fg: "#B25E02", dot: "#F7A600", label: "산출 지연", pulse: false },
  STOPPED:  { bg: "#FFF1F3", fg: "#C01048", dot: "#E11D48", label: "산출 정지", pulse: false },
};

function elapsedText(minutes: number | null): string {
  if (minutes == null) return "산출 이력 없음";
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분째`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}시간 ${m}분째` : `${h}시간째`;
}

export default function LifeSignBadge({ variant = "badge" }: { variant?: "badge" | "bar" }) {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/twin/tick-health", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Health;
        if (alive) setHealth(data);
      } catch {
        // 네트워크 실패는 조용히 넘긴다 — 다음 폴링에서 회복된다.
      }
    };
    void load();
    const timer = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  // 첫 응답 전에는 중립 상태로 둔다 — 모르면서 초록불을 켜는 것이 이 배지가 고치려는 문제다.
  if (!health) {
    if (variant === "bar") {
      return <span style={{ color: "var(--text-3)" }}>● 상태 확인 중</span>;
    }
    return (
      <div className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
           style={{ backgroundColor: "var(--bg-page)", color: "var(--text-3)" }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--text-3)" }} />
        상태 확인 중
      </div>
    );
  }

  const s = STYLE[health.lifeSign.level];
  const stopped = health.lifeSign.level !== "ALIVE";
  const cause = stopped && health.topBlockReason ? health.topBlockReason.impactLabel : null;

  if (variant === "bar") {
    return (
      <span style={{ color: s.fg }} className="font-semibold" title={cause ?? undefined}>
        ● {s.label} · {elapsedText(health.lifeSign.minutesSinceOutput)}
      </span>
    );
  }

  const badge = (
    <div
      className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
      style={{ backgroundColor: s.bg, color: s.fg }}
      title={cause ?? undefined}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${s.pulse ? "animate-pulse" : ""}`}
        style={{ backgroundColor: s.dot }}
      />
      {s.label}
      <span className="font-normal opacity-80">· {elapsedText(health.lifeSign.minutesSinceOutput)}</span>
      {health.fulfillment != null && health.fulfillment < 1 && (
        <span className="font-normal opacity-80">· 충족 {Math.round(health.fulfillment * 100)}%</span>
      )}
    </div>
  );

  // 멈춰 있으면 원인을 볼 수 있는 곳으로 바로 갈 수 있어야 한다.
  return stopped ? <Link href="/" className="hover:opacity-80 transition-opacity">{badge}</Link> : badge;
}
