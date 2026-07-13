"use client";

import { useEffect, useRef, useState } from "react";
import type { SimStateDoc, SimPurchaseOrderDoc, SimEventDoc } from "@/lib/db";

const EVENT_ICON: Record<string, string> = {
  CONSUMPTION: "⚙️",
  PO_CREATED: "📦",
  GR_ARRIVED: "🟢",
  STOCKOUT_RISK: "🔴",
  DELAY: "🟡",
  PARTIAL_GR: "🟡",
  PO_CANCELLED: "🔴",
  MANUAL: "🔵",
};

const SPEED_OPTIONS = [1, 5, 10, 30, 100];

function fmtDate(d: Date | string | undefined) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR");
}

function daysDiff(a: Date | string | undefined, b: Date | string | undefined) {
  if (!a || !b) return 0;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

export default function SimControlPanel() {
  const [state, setState] = useState<SimStateDoc | null>(null);
  const [events, setEvents] = useState<SimEventDoc[]>([]);
  const [pos, setPos] = useState<SimPurchaseOrderDoc[]>([]);
  const [jumping, setJumping] = useState(false);
  const [manualMat, setManualMat] = useState("");
  const [manualQty, setManualQty] = useState("");
  const esRef = useRef<EventSource | null>(null);

  const fetchState = async () => {
    const r = await fetch("/api/sim/state");
    if (r.ok) setState(await r.json());
  };
  const fetchEvents = async () => {
    const r = await fetch("/api/sim/events?limit=50");
    if (r.ok) setEvents(await r.json());
  };
  const fetchPos = async () => {
    const r = await fetch("/api/sim/pos");
    if (r.ok) setPos(await r.json());
  };

  useEffect(() => {
    fetchState();
    fetchEvents();
    fetchPos();
  }, []);

  // SSE 연결
  useEffect(() => {
    const connect = () => {
      if (esRef.current) esRef.current.close();
      const es = new EventSource("/api/sim/stream");
      esRef.current = es;
      es.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.simDate) {
          setState(prev => prev ? { ...prev, simDate: data.simDate, status: data.status ?? prev.status } : null);
        }
        if (data.type === "status") {
          setState(prev => prev ? { ...prev, status: data.status } : null);
        }
        if (data.newEvents?.length) {
          setEvents(prev => [...data.newEvents.reverse(), ...prev].slice(0, 50));
          fetchPos();
        }
      };
      es.onerror = () => {
        setTimeout(connect, 3000);
      };
    };
    connect();
    return () => esRef.current?.close();
  }, []);

  const handleStart = async (speed?: number) => {
    const r = await fetch("/api/sim/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speedMultiplier: speed ?? state?.speedMultiplier ?? 10 }),
    });
    if (r.ok) { const s = await r.json(); setState(s); }
  };

  const handlePause = async () => {
    await fetch("/api/sim/pause", { method: "POST" });
    await fetchState();
  };

  const handleReset = async () => {
    if (!confirm("시뮬레이션 데이터를 전부 삭제하고 초기화할까요?")) return;
    await fetch("/api/sim/reset", { method: "POST" });
    await Promise.all([fetchState(), fetchEvents(), fetchPos()]);
  };

  const handleJump = async (days: number) => {
    setJumping(true);
    try {
      await fetch(`/api/sim/jump?days=${days}`, { method: "POST" });
      await Promise.all([fetchState(), fetchEvents(), fetchPos()]);
    } finally {
      setJumping(false);
    }
  };

  const handleDelay = async (id: string, days = 3) => {
    await fetch(`/api/sim/pos/${id}/delay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    });
    await fetchPos();
    await fetchEvents();
  };

  const handlePartial = async (id: string, ratio = 0.7) => {
    await fetch(`/api/sim/pos/${id}/partial`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ratio }),
    });
    await Promise.all([fetchPos(), fetchEvents()]);
  };

  const handleEmergencyPO = async () => {
    if (!manualMat || !manualQty) return;
    await fetch("/api/sim/pos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialId: manualMat, qty: Number(manualQty) }),
    });
    setManualMat(""); setManualQty("");
    await fetchPos();
  };

  const isRunning = state?.status === "RUNNING";
  const elapsed = daysDiff(state?.simStartDate, state?.simDate);

  return (
    <div className="space-y-4">
      {/* 상태 배지 */}
      {state && (
        <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium w-fit ${
          isRunning ? "bg-blue-50 text-blue-700" : state.status === "PAUSED" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"
        }`}>
          <span className={`w-2 h-2 rounded-full ${isRunning ? "bg-blue-500 animate-pulse" : "bg-gray-400"}`} />
          {isRunning ? "RUNNING" : state.status} · {fmtDate(state.simDate)} ({elapsed}일 경과)
        </div>
      )}

      {/* 컨트롤 바 */}
      <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-wrap gap-3 items-center">
        <div className="flex gap-2">
          {!isRunning ? (
            <button onClick={() => handleStart()} className="px-4 py-2 bg-[#0078D4] text-white rounded-lg text-sm font-medium hover:bg-blue-700">▶ 시작</button>
          ) : (
            <button onClick={handlePause} className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600">⏸ 멈춤</button>
          )}
          <button onClick={handleReset} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">⏮ 리셋</button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">속도:</span>
          {SPEED_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => handleStart(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${state?.speedMultiplier === s && isRunning ? "bg-[#0078D4] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {s}×
            </button>
          ))}
        </div>

        <div className="flex gap-2 ml-auto">
          <button onClick={() => handleJump(30)} disabled={jumping} className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-200 disabled:opacity-50">
            {jumping ? "처리 중..." : "30일 점프"}
          </button>
          <button onClick={() => handleJump(90)} disabled={jumping} className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-200 disabled:opacity-50">
            90일 점프
          </button>
        </div>
      </div>

      {/* 이벤트 피드 + PO 패널 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 이벤트 피드 */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">실시간 이벤트 피드</h3>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {events.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">시뮬레이션을 시작하면 이벤트가 여기 표시됩니다.</p>
            )}
            {events.map(ev => (
              <div key={ev._id} className="flex gap-2 text-xs text-gray-700 py-1 border-b border-gray-50 last:border-0">
                <span className="shrink-0">{EVENT_ICON[ev.type] ?? "•"}</span>
                <span className="text-gray-400 shrink-0">{fmtDate(ev.simDate)}</span>
                <span className="truncate">{ev.note}</span>
              </div>
            ))}
          </div>
        </div>

        {/* PO 패널 */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">진행 중 PO</h3>
          <div className="space-y-2 max-h-56 overflow-y-auto mb-3">
            {pos.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">발주 없음</p>
            )}
            {pos.map(po => (
              <div key={po._id} className="flex items-center gap-2 text-xs p-2 bg-gray-50 rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-700 truncate">{po.materialId}</div>
                  <div className="text-gray-400">{po.qty}개 · 도착 {fmtDate(po.expectedArrival)} {po.delayDays > 0 && <span className="text-red-500">+{po.delayDays}일</span>}</div>
                </div>
                <button onClick={() => handleDelay(po._id, 3)} className="px-2 py-1 bg-amber-100 text-amber-700 rounded hover:bg-amber-200">지연+3</button>
                <button onClick={() => handlePartial(po._id, 0.7)} className="px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200">부분70%</button>
              </div>
            ))}
          </div>

          {/* 긴급 발주 */}
          <div className="border-t pt-3">
            <p className="text-xs font-medium text-gray-600 mb-2">+ 긴급 발주</p>
            <div className="flex gap-2">
              <input
                value={manualMat}
                onChange={e => setManualMat(e.target.value)}
                placeholder="자재 ID (예: CHM-007)"
                className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg"
              />
              <input
                value={manualQty}
                onChange={e => setManualQty(e.target.value)}
                placeholder="수량"
                type="number"
                className="w-20 px-2 py-1.5 text-xs border border-gray-200 rounded-lg"
              />
              <button onClick={handleEmergencyPO} className="px-3 py-1.5 bg-[#0078D4] text-white text-xs rounded-lg hover:bg-blue-700">발주</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
