import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections } from "@/lib/db";
import { M20_MATERIAL_CONSUMPTION } from "@/lib/material-consumption";
import { runProcurementShadow } from "@/lib/procurement-agent-server";
import { getProcurementVoice } from "@/lib/procurement-voice-server";
import {
  CONTROL_TOWER_PERSONAS,
  CONTROL_TOWER_ROLE_ORDER,
  type AgentWatchMetric,
  type ControlTowerAgentView,
  type ControlTowerView,
  type ProcurementJudgmentView,
  type TwinEventView,
} from "@/lib/control-tower-live";

export const dynamic = "force-dynamic";

// MVP-1: 살아있는 Twin의 심박·소모·발주와 에이전트 판단을 한 화면으로 모으는 읽기 전용 관제탑.
export async function GET() {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  try {
    const now = new Date();
    const { twinEngineState, twinBurnEvents, twinPurchaseOrders, inventory, materials, workOrders, waferLots } = await collections();
    const materialIds = [...new Set(M20_MATERIAL_CONSUMPTION.map((r) => r.materialId))];

    const [state, matDocs, invDocs, recentBurns, totalBurnEvents, openPOs, recentPOs, wipCount, queuedWO] = await Promise.all([
      twinEngineState.findOne({ _id: "singleton" }),
      materials.find({ _id: { $in: materialIds } }).toArray(),
      inventory.find({ materialId: { $in: materialIds } }).toArray(),
      twinBurnEvents.find({}).sort({ tickAt: -1 }).limit(14).toArray(),
      twinBurnEvents.countDocuments(),
      twinPurchaseOrders.find({ status: { $ne: "RECEIVED" } }).toArray(),
      twinPurchaseOrders.find({}).sort({ orderedAt: -1 }).limit(8).toArray(),
      waferLots.countDocuments({ fabId: "M20", product: "HBM", cohort: { $in: ["AGGREGATE", "MODELED_FOUP"] }, status: "IN_PROGRESS" }),
      workOrders.countDocuments({ status: { $in: ["QUEUED", "MATERIAL_WAIT"] } }),
    ]);

    const matById = new Map(matDocs.map((m) => [m._id, m]));
    const nameOf = (id: string) => matById.get(id)?.name ?? id;
    const codeOf = (id: string) => matById.get(id)?.code ?? id;

    // 자재별 대표 재고(최대 수량) 선택
    const invByMat = new Map<string, { quantity: number; avgDailyBurn: number }>();
    for (const d of invDocs) {
      const prev = invByMat.get(d.materialId);
      if (!prev || d.quantity > prev.quantity) invByMat.set(d.materialId, { quantity: d.quantity, avgDailyBurn: d.avgDailyBurn ?? 0 });
    }

    // MATERIALS 관측 신호: ROP 미만 자재 수 + 최저 커버리지
    let belowRop = 0;
    let lowestCoverage: { code: string; days: number } | null = null;
    for (const id of materialIds) {
      const inv = invByMat.get(id);
      const mat = matById.get(id);
      if (!inv || !mat) continue;
      const rop = inv.avgDailyBurn * mat.ropDays;
      if (inv.avgDailyBurn > 0 && inv.quantity < rop) belowRop += 1;
      if (inv.avgDailyBurn > 0) {
        const days = inv.quantity / inv.avgDailyBurn;
        if (!lowestCoverage || days < lowestCoverage.days) lowestCoverage = { code: mat.code, days };
      }
    }

    const inTransitQty = openPOs.reduce((s, po) => s + po.qty, 0);

    // ── PROCUREMENT(김구매) 실제 판단 ──
    let judgment: ProcurementJudgmentView | null = null;
    const shadow = await runProcurementShadow({});
    const topChain = shadow.chains[0] ?? null;
    let top: NonNullable<ProcurementJudgmentView["top"]> | null = null;
    if (topChain) {
      // 숫자·판정은 결정론 엔진(topChain) 그대로. 김구매 목소리(각색)만 LLM으로.
      const voice = await getProcurementVoice({
        materialName: topChain.materialName,
        materialCode: topChain.materialCode,
        verdict: topChain.verdict,
        verdictText: topChain.verdictText,
      });
      top = {
        materialCode: topChain.materialCode,
        materialName: topChain.materialName,
        verdict: topChain.verdict,
        verdictText: topChain.verdictText,
        voice: voice.text,
        voiceSource: voice.source,
      };
    }
    judgment = {
      scenarioLabel: shadow.scenarioLabel,
      actionable: shadow.summary.actionable,
      wouldAutoReceive: shadow.summary.wouldAutoReceive,
      wouldPropose: shadow.summary.wouldPropose,
      blocked: shadow.summary.blocked,
      top,
    };

    const watching: Record<string, AgentWatchMetric[]> = {
      PROCUREMENT: [
        { label: "조치 대상", value: `${shadow.summary.actionable}종` },
        { label: "발주 제안", value: `${shadow.summary.wouldPropose}종`, tone: shadow.summary.wouldPropose > 0 ? "warn" : "normal" },
        { label: "판단 보류", value: `${shadow.summary.blocked}종`, tone: shadow.summary.blocked > 0 ? "critical" : "normal" },
      ],
      MATERIALS: [
        { label: "ROP 미만 자재", value: `${belowRop}종`, tone: belowRop > 0 ? "warn" : "normal" },
        { label: "최저 커버리지", value: lowestCoverage ? `${lowestCoverage.code} ${lowestCoverage.days.toFixed(1)}일` : "—", tone: lowestCoverage && lowestCoverage.days < 5 ? "critical" : "normal" },
        { label: "추적 자재", value: `${materialIds.length}종` },
      ],
      PRODUCTION: [
        { label: "진행 중 WIP", value: `${wipCount.toLocaleString("ko-KR")} FOUP` },
        { label: "대기 작업지시", value: `${queuedWO}건`, tone: queuedWO > 0 ? "warn" : "normal" },
      ],
      LOGISTICS: [
        { label: "입고 중 PO", value: `${openPOs.length}건` },
        { label: "입고 예정 수량", value: Math.round(inTransitQty).toLocaleString("ko-KR") },
      ],
    };

    const agents: ControlTowerAgentView[] = CONTROL_TOWER_ROLE_ORDER.map((role) => {
      const p = CONTROL_TOWER_PERSONAS[role];
      return {
        role, name: p.name, team: p.team, color: p.color, remit: p.remit,
        consciousness: p.consciousness, roadmapNote: p.roadmapNote,
        watching: watching[role] ?? [],
        judgment: role === "PROCUREMENT" ? judgment : null,
      };
    });

    // ── 이벤트 스트림: 최근 소모/부족 + 발주 ──
    const events: TwinEventView[] = [];
    for (const b of recentBurns) {
      const shortage = b.shortfallQty > 0;
      events.push({
        id: `burn-${b._id}`,
        at: new Date(b.tickAt).toISOString(),
        type: shortage ? "SHORTAGE" : "BURN",
        materialCode: codeOf(b.materialId),
        materialName: nameOf(b.materialId),
        text: shortage
          ? `${nameOf(b.materialId)} 부족 ${Math.round(b.shortfallQty).toLocaleString("ko-KR")} — 재주문 필요`
          : `${nameOf(b.materialId)} 소모 ${Math.round(b.burnedQty).toLocaleString("ko-KR")}`,
        reactedBy: shortage ? "PROCUREMENT" : null,
      });
    }
    for (const po of recentPOs) {
      const received = po.status === "RECEIVED";
      events.push({
        id: `po-${po._id}-${po.status}`,
        at: new Date(received ? po.etaAt : po.orderedAt).toISOString(),
        type: received ? "PO_RECEIVED" : "PO_ORDERED",
        materialCode: codeOf(po.materialId),
        materialName: nameOf(po.materialId),
        text: received
          ? `${nameOf(po.materialId)} 입고 도착 +${Math.round(po.qty).toLocaleString("ko-KR")}`
          : `${nameOf(po.materialId)} 발주 ${Math.round(po.qty).toLocaleString("ko-KR")} (ETA ${new Date(po.etaAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })})`,
        reactedBy: received ? "LOGISTICS" : "PROCUREMENT",
      });
    }
    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    const view: ControlTowerView = {
      generatedAt: now.toISOString(),
      heartbeat: {
        status: state?.status ?? "PAUSED",
        lastTickAt: state?.lastTickAt ? new Date(state.lastTickAt).toISOString() : null,
        tickIntervalMs: state?.tickIntervalMs ?? 5000,
        totalBurnEvents,
        openPOs: openPOs.length,
      },
      agents,
      events: events.slice(0, 18),
    };

    return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "관제탑 데이터를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
