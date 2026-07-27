"use client";

import { useCallback, useEffect, useState } from "react";
import {
  REASON_NARRATIVE,
  type AutonomyLevel,
  type ProcurementReasoningChain,
  type ProcurementStepStatus,
  type ShadowVerdict,
} from "@/lib/procurement-agent";

type ActiveScenarioInfo = { label: string; submittedBy: string; submittedAt: string } | null;

type ProcurementShadowPayload = {
  generatedAt: string;
  policyVersion: string;
  scenarioLabel: string;
  shadowMode: true;
  chains: ProcurementReasoningChain[];
  summary: { actionable: number; wouldAutoReceive: number; wouldPropose: number; blocked: number };
  activeScenario: ActiveScenarioInfo;
};

const STEP_DOT: Record<ProcurementStepStatus, string> = {
  OK: "#00875A",
  WARN: "#B97500",
  BLOCKED: "#EA002C",
};

const VERDICT_STYLE: Record<ShadowVerdict, { label: string; color: string; bg: string }> = {
  WOULD_AUTO_RECEIVE: { label: "그림자 · 자동입고했을 것", color: "#00875A", bg: "#E6FAF1" },
  WOULD_PROPOSE: { label: "그림자 · 발주 제안했을 것", color: "#0078D4", bg: "#EAF4FF" },
  BLOCKED: { label: "판단 보류", color: "#EA002C", bg: "#FFF0F2" },
};

