"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CONTROL_TOWER_ASK_MAX_QUESTION_CHARS,
  CONTROL_TOWER_ASK_ROLE_META,
  type ControlTowerAskHistory,
  type ControlTowerAskMessageView,
  type ControlTowerAskThreadSummary,
} from "@/lib/control-tower-ask";
import {
  CONTROL_TOWER_ROLE_ORDER,
  type ControlTowerRole,
} from "@/lib/control-tower-live";
import ControlTowerActionButton from "./ControlTowerActionButton";

const EMPTY_HISTORY: ControlTowerAskHistory = {
  thread: null,
  messages: [],
  recentThreads: [],
};

async function fetchHistory(threadId?: string) {
  const query = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
  const response = await fetch(`/api/twin/control-tower/ask${query}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "대화 기록을 불러오지 못했습니다.");
  return payload as ControlTowerAskHistory;
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AnswerBubble({
  message,
  canCreateInboundPlan,
  onActionCompleted,
}: {
  message: ControlTowerAskMessageView;
  canCreateInboundPlan: boolean;
  onActionCompleted: () => Promise<void>;
}) {
  const meta = CONTROL_TOWER_ASK_ROLE_META[message.role];
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <div className="max-w-[86%] rounded-2xl rounded-br-md bg-[#141413] px-4 py-2.5 text-xs leading-5 text-white">
          {message.question}
        </div>
      </div>
      <div className="flex items-start gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black text-white"
          style={{ background: meta.color }}
        >
          {meta.name.slice(0, 1)}
        </span>
        <div className="min-w-0 max-w-[90%]">
          <div className="mb-1 text-[10px] font-extrabold text-[#667085]">{meta.name} · {meta.team}</div>
          {message.status === "PROCESSING" && (
            <div className="flex items-center gap-2 rounded-2xl rounded-tl-md bg-[#F2F4F7] px-4 py-3 text-xs text-[#667085]">
              <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: meta.color }} />
              현재 Snapshot을 읽고 답변 중입니다.
            </div>
          )}
          {message.status === "FAILED" && (
            <div className="rounded-2xl rounded-tl-md border border-[#FDA29B] bg-[#FFF5F4] px-4 py-3 text-xs text-[#B42318]">
              <div>{message.errorMessage ?? "답변을 완성하지 못했습니다."}</div>
              <div className="mt-2 border-t border-[#FECDCA] pt-2 text-[10px] leading-4 text-[#912018]">
                {message.errorCode === "CONTROL_TOWER_MONTHLY_BUDGET"
                  ? "답변과 실행 제안이 생성되기 전에 월 예산 보호가 작동했습니다. 이 상태에서는 실행 버튼이 표시되지 않습니다."
                  : "담당자 답변이 완료되어야 근거를 검증한 실행 버튼을 만들 수 있습니다."}
              </div>
              {(message.role === "PROCUREMENT" || message.role === "MATERIALS") && (
                <button
                  type="button"
                  disabled
                  className="mt-2 rounded-lg bg-[#D0D5DD] px-3 py-2 text-[10px] font-extrabold text-white"
                >
                  입고계획 초안 만들기 · 답변 필요
                </button>
              )}
            </div>
          )}
          {message.status === "ANSWERED" && message.answer && (
            <div className="rounded-2xl rounded-tl-md border border-[#E4E7EC] bg-white px-4 py-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-[#F2F4F7] px-2 py-0.5 text-[9px] font-extrabold text-[#475467]">
                  {message.answer.status === "ANSWERED"
                    ? "근거 확인"
                    : message.answer.status === "OUT_OF_SCOPE" ? "담당 범위 밖" : "근거 부족"}
                </span>
                <span className="rounded-full bg-[#FFF0F2] px-2 py-0.5 text-[9px] font-extrabold text-[#C01048]">READ ONLY</span>
              </div>
              <p className="mt-2 text-sm font-bold leading-6 text-[#141413]">{message.answer.answer}</p>
              {message.answer.recommendation && (
                <p className="mt-2 text-xs leading-5 text-[#475467]">
                  <b>권고 · </b>{message.answer.recommendation}
                </p>
              )}
              {message.answer.assumptions.length > 0 && (
                <p className="mt-2 text-[10px] leading-4 text-[#B54708]">
                  가정 · {message.answer.assumptions.join(" · ")}
                </p>
              )}
              {message.answer.suggestedRole && (
                <p className="mt-2 text-[10px] font-bold text-[#3538CD]">
                  이 질문은 {CONTROL_TOWER_ASK_ROLE_META[message.answer.suggestedRole].name}에게 물어보는 편이 좋아요.
                </p>
              )}
              {message.evidence.length > 0 && (
                <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                  {message.evidence.map((fact) => (
                    <div key={fact.ref} className="rounded-lg bg-[#F8F9FC] px-2.5 py-2">
                      <div className="font-mono text-[8px] text-[#667085]">{fact.ref}</div>
                      <div className="mt-0.5 text-[10px] font-bold text-[#344054]">{fact.label}</div>
                      <div className="mt-0.5 text-[10px] leading-4 text-[#667085]">{fact.value}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[8px] text-[#98A2B3]">
                {message.model && <span>{message.model}</span>}
                {message.usage && <span>{message.usage.totalTokens.toLocaleString("ko-KR")} tokens</span>}
                {message.costUsd !== null && <span>${message.costUsd.toFixed(6)}</span>}
                {message.latencyMs !== null && <span>{(message.latencyMs / 1000).toFixed(1)}초</span>}
              </div>
              {(message.action || (canCreateInboundPlan && message.answer.actionSuggestion)) && (
                <ControlTowerActionButton
                  messageId={message.id}
                  suggestion={message.answer.actionSuggestion}
                  result={message.action}
                  onCompleted={onActionCompleted}
                />
              )}
              {!message.action && !message.answer.actionSuggestion && (
                <div className="mt-3 rounded-lg bg-[#F2F4F7] px-3 py-2 text-[9px] leading-4 text-[#667085]">
                  {message.role === "PROCUREMENT" || message.role === "MATERIALS"
                    ? "최신 재고 계산에서 검증된 입고계획 제안이 있을 때 실행 버튼이 표시됩니다."
                    : "현재 실제 실행 연결은 김구매·이자재의 입고계획 DRAFT 생성만 지원합니다."}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ControlTowerAskPanel() {
  const [history, setHistory] = useState<ControlTowerAskHistory>(EMPTY_HISTORY);
  const [role, setRole] = useState<ControlTowerRole>("PROCUREMENT");
  const [question, setQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (threadId?: string) => {
    const next = await fetchHistory(threadId);
    setHistory(next);
    if (next.thread) setRole(next.thread.role);
    setError(null);
    return next;
  }, []);

  useEffect(() => {
    void fetchHistory().then((next) => {
      setHistory(next);
      if (next.thread) setRole(next.thread.role);
      setError(null);
    }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "대화 기록을 불러오지 못했습니다.");
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [history.messages, sending]);

  const questionLength = useMemo(() => [...question].length, [question]);
  const meta = CONTROL_TOWER_ASK_ROLE_META[role];
  const activeThread = history.thread?.role === role ? history.thread : null;

  const selectRole = (nextRole: ControlTowerRole) => {
    setRole(nextRole);
    if (history.thread?.role !== nextRole) {
      setHistory((current) => ({ ...current, thread: null, messages: [] }));
    }
    setQuestion("");
    setError(null);
  };

  const startNewThread = () => {
    setHistory((current) => ({ ...current, thread: null, messages: [] }));
    setQuestion("");
    setError(null);
  };

  const submit = async () => {
    const normalized = question.replace(/\s+/g, " ").trim();
    if (!normalized || sending || questionLength > CONTROL_TOWER_ASK_MAX_QUESTION_CHARS) return;
    setSending(true);
    setError(null);
    setQuestion("");
    setPendingQuestion(normalized);
    try {
      const response = await fetch("/api/twin/control-tower/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          question: normalized,
          threadId: activeThread?.id ?? null,
          clientRequestId: crypto.randomUUID(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "담당자 답변을 받지 못했습니다.");
      setHistory(payload as ControlTowerAskHistory);
    } catch (cause) {
      setQuestion(normalized);
      setError(cause instanceof Error ? cause.message : "담당자 답변을 받지 못했습니다.");
      await load().catch(() => undefined);
    } finally {
      setPendingQuestion(null);
      setSending(false);
    }
  };

  const openThread = async (thread: ControlTowerAskThreadSummary) => {
    if (sending) return;
    setLoading(true);
    try {
      await load(thread.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "대화 기록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border bg-white" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
        <div>
          <div className="text-sm font-extrabold text-[#141413]">담당자에게 묻기</div>
          <div className="mt-0.5 text-[10px] text-[#999]">현재 Twin 근거로 답하며, 질문과 답변은 내 대화 기록에 남습니다.</div>
        </div>
        {history.thread && (
          <div className="text-right text-[10px] text-[#98A2B3]">
            <div>{timeLabel(history.thread.snapshotCapturedAt)} Snapshot</div>
            <button type="button" onClick={startNewThread} className="mt-1 font-bold text-[#3538CD]">최신 상태로 새 대화</button>
          </div>
        )}
      </div>

      <div className="border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-wrap gap-2">
          {CONTROL_TOWER_ROLE_ORDER.map((itemRole) => {
            const item = CONTROL_TOWER_ASK_ROLE_META[itemRole];
            const selected = itemRole === role;
            return (
              <button
                key={itemRole}
                type="button"
                onClick={() => selectRole(itemRole)}
                disabled={sending}
                className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-extrabold disabled:opacity-50"
                style={selected
                  ? { borderColor: item.color, background: `${item.color}12`, color: item.color }
                  : { borderColor: "var(--border)", color: "#667085" }}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                {item.name}
              </button>
            );
          })}
        </div>
        {history.recentThreads.length > 0 && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            <span className="shrink-0 py-1 text-[9px] font-bold text-[#98A2B3]">최근 대화</span>
            {history.recentThreads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => void openThread(thread)}
                className="shrink-0 rounded-full bg-[#F2F4F7] px-2 py-1 text-[9px] font-bold text-[#667085]"
              >
                {CONTROL_TOWER_ASK_ROLE_META[thread.role].name} · {timeLabel(thread.createdAt)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="max-h-[520px] min-h-40 space-y-5 overflow-y-auto bg-[#FCFCFD] px-5 py-5">
        {loading && <div className="py-8 text-center text-xs text-[#98A2B3]">대화 기록을 불러오는 중…</div>}
        {!loading && history.messages.length === 0 && !sending && (
          <div className="py-6 text-center">
            <div className="text-sm font-bold text-[#344054]">{meta.name}에게 무엇을 확인할까요?</div>
            <button
              type="button"
              onClick={() => setQuestion(meta.example)}
              className="mt-3 rounded-xl border border-[#D0D5DD] bg-white px-3 py-2 text-xs text-[#667085]"
            >
              “{meta.example}”
            </button>
          </div>
        )}
        {history.messages.map((message) => (
          <AnswerBubble
            key={message.id}
            message={message}
            canCreateInboundPlan={history.capabilities?.createInboundPlan ?? false}
            onActionCompleted={() => load(message.threadId).then(() => undefined)}
          />
        ))}
        {sending && pendingQuestion && (
          <div className="space-y-2">
            <div className="flex justify-end">
              <div className="max-w-[86%] rounded-2xl rounded-br-md bg-[#141413] px-4 py-2.5 text-xs leading-5 text-white">
                {pendingQuestion}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs font-bold" style={{ color: meta.color }}>
              <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: meta.color }} />
              {meta.name}이 현재 Snapshot을 읽고 답변을 작성하고 있습니다.
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t px-5 py-4" style={{ borderColor: "var(--border)" }}>
        {error && <div className="mb-3 rounded-lg bg-[#FFF5F4] px-3 py-2 text-xs text-[#B42318]">{error}</div>}
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 rounded-xl border bg-white px-3 py-2" style={{ borderColor: questionLength > CONTROL_TOWER_ASK_MAX_QUESTION_CHARS ? "#F04438" : "#D0D5DD" }}>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
              disabled={sending}
              rows={2}
              maxLength={CONTROL_TOWER_ASK_MAX_QUESTION_CHARS + 1}
              placeholder={`${meta.name}에게 질문하세요. Enter 전송 · Shift+Enter 줄바꿈`}
              className="w-full resize-none bg-transparent text-sm leading-5 text-[#141413] outline-none placeholder:text-[#98A2B3] disabled:opacity-60"
            />
            <div className="text-right text-[9px]" style={{ color: questionLength > CONTROL_TOWER_ASK_MAX_QUESTION_CHARS ? "#F04438" : "#98A2B3" }}>
              {questionLength}/{CONTROL_TOWER_ASK_MAX_QUESTION_CHARS}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={sending || !question.trim() || questionLength > CONTROL_TOWER_ASK_MAX_QUESTION_CHARS}
            className="rounded-xl px-4 py-3 text-xs font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: meta.color }}
          >
            질문하기
          </button>
        </div>
        <p className="mt-2 text-[9px] text-[#98A2B3]">읽기 전용 자문입니다. 답변은 선택한 담당자의 고정 Snapshot 근거만 사용하며 운영 데이터를 변경하지 않습니다.</p>
      </div>
    </section>
  );
}
