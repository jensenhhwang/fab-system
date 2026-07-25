"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import InboundModal from "../wms/InboundModal";
import {
  HOUR_END,
  HOUR_START,
  type InboundTodaySummary,
  type RaceRow,
  type RaceRowStatus,
} from "@/lib/inbound-today";

type MatDoc = { _id: string; name: string; code: string; unit: string };
type WhDoc = { _id: string; name: string; code: string };

const nf = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });

const STATUS_STYLE: Record<RaceRowStatus, { label: string; color: string; bg: string }> = {
  COMPLETED: { label: "완료", color: "#00875A", bg: "#E6FAF1" },
  DELAYED: { label: "지연", color: "#EA002C", bg: "#FFF0F2" },
  IN_PROGRESS: { label: "진행중", color: "#141413", bg: "#F1F1F0" },
  GHOST: { label: "대기", color: "#999999", bg: "transparent" },
};

type TabKey = "ALL" | "PROGRESS" | "DONE" | "DELAYED";
const TABS: { key: TabKey; label: string }[] = [
  { key: "ALL", label: "전체" },
  { key: "PROGRESS", label: "진행중" },
  { key: "DONE", label: "완료" },
  { key: "DELAYED", label: "지연" },
];

function matchTab(row: RaceRow, tab: TabKey): boolean {
  if (tab === "ALL") return true;
  if (tab === "DONE") return row.status === "COMPLETED";
  if (tab === "DELAYED") return row.status === "DELAYED";
  return row.status === "IN_PROGRESS" || row.status === "GHOST"; // PROGRESS
}

