"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { WhatIfCopilotActionStatus } from "@/lib/db";
import type { ProductionPlanInput } from "@/lib/scenario-engine";
import type {
  WhatIfActionCard,
  WhatIfCopilotResponse,
  WhatIfFab,
} from "@/lib/what-if-copilot";

const SEVERITY_STYLE = {
  URGENT: {
    label: "긴급",
    border: "border-red-200",
    badge: "bg-red-50 text-red-700",
    accent: "bg-[#EA002C]",
  },
  WARNING: {
    label: "주의",
    border: "border-amber-200",
    badge: "bg-amber-50 text-amber-700",
    accent: "bg-amber-500",
  },
  INFO: {
    label: "확인",
    border: "border-blue-200",
    badge: "bg-blue-50 text-blue-700",
    accent: "bg-blue-500",
  },
} as const;

function formatQty(value: number) {
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function dueLabel(snapshotAt: string, day: number | null) {
  if (day === null) return "오늘 확인";
  if (day < 0) return `${Math.abs(day)}일 지남`;
  if (day === 0) return "오늘";
  const date = new Date(snapshotAt);
  date.setDate(date.getDate() + day);
  return `${date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} · D+${day}`;
}

function accessMessage(status: number): string | null {
  if (status === 403) return "운영 What-if 행동 제안은 자재관리·관리자 권한 계정에서만 볼 수 있어요.";
  if (status === 401) return "세션이 만료되었습니다. 다시 로그인해 주세요.";
  return null;
}

function statusLabel(status: WhatIfCopilotActionStatus) {
  if (status === "ACKNOWLEDGED") return "확인됨";
  if (status === "SNOOZED") return "내일까지 보류";
  if (status === "DISMISSED") return "무시됨";
  return "새 제안";
}

function sourceLabel(response: WhatIfCopilotResponse) {
  if (response.source === "AI" && response.usage) {
    return `AI 새 판단 · ${response.usage.totalTokens.toLocaleString()} 토큰`;
  }
  if (response.source === "CACHE" && response.usage) {
    return `AI 판단 재사용 · 추가 토큰 없음`;
  }
  if (response.refreshing) return "AI 판단 갱신 중 · 안전 규칙 표시";
  return "안전 규칙 판단 · AI 토큰 미사용";
}

function ActionCard({
  card,
  snapshotAt,
  expanded,
  busy,
  onToggle,
  onStatus,
}: {
  card: WhatIfActionCard;
  snapshotAt: string;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onStatus: (status: WhatIfCopilotActionStatus) => void;
}) {
  const style = SEVERITY_STYLE[card.candidate.severity];
  return (
    <article data-testid="what-if-action-card" className={`relative overflow-hidden rounded-2xl border bg-white ${style.border}`}>
      <div className={`absolute inset-y-0 left-0 w-1 ${style.accent}`} />
      <div className="p-4 pl-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-1 text-[10px] font-extrabold ${style.badge}`}>{style.label}</span>
          <span className="text-[10px] font-bold text-[#777]">{statusLabel(card.status)}</span>
          <span className="ml-auto text-[10px] font-bold text-[#555]">기한 {dueLabel(snapshotAt, card.candidate.dueDay)}</span>
        </div>
        <h3 className="mt-3 text-sm font-extrabold text-[#171716]">{card.narrative.title}</h3>
        <p className="mt-1.5 text-xs leading-5 text-[#555]">{card.narrative.why}</p>
        <div className="mt-3 rounded-xl bg-[#F7F5F3] px-3 py-2.5">
          <div className="text-[9px] font-extrabold uppercase tracking-[.08em] text-[#888]">지금 할 일</div>
          <div className="mt-1 text-xs font-extrabold text-[#171716]">{card.narrative.action}</div>
        </div>
        <div className="mt-2 text-[10px] leading-4 text-red-700">
          미조치 영향 · {card.narrative.inactionImpact}
        </div>

        <button type="button" onClick={onToggle} className="mt-3 text-[10px] font-bold text-blue-700">
          {expanded ? "근거 접기 ↑" : "계산 근거 보기 ↓"}
        </button>
        {expanded && (
          <div className="mt-2 rounded-xl border border-[#EEEAE6] bg-[#FCFBFA] p-3 text-[10px]">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <div><span className="text-[#888]">자재</span><b className="ml-1">{card.candidate.material.name}</b></div>
              <div><span className="text-[#888]">코드</span><b className="ml-1 font-mono">{card.candidate.material.code}</b></div>
              <div><span className="text-[#888]">가용재고</span><b className="ml-1">{formatQty(card.candidate.availableQuantity)} {card.candidate.material.unit}</b></div>
              <div><span className="text-[#888]">확정입고</span><b className="ml-1">{formatQty(card.candidate.confirmedInbound)} {card.candidate.material.unit}</b></div>
              <div><span className="text-[#888]">권장 대응량</span><b className="ml-1">{formatQty(card.candidate.recommendedQuantity)} {card.candidate.material.unit}</b></div>
              <div><span className="text-[#888]">첫 필요</span><b className="ml-1">{dueLabel(snapshotAt, card.candidate.needByDay)}</b></div>
            </div>
            <div className="mt-2 border-t pt-2 text-[#777]">
              근거 {card.candidate.evidence.formulaVersion} · {card.candidate.evidence.usageSource}
              {card.candidate.evidence.usageSourceVersion ? ` · ${card.candidate.evidence.usageSourceVersion}` : ""}
              {" · "}신뢰도 {card.candidate.evidence.usageConfidence}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {card.status !== "ACKNOWLEDGED" ? (
            <button type="button" disabled={busy} onClick={() => onStatus("ACKNOWLEDGED")} className="rounded-lg bg-[#171716] px-3 py-2 text-[10px] font-bold text-white disabled:opacity-40">확인</button>
          ) : (
            <button type="button" disabled={busy} onClick={() => onStatus("NEW")} className="rounded-lg border px-3 py-2 text-[10px] font-bold text-[#555] disabled:opacity-40">확인 취소</button>
          )}
          <button type="button" disabled={busy} onClick={() => onStatus("SNOOZED")} className="rounded-lg border px-3 py-2 text-[10px] font-bold text-amber-700 disabled:opacity-40">내일까지 보류</button>
          <button type="button" disabled={busy} onClick={() => onStatus("DISMISSED")} className="rounded-lg border px-3 py-2 text-[10px] font-bold text-[#777] disabled:opacity-40">이번 제안 무시</button>
        </div>
      </div>
    </article>
  );
}

export default function WhatIfActionCopilot({
  fabId,
  input,
}: {
  fabId: WhatIfFab | null;
  input: ProductionPlanInput;
}) {
  const requestBody = useMemo(() => ({ fabId, input }), [fabId, input]);
  const requestKey = useMemo(() => JSON.stringify(requestBody), [requestBody]);
  const [response, setResponse] = useState<WhatIfCopilotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyCandidate, setBusyCandidate] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal, silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const result = await fetch("/api/what-if-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestKey,
        cache: "no-store",
        signal,
      });
      const payload = await result.json().catch(() => ({}));
      if (!result.ok) throw new Error(accessMessage(result.status) ?? payload.error ?? "운영 코파일럿 분석 실패");
      setResponse(payload as WhatIfCopilotResponse);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "운영 코파일럿 분석 실패");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [requestKey]);

  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const run = async (silent: boolean) => {
      if (running || document.hidden) return;
      running = true;
      try {
        await load(controller.signal, silent);
      } finally {
        running = false;
      }
    };
    void run(false);
    const interval = window.setInterval(() => void run(true), 45_000);
    const onVisibility = () => {
      if (!document.hidden) void run(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  async function updateStatus(card: WhatIfActionCard, status: WhatIfCopilotActionStatus) {
    if (!response) return;
    setBusyCandidate(card.candidate.id);
    setError(null);
    try {
      const result = await fetch("/api/what-if-copilot", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scopeHash: response.scopeHash,
          candidateId: card.candidate.id,
          status,
        }),
      });
      const payload = await result.json().catch(() => ({}));
      if (!result.ok) throw new Error(accessMessage(result.status) ?? payload.error ?? "상태 저장 실패");
      setResponse((current) => {
        if (!current) return current;
        if (status === "SNOOZED" || status === "DISMISSED") {
          return { ...current, cards: current.cards.filter((item) => item.candidate.id !== card.candidate.id) };
        }
        return {
          ...current,
          cards: current.cards.map((item) => item.candidate.id === card.candidate.id
            ? { ...item, status, snoozedUntil: payload.snoozedUntil ?? null }
            : item),
        };
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "상태 저장 실패");
    } finally {
      setBusyCandidate(null);
    }
  }

  return (
    <section data-testid="what-if-action-copilot" className="overflow-hidden rounded-3xl border border-[#D9D5D1] bg-[#F7F5F3] shadow-[var(--shadow-1)]">
      <div className="flex flex-col gap-3 border-b border-[#E5E0DC] bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-gradient-to-r from-[#EA002C] to-[#F47725] px-2.5 py-1 text-[10px] font-extrabold tracking-[.08em] text-white">AI LIVE</span>
            <h2 className="text-sm font-extrabold text-[#171716]">지금 할 일</h2>
          </div>
          <p className="mt-1 text-[11px] text-[#777]">실시간 Fab 상태와 현재 What-if를 함께 읽어 자재 담당자의 다음 행동을 정리합니다.</p>
        </div>
        <div className="flex items-center gap-3">
          {response && <div className="text-right text-[9px] leading-4 text-[#888]"><div>{sourceLabel(response)}</div><div>{new Date(response.generatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} 갱신</div></div>}
          <button type="button" disabled={loading || refreshing} onClick={() => void load(undefined, true)} className="rounded-xl border bg-white px-3 py-2 text-[10px] font-bold text-[#555] disabled:opacity-40">{refreshing ? "확인 중…" : "지금 새로 확인"}</button>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {loading && !response && (
          <div className="grid gap-3 lg:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-52 animate-pulse rounded-2xl border bg-white" />)}</div>
        )}
        {error && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
        {response && response.cards.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-3">
            {response.cards.map((card) => (
              <ActionCard
                key={card.candidate.id}
                card={card}
                snapshotAt={response.snapshotAt}
                expanded={expanded.has(card.candidate.id)}
                busy={busyCandidate === card.candidate.id}
                onToggle={() => setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(card.candidate.id)) next.delete(card.candidate.id);
                  else next.add(card.candidate.id);
                  return next;
                })}
                onStatus={(status) => void updateStatus(card, status)}
              />
            ))}
          </div>
        )}
        {response && response.cards.length === 0 && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-10 text-center">
            <div className="text-sm font-extrabold text-emerald-800">
              {response.candidateCount === 0 ? "지금 즉시 처리할 자재 행동이 없습니다." : "현재 제안은 모두 확인하거나 보류했습니다."}
            </div>
            <div className="mt-1 text-[11px] text-emerald-700">상태나 What-if 조건이 달라지면 다시 알려드릴게요.</div>
          </div>
        )}
      </div>
    </section>
  );
}
