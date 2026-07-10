"use client";

import { useEffect, useState } from "react";
import type { AIBriefing, AIPriority } from "@/lib/ai";

const LEVEL_STYLES: Record<AIPriority["level"], { bg: string; border: string; badge: string; badgeBg: string; label: string }> = {
  urgent: { bg: "#FFF5F5", border: "#FFC5C5", badge: "#EA002C", badgeBg: "#FFF0F2", label: "긴급" },
  warning:{ bg: "#FFFBEB", border: "#FFE082", badge: "#B97500", badgeBg: "#FFF8E6", label: "주의" },
  info:   { bg: "#F0F7FF", border: "#C5DEFF", badge: "#0078D4", badgeBg: "#E8F3FF", label: "확인" },
};

const CATEGORY_ICONS: Record<string, string> = {
  "재고": "📦", "창고": "🏭", "리스크": "⚠️", "인프라": "🔧", "공급망": "🌐",
};

export default function AIBriefing() {
  const [briefing, setBriefing] = useState<AIBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch("/api/ai-briefing")
      .then((r) => r.json())
      .then((data) => { setBriefing(data); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-[#E8E8E8] shadow-sm p-5 mb-6 animate-pulse">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-[#F0F0F0]" />
          <div className="h-4 w-48 bg-[#F0F0F0] rounded" />
          <div className="ml-auto h-3 w-24 bg-[#F0F0F0] rounded" />
        </div>
        <div className="h-3 w-full bg-[#F0F0F0] rounded mb-2" />
        <div className="h-3 w-3/4 bg-[#F0F0F0] rounded mb-5" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-[#F8F8F8] rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !briefing) {
    return (
      <div className="bg-white rounded-2xl border border-[#E8E8E8] shadow-sm p-5 mb-6">
        <div className="flex items-center gap-2 text-sm text-[#999]">
          <span>🤖</span>
          <span>AI 브리핑을 불러오지 못했어요. Groq API 연결을 확인해주세요.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E8E8E8] shadow-sm mb-6 overflow-hidden">
      {/* 헤더 */}
      <div
        className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-[#FAFAFA] transition-colors border-b border-[#F0F0F0]"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#EA002C] to-[#F47725] flex items-center justify-center text-white text-sm flex-shrink-0">
          AI
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold text-[#111]">{briefing.greeting}</div>
        </div>
        <div className="text-[10px] text-[#999]">
          {new Date(briefing.generatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 기준
        </div>
        <span className="text-[#999] text-xs ml-1">{collapsed ? "▼" : "▲"}</span>
      </div>

      {!collapsed && (
        <div className="px-5 py-4">
          {/* 요약 */}
          <p className="text-sm text-[#555] leading-relaxed mb-4 pb-4 border-b border-[#F0F0F0]">
            {briefing.summary}
          </p>

          {/* 우선순위 카드 */}
          <div className="grid grid-cols-2 gap-3">
            {briefing.priorities.map((p, i) => {
              const s = LEVEL_STYLES[p.level];
              const icon = CATEGORY_ICONS[p.category] ?? "📋";
              return (
                <div
                  key={i}
                  className="rounded-xl p-3.5"
                  style={{ backgroundColor: s.bg, border: `1px solid ${s.border}` }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base leading-none">{icon}</span>
                    <span
                      className="text-[9px] font-black px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: s.badgeBg, color: s.badge }}
                    >
                      {s.label}
                    </span>
                    <span className="text-[10px] text-[#999] ml-auto">#{i + 1}</span>
                  </div>
                  <div className="text-xs font-bold text-[#111] mb-1">{p.title}</div>
                  <div className="text-[11px] text-[#555] leading-relaxed mb-2">{p.detail}</div>
                  <div
                    className="text-[10px] font-semibold px-2 py-1 rounded-lg inline-block"
                    style={{ backgroundColor: s.badge + "18", color: s.badge }}
                  >
                    → {p.action}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
