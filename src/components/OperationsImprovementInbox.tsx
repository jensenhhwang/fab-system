"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OperationMonitorView } from "@/lib/operations-monitor";

const ROLE_NAME = {
  PROCUREMENT: "김구매",
  MATERIALS: "이자재",
  PRODUCTION: "최생산",
  LOGISTICS: "박물류",
} as const;

function time(value: string | null): string {
  return value ? new Date(value).toLocaleString("ko-KR") : "—";
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export default function OperationsImprovementInbox() {
  const [view, setView] = useState<OperationMonitorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (document.hidden || loading.current) return;
    loading.current = true;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    try {
      const response = await fetch("/api/twin/operations-monitor", {
        cache: "no-store",
        signal: next.signal,
      });
      if (!response.ok) throw new Error(`운영 모니터 조회 실패 (${response.status})`);
      setView(await response.json() as OperationMonitorView);
      setError(null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "운영 모니터를 조회하지 못했습니다.");
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 10_000);
    const onVisibility = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      controller.current?.abort();
    };
  }, [load]);

  const decide = useCallback(async (proposalId: string, decision: "APPROVE" | "REJECT") => {
    const reason = window.prompt(decision === "APPROVE" ? "승인 사유를 입력해 주세요." : "반려 사유를 입력해 주세요.");
    if (!reason?.trim()) return;
    if (decision === "APPROVE" && !window.confirm("이 개선안을 승인하고, 허용된 운영 조치라면 즉시 한 번 실행할까요?")) return;
    setDeciding(proposalId);
    try {
      const response = await fetch(`/api/twin/operations-monitor/proposals/${proposalId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason: reason.trim(), requestId: crypto.randomUUID() }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `결정 처리 실패 (${response.status})`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "결정을 처리하지 못했습니다.");
    } finally {
      setDeciding(null);
    }
  }, [load]);

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border bg-white" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-sm font-black text-[#141413]">운영 개선함</h2>
          <p className="mt-0.5 text-[11px] text-[#888]">이상은 자동 관측하지만 변경은 관리자 승인 뒤에만 적용합니다.</p>
        </div>
        <div className="text-right text-[10px] text-[#888]">
          <div>{view?.monitor?.lastSuccessAt ? `마지막 정상 점검 ${time(view.monitor.lastSuccessAt)}` : "점검 상태 확인 중"}</div>
          <div className="mt-0.5 font-bold text-[#00875A]">실제 60초 점검 · 화면 10초 갱신</div>
        </div>
      </div>

      {error && <div className="border-b border-[#FDA29B] bg-[#FFF5F4] px-5 py-3 text-xs text-[#B42318]">{error}</div>}
      {!view && !error && <div className="px-5 py-8 text-center text-xs text-[#888]">운영 원장을 불러오는 중입니다.</div>}

      {view && (
        <div className="grid gap-0 xl:grid-cols-3">
          <div className="border-b p-4 xl:border-b-0 xl:border-r" style={{ borderColor: "var(--border)" }}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-black text-[#141413]">현재 이상</h3>
              <span className="rounded-full bg-[#FFF1F3] px-2 py-0.5 text-[10px] font-black text-[#C01048]">{view.incidents.length}건</span>
            </div>
            <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
              {view.incidents.length === 0 && <p className="rounded-xl bg-[#E6FAF1] p-3 text-xs text-[#00875A]">연속 관측 중인 이상이 없습니다.</p>}
              {view.incidents.map((incident) => (
                <article key={incident.id} className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${incident.severity === "CRITICAL" ? "bg-[#FFF1F3] text-[#C01048]" : "bg-[#FFFAEB] text-[#B54708]"}`}>{incident.severity}</span>
                    <span className="text-[9px] text-[#999]">{incident.observationCount}회 관측</span>
                  </div>
                  <p className="mt-2 text-xs font-bold leading-5 text-[#141413]">{incident.summary}</p>
                  <p className="mt-1 text-[10px] text-[#888]">{incident.affectedRoles.map((role) => ROLE_NAME[role]).join(" · ")}</p>
                  <p className="mt-2 text-[10px] leading-4 text-[#667085]">회복: {incident.releaseCondition}</p>
                  <p className="mt-2 text-[9px] text-[#aaa]">{time(incident.firstObservedAt)} → {time(incident.lastObservedAt)}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="border-b p-4 xl:border-b-0 xl:border-r" style={{ borderColor: "var(--border)" }}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-black text-[#141413]">승인 요청</h3>
              <span className="rounded-full bg-[#EEF4FF] px-2 py-0.5 text-[10px] font-black text-[#3538CD]">{view.proposals.filter((item) => item.status === "PROPOSED").length}건 대기</span>
            </div>
            <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
              {view.proposals.length === 0 && <p className="rounded-xl bg-[#F5F5F4] p-3 text-xs text-[#888]">승인할 개선안이 없습니다.</p>}
              {view.proposals.map((proposal) => (
                <article key={proposal.id} className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black text-[#3538CD]">{ROLE_NAME[proposal.proposedByRole]} 제안</span>
                    <span className="rounded bg-[#F5F5F4] px-1.5 py-0.5 text-[9px] font-bold text-[#667085]">{proposal.status}</span>
                  </div>
                  <p className="mt-2 text-xs font-bold text-[#141413]">{proposal.change.actionType}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[9px]">
                    <pre className="overflow-auto rounded-lg bg-[#FFF5F4] p-2 text-[#B42318]">{json(proposal.change.before)}</pre>
                    <pre className="overflow-auto rounded-lg bg-[#F0F9F4] p-2 text-[#027A48]">{json(proposal.change.after)}</pre>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-[#027A48]">효과: {proposal.expectedEffects.join(" ")}</p>
                  <p className="mt-1 text-[10px] leading-4 text-[#B54708]">위험: {proposal.risks.join(" ")}</p>
                  <details className="mt-2 text-[10px] text-[#667085]">
                    <summary className="cursor-pointer font-bold">검증·되돌리기 계획</summary>
                    <div className="mt-1">{proposal.validationPlan.join(" ")}</div>
                    <div className="mt-1">{proposal.rollbackPlan.join(" ")}</div>
                  </details>
                  {view.canDecide && proposal.status === "PROPOSED" && (
                    <div className="mt-3 flex gap-2">
                      <button type="button" disabled={deciding === proposal.id} onClick={() => void decide(proposal.id, "APPROVE")} className="flex-1 rounded-lg bg-[#141413] px-3 py-2 text-[10px] font-black text-white disabled:opacity-50">승인</button>
                      <button type="button" disabled={deciding === proposal.id} onClick={() => void decide(proposal.id, "REJECT")} className="flex-1 rounded-lg border px-3 py-2 text-[10px] font-black text-[#667085] disabled:opacity-50" style={{ borderColor: "var(--border)" }}>반려</button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>

          <div className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-black text-[#141413]">적용 결과</h3>
              <span className="text-[10px] text-[#888]">최근 {view.revisions.length}건</span>
            </div>
            <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
              {view.revisions.length === 0 && <p className="rounded-xl bg-[#F5F5F4] p-3 text-xs text-[#888]">아직 결정 이력이 없습니다.</p>}
              {view.revisions.map((revision) => (
                <article key={revision.id} className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] font-black ${revision.decision === "APPROVED" ? "text-[#00875A]" : "text-[#C01048]"}`}>{revision.decision}</span>
                    <span className="text-[9px] text-[#999]">{time(revision.decidedAt)}</span>
                  </div>
                  <p className="mt-2 text-xs text-[#141413]">{revision.reason}</p>
                  {revision.applyResult && <pre className="mt-2 overflow-auto rounded-lg bg-[#F5F5F4] p-2 text-[9px] text-[#667085]">{json(revision.applyResult)}</pre>}
                  <p className="mt-2 text-[9px] text-[#aaa]">정책 {revision.previousVersion}{revision.newVersion ? ` → ${revision.newVersion}` : ""}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
