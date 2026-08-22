"use client";

import { useState } from "react";
import type {
  ControlTowerAskActionPreview,
  ControlTowerAskActionResult,
  ControlTowerAskActionSuggestion,
} from "@/lib/control-tower-ask";

export default function ControlTowerActionButton({
  messageId,
  suggestion,
  result,
  onCompleted,
}: {
  messageId: string;
  suggestion: ControlTowerAskActionSuggestion | null;
  result: ControlTowerAskActionResult | null;
  onCompleted: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<ControlTowerAskActionPreview | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/twin/control-tower/ask/action/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "최신 실행 미리보기를 만들지 못했습니다.");
      setPreview(payload as ControlTowerAskActionPreview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "최신 실행 미리보기를 만들지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const execute = async () => {
    if (!preview || executing) return;
    setExecuting(true);
    setError(null);
    try {
      const response = await fetch("/api/twin/control-tower/ask/action/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId: preview.proposalId,
          previewToken: preview.previewToken,
          requestId: crypto.randomUUID(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "입고계획 초안을 만들지 못했습니다.");
      await onCompleted();
      setOpen(false);
      setPreview(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "입고계획 초안을 만들지 못했습니다.");
    } finally {
      setExecuting(false);
    }
  };

  if (result) {
    return (
      <div className="mt-3 rounded-xl border border-[#ABEFC6] bg-[#ECFDF3] px-3 py-2.5">
        <div className="text-[10px] font-extrabold text-[#067647]">실행 완료 · 입고계획 DRAFT</div>
        <div className="mt-1 text-xs font-bold text-[#05603A]">{result.planNo}</div>
        <a href="/erp-bridge" className="mt-1.5 inline-block text-[10px] font-extrabold text-[#0078D4]">
          ERP Bridge에서 초안 보기 →
        </a>
      </div>
    );
  }
  if (!suggestion) return null;

  return (
    <>
      <div className="mt-3 rounded-xl border border-[#B2CCFF] bg-[#EFF4FF] px-3 py-2.5">
        <div className="text-[10px] font-extrabold text-[#3538CD]">실행 가능한 제안</div>
        <p className="mt-1 text-[10px] leading-4 text-[#475467]">{suggestion.reason}</p>
        <button
          type="button"
          onClick={() => void loadPreview()}
          className="mt-2 rounded-lg bg-[#3538CD] px-3 py-2 text-[10px] font-extrabold text-white"
        >
          입고계획 초안 만들기
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="presentation" onMouseDown={() => !executing && setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`action-title-${messageId}`}
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div id={`action-title-${messageId}`} className="text-base font-extrabold text-[#141413]">입고계획 초안 미리보기</div>
                <div className="mt-1 text-[10px] text-[#667085]">최신 재고와 진행 중 입고를 다시 계산했습니다.</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={executing} className="text-lg text-[#98A2B3] disabled:opacity-40" aria-label="닫기">×</button>
            </div>

            {loading && (
              <div className="flex items-center justify-center gap-2 py-12 text-xs font-bold text-[#3538CD]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#3538CD]" />
                실행 가능 여부를 확인하는 중…
              </div>
            )}
            {!loading && error && (
              <div className="mt-5 rounded-xl border border-[#FDA29B] bg-[#FFF5F4] px-3 py-3 text-xs text-[#B42318]">{error}</div>
            )}
            {!loading && preview && (
              <>
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl bg-[#F8F9FC] p-3 sm:col-span-2">
                    <div className="text-[9px] font-bold text-[#98A2B3]">대상 자재</div>
                    <div className="mt-1 text-sm font-extrabold text-[#141413]">{preview.materialCode} · {preview.materialName}</div>
                  </div>
                  <div className="rounded-xl bg-[#F8F9FC] p-3">
                    <div className="text-[9px] font-bold text-[#98A2B3]">현재 + 진행 중 입고</div>
                    <div className="mt-1 text-xs font-extrabold text-[#344054]">
                      {preview.currentQuantity.toLocaleString("ko-KR")} + {preview.activeInboundQuantity.toLocaleString("ko-KR")} {preview.unit}
                    </div>
                  </div>
                  <div className="rounded-xl bg-[#F8F9FC] p-3">
                    <div className="text-[9px] font-bold text-[#98A2B3]">생성할 초안 수량</div>
                    <div className="mt-1 text-xs font-extrabold text-[#344054]">{preview.plannedQuantity.toLocaleString("ko-KR")} {preview.unit}</div>
                  </div>
                  <div className="rounded-xl bg-[#F8F9FC] p-3">
                    <div className="text-[9px] font-bold text-[#98A2B3]">공급사</div>
                    <div className="mt-1 text-xs font-extrabold text-[#344054]">{preview.supplierName}</div>
                  </div>
                  <div className="rounded-xl bg-[#F8F9FC] p-3">
                    <div className="text-[9px] font-bold text-[#98A2B3]">입고 예정일</div>
                    <div className="mt-1 text-xs font-extrabold text-[#344054]">{new Date(preview.plannedDate).toLocaleDateString("ko-KR")}</div>
                  </div>
                </div>
                <div className="mt-3 rounded-xl border border-[#FEC84B] bg-[#FFFAEB] px-3 py-2 text-[10px] leading-4 text-[#93370D]">
                  DRAFT 한 건만 생성됩니다. 공급사 전송·입고 확정·재고 증가는 실행되지 않습니다.
                </div>
              </>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={executing} className="rounded-lg border border-[#D0D5DD] px-3 py-2 text-xs font-bold text-[#475467] disabled:opacity-40">취소</button>
              <button
                type="button"
                onClick={() => void execute()}
                disabled={!preview || loading || executing}
                className="rounded-lg bg-[#EA002C] px-3 py-2 text-xs font-extrabold text-white disabled:opacity-40"
              >
                {executing ? "초안 생성 중…" : "확인하고 DRAFT 만들기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
