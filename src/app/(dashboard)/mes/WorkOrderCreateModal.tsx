"use client";

import { useEffect, useState } from "react";
import type { Product } from "@/lib/db";
import { PROCESSES } from "@/lib/processes";

type BomTemplateLine = { materialId: string; qtyPerRun: number };
type Template = { _id: string; processCode: string; product: Product; lines: BomTemplateLine[] };

const PRODUCTS: Product[] = ["HBM", "DRAM", "NAND"];

export default function WorkOrderCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [processCode, setProcessCode] = useState("");
  const [product, setProduct] = useState<Product>("HBM");
  const [plannedQty, setPlannedQty] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/mes/bom-templates").then(r => r.json()).then(setTemplates);
  }, []);

  const processCodes = Array.from(new Set(templates.map(t => t.processCode))).sort();
  const selectedTemplate = templates.find(t => t.processCode === processCode && t.product === product);

  const handleSubmit = async () => {
    if (!processCode || !plannedQty || Number(plannedQty) <= 0) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/mes/workorders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processCode, product, plannedQty: Number(plannedQty) }),
      });
      if (r.ok) { onCreated(); onClose(); }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold" style={{ color: "var(--text-1)" }}>작업지시 생성</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-2)" }}>공정</label>
              <select
                value={processCode}
                onChange={e => setProcessCode(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-white"
                style={{ borderColor: "var(--border)" }}
              >
                <option value="">선택</option>
                {processCodes.map(p => {
                  const proc = PROCESSES.find(pr => pr.code === p);
                  return (
                    <option key={p} value={p}>
                      {proc ? `${proc.name} (${p})` : p}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-2)" }}>품목</label>
              <select
                value={product}
                onChange={e => setProduct(e.target.value as Product)}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-white"
                style={{ borderColor: "var(--border)" }}
              >
                {PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-2)" }}>계획 수량 (런)</label>
            <input
              type="number"
              value={plannedQty}
              onChange={e => setPlannedQty(e.target.value)}
              placeholder="예: 5"
              min="1"
              className="w-full px-3 py-2 text-sm border rounded-lg"
              style={{ borderColor: "var(--border)" }}
            />
          </div>

          {selectedTemplate && (
            <div>
              <div className="text-xs font-medium mb-2" style={{ color: "var(--text-2)" }}>BOM 자재 소요량</div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {selectedTemplate.lines.map(l => (
                  <div key={l.materialId} className="flex justify-between text-xs px-3 py-1.5 bg-gray-50 rounded-lg">
                    <span style={{ color: "var(--text-2)" }}>{l.materialId}</span>
                    <span className="font-medium" style={{ color: "var(--text-1)" }}>
                      {l.qtyPerRun}/런 × {plannedQty || "N"}런 = {plannedQty ? (l.qtyPerRun * Number(plannedQty)).toFixed(1) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {processCode && !selectedTemplate && (
            <div className="text-xs text-center py-3" style={{ color: "var(--text-3)" }}>
              {processCode}-{product} BOM 템플릿 없음
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={!processCode || !plannedQty || Number(plannedQty) <= 0 || submitting}
            className="flex-1 py-2 text-sm font-medium rounded-lg bg-[#0078D4] text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "생성 중..." : "작업지시 생성"}
          </button>
        </div>
      </div>
    </div>
  );
}
