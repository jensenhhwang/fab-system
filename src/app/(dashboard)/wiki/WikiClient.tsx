"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Entry = {
  id: string;
  date: string;
  title: string;
  category: string;
  content: string;
  result: string | null;
  nextAction: string | null;
  user: { name: string };
};

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  개발:   { bg: "#EDE9FE", text: "#6D28D9" },
  장애:   { bg: "#FEE2E2", text: "#B91C1C" },
  회의:   { bg: "#DBEAFE", text: "#1D4ED8" },
  입고:   { bg: "#E6FAF1", text: "#065F46" },
  점검:   { bg: "#FFF8E6", text: "#B97500" },
  기타:   { bg: "#F1F5F9", text: "#475569" },
};

function EntryCard({ entry, isOpen, onToggle }: { entry: Entry; isOpen: boolean; onToggle: () => void }) {
  const cat = CATEGORY_COLORS[entry.category] ?? CATEGORY_COLORS["기타"];
  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-[#F0F0F0]">
      <button
        onClick={onToggle}
        className="w-full text-left px-6 py-4 flex items-center gap-4 hover:bg-[#FAFAFA] transition-colors"
      >
        <div className="w-12 text-center flex-shrink-0">
          <div className="text-[10px] text-[#999]">{new Date(entry.date).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })}</div>
          <div className="text-[10px] text-[#999]">{new Date(entry.date).toLocaleDateString("ko-KR", { weekday: "short" })}</div>
        </div>
        <div className="w-px h-8 bg-[#F0F0F0] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-[#111] text-sm truncate">{entry.title}</div>
          <div className="text-[11px] text-[#999] mt-0.5">{entry.user.name}</div>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: cat.bg, color: cat.text }}>
          {entry.category}
        </span>
        <span className="text-[#999] text-xs flex-shrink-0">{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <div className="px-6 pb-5 border-t border-[#F8F8F8]">
          <div className="pt-4 space-y-4">
            <div>
              <div className="text-[10px] font-semibold text-[#999] uppercase tracking-wider mb-1.5">작업 내용</div>
              <pre className="text-xs text-[#333] whitespace-pre-wrap leading-relaxed font-sans bg-[#FAFAFA] rounded-xl p-4">
                {entry.content}
              </pre>
            </div>
            {entry.result && (
              <div>
                <div className="text-[10px] font-semibold text-[#00875A] uppercase tracking-wider mb-1.5">결과</div>
                <div className="text-xs text-[#333] bg-[#E6FAF1] rounded-xl p-4 leading-relaxed">
                  {entry.result}
                </div>
              </div>
            )}
            {entry.nextAction && (
              <div>
                <div className="text-[10px] font-semibold text-[#0078D4] uppercase tracking-wider mb-1.5">다음 작업</div>
                <pre className="text-xs text-[#333] whitespace-pre-wrap leading-relaxed font-sans bg-[#E8F3FF] rounded-xl p-4">
                  {entry.nextAction}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NewEntryForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: "", category: "개발", content: "", result: "", nextAction: "" });
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/wiki", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    router.refresh();
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-[#E8E8E8] p-6 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-bold">새 업무 일지</div>
        <button type="button" onClick={onClose} className="text-[#999] hover:text-[#111] text-xs">✕ 닫기</button>
      </div>
      <div className="grid grid-cols-[1fr_140px] gap-3">
        <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="제목"
          className="border border-[#E8E8E8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#EA002C] placeholder:text-[#CCC]" />
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
          className="border border-[#E8E8E8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#EA002C] bg-white">
          {Object.keys(CATEGORY_COLORS).map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <textarea required rows={5} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })}
        placeholder="작업 내용"
        className="w-full border border-[#E8E8E8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#EA002C] resize-none placeholder:text-[#CCC]" />
      <input value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })}
        placeholder="결과 (선택)"
        className="w-full border border-[#E8E8E8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#EA002C] placeholder:text-[#CCC]" />
      <textarea rows={3} value={form.nextAction} onChange={(e) => setForm({ ...form, nextAction: e.target.value })}
        placeholder="다음 작업 (선택)"
        className="w-full border border-[#E8E8E8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#EA002C] resize-none placeholder:text-[#CCC]" />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose}
          className="px-4 py-2 rounded-xl text-sm text-[#555] border border-[#E8E8E8] hover:bg-[#F8F8F8] transition-colors">
          취소
        </button>
        <button type="submit" disabled={saving}
          className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-[#EA002C] hover:bg-[#C50025] disabled:opacity-50 transition-colors">
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}

export default function WikiClient({ entries }: { entries: Entry[] }) {
  const [openId, setOpenId] = useState<string | null>(entries[0]?.id ?? null);
  const [showForm, setShowForm] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div />
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white bg-[#EA002C] hover:bg-[#C50025] transition-colors shadow-sm"
        >
          <span>+</span> 새 일지 작성
        </button>
      </div>

      {showForm && (
        <div className="mb-4">
          <NewEntryForm onClose={() => setShowForm(false)} onSaved={() => setShowForm(false)} />
        </div>
      )}

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-24 bg-white rounded-2xl border border-dashed border-[#E8E8E8]">
          <div className="text-4xl">📝</div>
          <div className="text-sm text-[#999]">아직 작성된 업무 일지가 없습니다.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (
            <EntryCard
              key={e.id}
              entry={e}
              isOpen={openId === e.id}
              onToggle={() => setOpenId((prev) => (prev === e.id ? null : e.id))}
            />
          ))}
        </div>
      )}
    </>
  );
}