function relativeTime(iso: string | null, now: Date): string {
  if (!iso) return "—";
  const diffMs = now.getTime() - new Date(iso).getTime();
  const min = Math.max(0, Math.round(diffMs / 60000));
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  return `${hr}시간 ${min % 60}분 전`;
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function Sparkline({ buckets, nowHour }: { buckets: { hour: number; count: number }[]; nowHour: number }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const W = 220;
  const H = 56;
  const gap = 3;
  const barW = (W - gap * (buckets.length - 1)) / buckets.length;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 14}`} preserveAspectRatio="none" role="img" aria-label="시간대별 입고 건수">
      {buckets.map((b, i) => {
        const x = i * (barW + gap);
        const h = b.count === 0 ? 1.5 : (b.count / max) * H;
        const isNow = b.hour === nowHour;
        return (
          <g key={b.hour}>
            <rect x={x} y={H - h} width={barW} height={h} rx={1.5} fill={b.count === 0 ? "#E7E5E4" : "#141413"}>
              <title>{`${b.hour}시 ${b.count}건`}</title>
            </rect>
            {isNow && <rect x={x - 0.5} y={0} width={Math.max(barW + 1, 2)} height={H} fill="#EA002C" opacity={0.1} />}
            {(b.hour % 3 === 0) && (
              <text x={x + barW / 2} y={H + 11} textAnchor="middle" fontSize={7} fill="#999">
                {b.hour}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function InboundTodayClient({ matMap, whMap }: { matMap: Record<string, MatDoc>; whMap: Record<string, WhDoc> }) {
  const [summary, setSummary] = useState<InboundTodaySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("ALL");
  const [pulse, setPulse] = useState(false);
  const [showInbound, setShowInbound] = useState(false);
  const prevCount = useRef<number | null>(null);
  const now = summary ? new Date(summary.generatedAt) : new Date();

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/inbound-today/summary", { cache: "no-store", signal });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 403) throw new Error("오늘 입고 실적은 자재관리·물류·관리자 권한 계정에서만 볼 수 있어요.");
        if (res.status === 401) throw new Error("세션이 만료되었습니다. 다시 로그인해 주세요.");
        throw new Error(payload.error ?? "오늘 입고 실적을 불러오지 못했습니다.");
      }
      const next = payload as InboundTodaySummary;
      if (prevCount.current !== null && next.totalReceiptCount > prevCount.current) {
        setPulse(true);
        setTimeout(() => setPulse(false), 1300);
      }
      prevCount.current = next.totalReceiptCount;
      setSummary(next);
      setError(null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "오늘 입고 실적을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const run = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        await load(controller.signal);
      } finally {
        running = false;
      }
    };
    void run();
    const interval = window.setInterval(() => void run(), 60_000);
    const onVisibility = () => { if (!document.hidden) void run(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const rows = summary?.raceRows ?? [];
  const filtered = rows.filter((r) => matchTab(r, tab));
  const isEmpty = summary && summary.totalReceiptCount === 0 && rows.length === 0;

  return (
    <div className="space-y-4">
      <style>{`@keyframes inbound-pulse-ring{0%{box-shadow:0 0 0 0 rgba(234,0,44,.45)}100%{box-shadow:0 0 0 16px rgba(234,0,44,0)}}`}</style>

      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-[#141413]">오늘의 입고 실적</h1>
          <p className="mt-1 text-sm text-[#888]">
            {now.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" })} · 실입고(RECEIPT)와 오늘 입고계획을 함께 봅니다.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-[#00875A]">
            <span className="h-2 w-2 rounded-full bg-[#00875A]" style={{ animation: "inbound-pulse-ring 2s infinite" }} />
            LIVE · 60초 자동갱신
          </span>
          <button
            onClick={() => setShowInbound(true)}
            className="rounded-xl bg-[#EA002C] px-4 py-2 text-xs font-bold text-white hover:opacity-90"
          >
            + 입고 등록
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      {loading && !summary && <div className="rounded-2xl border bg-white p-8 text-center text-sm text-[#999]" style={{ borderColor: "var(--border)" }}>오늘 입고 실적을 불러오는 중…</div>}

      {summary && (
        <>
          {/* 히어로 펄스 스트립 */}
          <div className="grid gap-4 rounded-2xl border bg-white p-5 md:grid-cols-[1fr_1fr_1fr_1.4fr]" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
            {/* ① 오늘 입고 건수 */}
            <div className="flex flex-col justify-center">
              <div className="text-[11px] font-bold tracking-[0.04em] text-[#777]">오늘 입고</div>
              <div
                className="mt-1 w-fit rounded-2xl text-5xl font-black tracking-tight text-[#141413]"
                style={pulse ? { animation: "inbound-pulse-ring 1.3s ease-out" } : undefined}
              >
                {nf.format(summary.totalReceiptCount)}<span className="ml-1 text-lg font-bold text-[#999]">건</span>
              </div>
              <div className="mt-1 text-[11px] text-[#888]">마지막 입고 {relativeTime(summary.lastReceiptAt, now)}</div>
            </div>

            {/* ② 카테고리별 총량 (합산 금지) */}
            <div className="border-t pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0" style={{ borderColor: "var(--border)" }}>
              <div className="text-[11px] font-bold tracking-[0.04em] text-[#777]">카테고리별 입고량</div>
              <div className="mt-2 space-y-1">
                {summary.categoryTotals.length === 0 && <div className="text-xs text-[#bbb]">—</div>}
                {summary.categoryTotals.map((c) => (
                  <div key={c.category} className="flex items-center gap-2 text-sm">
                    <span className="h-3 w-1 rounded-full" style={{ background: c.color }} />
                    <span className="w-9 text-[11px] font-bold text-[#555]">{c.category}</span>
                    <span className="font-bold text-[#141413]">
                      {c.totalsByUnit.map((u) => `${nf.format(u.quantity)} ${u.unit}`).join(" · ")}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 text-[10px] text-[#aaa]">단위가 달라 합산하지 않습니다</div>
            </div>

            {/* ③ 계획 달성률 (건수 기반) */}
            <div className="border-t pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold tracking-[0.04em] text-[#777]">계획 달성률</span>
                {summary.achievement.delayedCount > 0 && (
                  <span className="rounded-full bg-[#FFF0F2] px-2 py-0.5 text-[10px] font-extrabold text-[#EA002C]">⚠ 지연 {summary.achievement.delayedCount}</span>
                )}
              </div>
              <div className="mt-1 text-3xl font-black text-[#141413]">
                {summary.achievement.completedCount}<span className="text-lg text-[#999]"> / {summary.achievement.plannedCount} 건</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#F0EFED]">
                <div className="h-full rounded-full" style={{ width: `${summary.achievement.pct}%`, background: summary.achievement.pct >= 100 ? "#00875A" : "#141413" }} />
              </div>
              <div className="mt-1 text-[10px] text-[#aaa]">오늘 도착예정 계획 중 완료 비율</div>
            </div>

            {/* ④ 시간대별 스파크라인 */}
            <div className="border-t pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0" style={{ borderColor: "var(--border)" }}>
              <div className="text-[11px] font-bold tracking-[0.04em] text-[#777]">시간대별 입고 ({HOUR_START}–{HOUR_END}시)</div>
              <div className="mt-2">
                <Sparkline buckets={summary.hourBuckets} nowHour={now.getHours()} />
              </div>
            </div>
          </div>

          {/* 빈 상태 */}
          {isEmpty && (
            <div className="rounded-2xl border bg-white p-10 text-center" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
              <div className="mx-auto mb-3 h-px w-40 bg-[#E7E5E4]" />
              <div className="text-sm font-bold text-[#666]">오늘 도착 예정 입고가 없습니다</div>
              <div className="mt-1 text-xs text-[#aaa]">입고계획은 계획·실행 브리지에서 등록할 수 있어요.</div>
            </div>
          )}

          {/* 레이스 트랙 */}
          {!isEmpty && (
            <div className="overflow-hidden rounded-2xl border bg-white" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
                <span className="text-sm font-bold text-[#333]">계획 vs 실입고</span>
                <div className="flex gap-1">
                  {TABS.map((t) => {
                    const count = t.key === "ALL" ? rows.length : rows.filter((r) => matchTab(r, t.key)).length;
                    const active = tab === t.key;
                    return (
                      <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className="rounded-full px-3 py-1 text-[11px] font-bold"
                        style={active ? { background: "#141413", color: "#fff" } : { background: "#F1F1F0", color: "#777" }}
                      >
                        {t.label} {count > 0 && <span className="opacity-70">{count}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                {filtered.length === 0 && <div className="px-5 py-8 text-center text-sm text-[#999]">해당 상태의 계획이 없습니다.</div>}
                {filtered.map((r) => {
                  const st = STATUS_STYLE[r.status];
                  const ghost = r.status === "GHOST";
                  return (
                    <div key={r.planId} className="flex items-center gap-3 px-5 py-3" style={ghost ? { opacity: 0.65 } : r.status === "DELAYED" ? { background: "#FFF7F8" } : undefined}>
                      <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: r.categoryColor }} title={r.category} />
                      <div className="w-20 shrink-0">
                        <div className="text-[10px] font-bold text-[#999]">{r.planNo}</div>
                        <div className="text-[10px] text-[#bbb]">{r.category}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-[#141413]">{r.materialName}</div>
                        <div className="text-[10px] text-[#999]">{r.materialCode}</div>
                      </div>
                      <div className="w-16 shrink-0 text-center text-[11px]" style={{ color: r.status === "DELAYED" ? "#EA002C" : "#888" }}>
                        예정<br />{r.plannedDate.slice(5)}
                      </div>
                      <div className="hidden w-40 shrink-0 sm:block">
                        <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: ghost ? "transparent" : "#F0EFED", border: ghost ? "1px dashed #ccc" : "none" }}>
                          <div className="h-full rounded-full" style={{ width: `${r.progressPct}%`, background: st.color === "#999999" ? "#ccc" : st.color }} />
                        </div>
                        <div className="mt-1 text-right text-[10px] text-[#999]">{nf.format(r.receivedQuantity)} / {nf.format(r.plannedQuantity)} {r.unit}</div>
                      </div>
                      <span className="w-14 shrink-0 rounded-full px-2 py-1 text-center text-[10px] font-extrabold" style={{ background: st.bg, color: st.color, border: ghost ? "1px solid #E7E5E4" : "none" }}>
                        {st.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* 계획 외(애드혹) 입고 레인 */}
              {summary.adhocRows.length > 0 && (
                <div className="border-t" style={{ borderColor: "var(--border)" }}>
                  <div className="bg-[#F8F9FB] px-5 py-2 text-[11px] font-bold text-[#0078D4]">계획 외 입고 (Ad-hoc) · {summary.adhocRows.length}건</div>
                  <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                    {summary.adhocRows.map((a, i) => (
                      <div key={`${a.materialCode}-${i}`} className="flex items-center gap-3 px-5 py-2.5">
                        <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: a.categoryColor }} title={a.category} />
                        <div className="w-20 shrink-0 text-[11px] font-bold text-[#555]">{hhmm(a.receivedAt)}</div>
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-bold text-[#141413]">{a.materialName}</span>
                          <span className="ml-2 text-[10px] text-[#999]">{a.materialCode}</span>
                        </div>
                        <div className="shrink-0 text-sm font-bold text-[#00B96B]">+{nf.format(a.quantity)} {a.unit}</div>
                        <span className="w-14 shrink-0 rounded-full bg-[#EAF4FF] px-2 py-1 text-center text-[10px] font-extrabold text-[#0078D4]">계획외</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {showInbound && (
        <InboundModal
          matMap={matMap}
          whMap={whMap}
          onClose={() => setShowInbound(false)}
          onSuccess={() => { setShowInbound(false); void load(); }}
        />
      )}
    </div>
  );
}