// 역할 3단: 엔진(상한 계산) → 에이전트(추천) → 사람(승인/조정). 사람 확정은 상한을 절대 못 넘는다(서버가 다시 clamp).
function AutonomySection({ chain, busy, onSet, onReset }: {
  chain: ProcurementReasoningChain;
  busy: boolean;
  onSet: (materialId: string, level: AutonomyLevel) => void;
  onReset: (materialId: string) => void;
}) {
  const capped = chain.autonomyCeiling === 2;
  const overridden = chain.autonomyOverride !== null;
  const source = overridden ? "사람 확정" : "에이전트 추천";

  return (
    <div className="flex flex-col items-end gap-1">
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold"
        style={capped ? { background: "#FFF7E6", color: "#B97500" } : { background: "#E6FAF1", color: "#00875A" }}
        title={chain.ceilingReason ?? "자동입고(L4)까지 가능한 자재입니다."}
      >
        {capped ? "🔒 상한 L2" : "상한 L4"}
      </span>
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
        style={{ background: "#F1F1F0", color: "#555" }}
        title={chain.autonomyRecommendation.rationale}
      >
        {chain.effectiveAutonomy === 4 ? "🤖" : "💡"} 적용 L{chain.effectiveAutonomy} · {source}
      </span>
      {!capped && (
        <div className="mt-0.5 flex gap-1">
          {([2, 4] as AutonomyLevel[]).map((lvl) => (
            <button
              key={lvl}
              disabled={busy || chain.effectiveAutonomy === lvl}
              onClick={() => onSet(chain.materialId, lvl)}
              className="rounded-full px-2 py-0.5 text-[10px] font-bold disabled:opacity-40"
              style={chain.effectiveAutonomy === lvl ? { background: "#141413", color: "#fff" } : { background: "#fff", border: "1px solid var(--border)", color: "#777" }}
            >
              L{lvl}
            </button>
          ))}
          {overridden && (
            <button disabled={busy} onClick={() => onReset(chain.materialId)} className="rounded-full px-2 py-0.5 text-[10px] font-bold text-[#0078D4] underline disabled:opacity-40">
              추천대로
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ChainCard({ chain, busy, onSet, onReset }: {
  chain: ProcurementReasoningChain;
  busy: boolean;
  onSet: (materialId: string, level: AutonomyLevel) => void;
  onReset: (materialId: string) => void;
}) {
  const [showReasons, setShowReasons] = useState(false);
  const v = VERDICT_STYLE[chain.verdict];
  return (
    <div className="rounded-2xl border bg-white p-5" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-black text-[#141413]">{chain.materialName}</div>
          <div className="text-[11px] text-[#999]">{chain.materialCode} · {chain.category}{chain.supplierName ? ` · ${chain.supplierName}` : ""}</div>
        </div>
        <AutonomySection chain={chain} busy={busy} onSet={onSet} onReset={onReset} />
      </div>

      {/* 추론 사슬 4스텝 */}
      <div className="mt-4">
        {chain.steps.map((s, i) => (
          <div key={s.key} className="flex gap-3">
            {/* 도트 + 연결선 */}
            <div className="flex flex-col items-center">
              <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: STEP_DOT[s.status] }} />
              {i < chain.steps.length - 1 && <span className="my-0.5 w-px flex-1" style={{ background: "var(--border)" }} />}
            </div>
            <div className="pb-4">
              <div className="text-[11px] font-bold tracking-[0.04em] text-[#777]">{s.title}</div>
              <div className="mt-0.5 text-sm text-[#141413]">{s.detail}</div>
              {s.metrics.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                  {s.metrics.map((m) => (
                    <span key={m.label} className="text-[11px] text-[#888]">{m.label} <b className="text-[#555]">{m.value}</b></span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 그림자 판정 */}
      <div className="mt-1 rounded-xl border border-dashed p-3" style={{ borderColor: v.color, background: v.bg }}>
        <div className="flex items-center gap-2">
          <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold" style={{ background: v.color, color: "#fff" }}>{v.label}</span>
        </div>
        <div className="mt-1.5 text-sm font-bold" style={{ color: v.color }}>{chain.verdictText}</div>
      </div>

      {/* 근거 원문 토글 */}
      <button onClick={() => setShowReasons((s) => !s)} className="mt-2 text-[11px] font-bold text-[#0078D4]">
        근거 원문 {showReasons ? "접기 ↑" : "보기 ↓"}
      </button>
      {showReasons && (
        <ul className="mt-1 space-y-1">
          {chain.reasonCodes.map((code) => (
            <li key={code} className="text-[11px] text-[#777]">
              <code className="rounded bg-[#F1F1F0] px-1 py-0.5 text-[10px] text-[#555]">{code}</code>
              <span className="ml-1.5">{REASON_NARRATIVE[code] ?? "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ProcurementCockpitClient() {
  const [report, setReport] = useState<ProcurementShadowPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyMaterialId, setBusyMaterialId] = useState<string | null>(null);
  const [scenarioBusy, setScenarioBusy] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/agents/procurement/preview", { cache: "no-store", signal });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 403) throw new Error("입고 관제는 자재관리·관리자 권한 계정에서만 볼 수 있어요.");
        if (res.status === 401) throw new Error("세션이 만료되었습니다. 다시 로그인해 주세요.");
        throw new Error(payload.error ?? "입고 에이전트 미리보기를 불러오지 못했습니다.");
      }
      setReport(payload as ProcurementShadowPayload);
      setError(null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "불러오지 못했습니다.");
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
      try { await load(controller.signal); } finally { running = false; }
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

  async function setAutonomy(materialId: string, level: AutonomyLevel) {
    setBusyMaterialId(materialId);
    try {
      const res = await fetch("/api/agents/procurement/autonomy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialId, fabId: null, level }),
      });
      if (!res.ok) { const p = await res.json().catch(() => ({})); throw new Error(p.error ?? "자율등급 저장 실패"); }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "자율등급 저장 실패");
    } finally {
      setBusyMaterialId(null);
    }
  }

  async function resetAutonomy(materialId: string) {
    setBusyMaterialId(materialId);
    try {
      const res = await fetch(`/api/agents/procurement/autonomy?materialId=${encodeURIComponent(materialId)}`, { method: "DELETE" });
      if (!res.ok) { const p = await res.json().catch(() => ({})); throw new Error(p.error ?? "자율등급 초기화 실패"); }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "자율등급 초기화 실패");
    } finally {
      setBusyMaterialId(null);
    }
  }

  async function clearScenario() {
    setScenarioBusy(true);
    try {
      const res = await fetch("/api/agents/procurement/scenario", { method: "DELETE" });
      if (!res.ok) { const p = await res.json().catch(() => ({})); throw new Error(p.error ?? "시나리오 초기화 실패"); }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "시나리오 초기화 실패");
    } finally {
      setScenarioBusy(false);
    }
  }

  const s = report?.summary;

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-[#141413]">입고 관제 <span className="text-sm font-bold text-[#999]">Procurement Cockpit</span></h1>
          <p className="mt-1 text-sm text-[#888]">생산계획·재고를 읽고 입고 에이전트가 <b>무엇을 할지</b> 미리 보여줍니다.</p>
        </div>
        <span className="rounded-full bg-[#F1F1F0] px-3 py-1 text-[11px] font-bold text-[#777]">정책 {report?.policyVersion ?? "…"}</span>
      </div>

      {/* 그림자 모드 배너 */}
      <div
        className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-[#6B4EAA]"
        style={{ background: "repeating-linear-gradient(45deg, #F5F2FB, #F5F2FB 10px, #EEE9F7 10px, #EEE9F7 20px)" }}
      >
        <span className="rounded-full bg-[#6B4EAA] px-2 py-0.5 text-[10px] font-extrabold text-white">SHADOW</span>
        그림자 모드 — 에이전트는 판단만 하고 <b>실제 발주·입고는 실행하지 않습니다.</b> 「자동이었다면 이렇게 했을 것」을 보여줍니다.
      </div>

      {/* 반영된 시나리오 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white px-4 py-2.5 text-xs" style={{ borderColor: "var(--border)" }}>
        {report?.activeScenario ? (
          <>
            <span className="text-[#555]">
              반영 시나리오 <b className="text-[#141413]">{report.activeScenario.label}</b>
              <span className="ml-2 text-[#999]">{report.activeScenario.submittedBy} · {new Date(report.activeScenario.submittedAt).toLocaleString("ko-KR")}</span>
            </span>
            <button disabled={scenarioBusy} onClick={() => void clearScenario()} className="font-bold text-[#0078D4] underline disabled:opacity-40">
              기본값(현재 재고 위험점검)으로 되돌리기
            </button>
          </>
        ) : (
          <span className="text-[#999]">현재 재고 기준 위험 점검(기본값) — 운영 What-if에서 시나리오를 반영할 수 있어요.</span>
        )}
      </div>

      {/* 요약 스트립 */}
      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "조치 대상", value: s.actionable, tone: "#141413" },
            { label: "자동입고 했을 것", value: s.wouldAutoReceive, tone: "#00875A" },
            { label: "발주 제안했을 것", value: s.wouldPropose, tone: "#0078D4" },
            { label: "판단 보류", value: s.blocked, tone: "#EA002C" },
          ].map((k) => (
            <div key={k.label} className="rounded-2xl border bg-white p-4" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
              <div className="text-[11px] font-bold tracking-[0.04em] text-[#777]">{k.label}</div>
              <div className="mt-1 text-2xl font-black" style={{ color: k.tone }}>{k.value}</div>
            </div>
          ))}
        </div>
      )}

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      {loading && !report && <div className="rounded-2xl border bg-white p-8 text-center text-sm text-[#999]" style={{ borderColor: "var(--border)" }}>입고 에이전트 판단을 불러오는 중…</div>}

      {report && report.chains.length === 0 && !loading && (
        <div className="rounded-2xl border bg-white p-10 text-center" style={{ borderColor: "var(--border)", boxShadow: "var(--shadow-1)" }}>
          <div className="text-sm font-bold text-[#666]">지금 조치가 필요한 자재가 없습니다</div>
          <div className="mt-1 text-xs text-[#aaa]">재고·리드타임 기준으로 부족이 예측되면 여기에 판단 사슬이 나타납니다.</div>
        </div>
      )}

      {/* 추론 사슬 카드 목록 */}
      <div className="grid gap-4 lg:grid-cols-2">
        {report?.chains.map((c) => (
          <ChainCard key={c.materialId} chain={c} busy={busyMaterialId === c.materialId} onSet={setAutonomy} onReset={resetAutonomy} />
        ))}
      </div>
    </div>
  );
}
