import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections } from "@/lib/db";
import { M20_MATERIAL_CONSUMPTION } from "@/lib/material-consumption";
import { getControlTowerAIEnabled, getLatestControlTowerAIEpisode } from "@/lib/control-tower-episode-server";
import { CONTROL_TOWER_AI_MODEL } from "@/lib/control-tower-openai-server";
import { getWarehouseCapacity } from "@/lib/queries";
import { buildMaterialsShadow, coverageState, type MaterialSignal } from "@/lib/materials-agent";
import { buildAggregateProductionShadow } from "@/lib/production-agent";
import { buildLogisticsShadow, type WarehouseSignal } from "@/lib/logistics-agent";
import { buildLiveProcurementShadow, shouldAutoApprovePendingOrder, type ProcurementLiveOrderSignal } from "@/lib/procurement-agent";
import {
  CONTROL_TOWER_PERSONAS,
  CONTROL_TOWER_ROLE_ORDER,
  type AgentWatchMetric,
  type ControlTowerAgentView,
  type ControlTowerRole,
  type ControlTowerView,
  type RoleJudgmentView,
  type TwinEventView,
} from "@/lib/control-tower-live";

export const dynamic = "force-dynamic";

// MVP-1: 살아있는 Twin의 심박·소모·발주와 에이전트 판단을 한 화면으로 모으는 읽기 전용 관제탑.
export async function GET() {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  try {
    const now = new Date();
    const { twinEngineState, twinBurnEvents, twinPurchaseOrders, inventory, materials, waferLots } = await collections();
    const materialIds = [...new Set(M20_MATERIAL_CONSUMPTION.map((r) => r.materialId))];

    const [state, matDocs, invDocs, recentBurns, totalBurnEvents, openPOs, pendingOrHeldPOs, recentPOs, wipCount, warehouseCapacity, latestAI, aiEnabled, materialBlockedLotCount, finishedGoodsHoldLotCount] = await Promise.all([
      twinEngineState.findOne({ _id: "singleton" }),
      materials.find({ _id: { $in: materialIds } }).toArray(),
      inventory.find({ materialId: { $in: materialIds } }).toArray(),
      twinBurnEvents.find({}).sort({ tickAt: -1 }).limit(14).toArray(),
      twinBurnEvents.countDocuments(),
      twinPurchaseOrders.find({ status: { $in: ["ORDERED", "IN_TRANSIT"] } }).toArray(),
      // 김구매(PROCUREMENT) 카드가 실제 twin 상태를 서술하는 데 쓴다 — 문서만 세지 않고
      // buildLiveProcurementShadow의 입력으로 그대로 넘긴다(§ 아래).
      twinPurchaseOrders.find({ status: { $in: ["PENDING_APPROVAL", "INBOUND_HOLD"] } }).toArray(),
      twinPurchaseOrders.find({}).sort({ orderedAt: -1 }).limit(8).toArray(),
      waferLots.countDocuments({ fabId: "M20", product: "HBM", cohort: { $in: ["AGGREGATE", "MODELED_FOUP"] }, status: "IN_PROGRESS" }),
      getWarehouseCapacity(),
      getLatestControlTowerAIEpisode(),
      getControlTowerAIEnabled(),
      // K1: 최생산 판단은 legacy workOrders(M20_PILOT, /mes 폐기 후 정지)가 아니라 advanceAggregateWip이
      // 실제로 쓰는 라이브 신호(waferLots 집계)로 계산한다.
      waferLots.countDocuments({ fabId: "M20", product: "HBM", materialBlockedAt: { $exists: true } }),
      waferLots.countDocuments({ fabId: "M20", product: "HBM", finishedGoodsHoldAt: { $exists: true } }),
    ]);

    const matById = new Map(matDocs.map((m) => [m._id, m]));
    // pendingOrHeldPOs는 M20 소비 자재(materialIds) 밖의 자재를 참조할 수 있다(DRAM/NAND 전용
    // 자재 등) — matById에 없으면 별도로 채워서 이름·코드가 materialId로 깨져 보이지 않게 한다.
    const missingMaterialIds = [...new Set(pendingOrHeldPOs.map((po) => po.materialId))].filter((id) => !matById.has(id));
    if (missingMaterialIds.length > 0) {
      for (const m of await materials.find({ _id: { $in: missingMaterialIds } }).toArray()) matById.set(m._id, m);
    }
    const nameOf = (id: string) => matById.get(id)?.name ?? id;
    const codeOf = (id: string) => matById.get(id)?.code ?? id;

    const procurementSignals: ProcurementLiveOrderSignal[] = pendingOrHeldPOs.map((po) => ({
      materialId: po.materialId,
      materialCode: codeOf(po.materialId),
      materialName: nameOf(po.materialId),
      unit: matById.get(po.materialId)?.unit ?? "",
      qty: po.qty,
      status: po.status as "PENDING_APPROVAL" | "INBOUND_HOLD",
      waitingMinutes: (now.getTime() - po.orderedAt.getTime()) / 60_000,
      autonomyReason: po.autonomyReason ?? null,
    }));
    const pendingApprovalCount = procurementSignals.filter((s) => s.status === "PENDING_APPROVAL").length;
    const urgentApprovalCount = procurementSignals.filter((s) => s.status === "PENDING_APPROVAL" && shouldAutoApprovePendingOrder(s.waitingMinutes)).length;
    const inboundHoldCount = procurementSignals.filter((s) => s.status === "INBOUND_HOLD").length;

    // 자재별 대표 재고(최대 수량) 선택
    const invByMat = new Map<string, { quantity: number; avgDailyBurn: number }>();
    for (const d of invDocs) {
      const prev = invByMat.get(d.materialId);
      if (!prev || d.quantity > prev.quantity) invByMat.set(d.materialId, { quantity: d.quantity, avgDailyBurn: d.avgDailyBurn ?? 0 });
    }

    // MATERIALS 관측 신호: ROP 미만 자재 수 + 최저 커버리지 + 규칙엔진 입력 신호
    let belowRop = 0;
    let lowestCoverage: { code: string; days: number } | null = null;
    const materialSignals: MaterialSignal[] = [];
    for (const id of materialIds) {
      const inv = invByMat.get(id);
      const mat = matById.get(id);
      if (!inv || !mat) continue;
      const rop = inv.avgDailyBurn * mat.ropDays;
      if (inv.avgDailyBurn > 0 && inv.quantity < rop) belowRop += 1;
      const coverageDays = inv.avgDailyBurn > 0 ? inv.quantity / inv.avgDailyBurn : null;
      if (coverageDays !== null && (!lowestCoverage || coverageDays < lowestCoverage.days)) {
        lowestCoverage = { code: mat.code, days: coverageDays };
      }
      materialSignals.push({
        materialId: id, code: mat.code, name: mat.name, unit: mat.unit,
        ropDays: mat.ropDays, quantity: inv.quantity, dailyBurn: inv.avgDailyBurn, coverageDays,
        state: coverageState(inv.quantity, inv.avgDailyBurn, mat.ropDays),
      });
    }

    const inTransitQty = openPOs.reduce((s, po) => s + po.qty, 0);

    // ── 네 역할 실제 판단(규칙엔진, 실제 twin 상태 기반 — 가정법 없음) ──
    const nowIso = now.toISOString();
    const procurementShadow = buildLiveProcurementShadow(procurementSignals, nowIso);

    const materialsShadow = buildMaterialsShadow(materialSignals, nowIso);
    const productionShadow = buildAggregateProductionShadow(
      { fabId: "M20", inProgressCount: wipCount, materialBlockedCount: materialBlockedLotCount, finishedGoodsHoldCount: finishedGoodsHoldLotCount },
      nowIso,
    );
    const warehouseSignals: WarehouseSignal[] = warehouseCapacity.map((wh) => ({
      code: wh.code, name: wh.name, utilization: wh.utilization, legalUtilization: wh.legalUtilization,
      capacityMode: wh.capacityMode,
    }));
    const logisticsShadow = buildLogisticsShadow(warehouseSignals, openPOs.length, nowIso);

    const judgmentByRole: Record<ControlTowerRole, RoleJudgmentView> = {
      PROCUREMENT: {
        scenarioLabel: procurementShadow.scenarioLabel,
        top: procurementShadow.top ? {
          code: procurementShadow.top.code, name: procurementShadow.top.name,
          verdict: procurementShadow.top.verdict, verdictText: procurementShadow.top.verdictText,
          voice: procurementShadow.top.verdictText, voiceSource: "FALLBACK",
        } : null,
      },
      MATERIALS: {
        scenarioLabel: materialsShadow.scenarioLabel,
        top: materialsShadow.top ? {
          code: materialsShadow.top.code, name: materialsShadow.top.name,
          verdict: materialsShadow.top.verdict, verdictText: materialsShadow.top.verdictText,
          voice: materialsShadow.top.verdictText, voiceSource: "FALLBACK",
        } : null,
      },
      PRODUCTION: {
        scenarioLabel: productionShadow.scenarioLabel,
        top: productionShadow.top ? {
          code: productionShadow.top.code, name: productionShadow.top.name,
          verdict: productionShadow.top.verdict, verdictText: productionShadow.top.verdictText,
          voice: productionShadow.top.verdictText, voiceSource: "FALLBACK",
        } : null,
      },
      LOGISTICS: {
        scenarioLabel: logisticsShadow.scenarioLabel,
        top: logisticsShadow.top ? {
          code: logisticsShadow.top.code, name: logisticsShadow.top.name,
          verdict: logisticsShadow.top.verdict, verdictText: logisticsShadow.top.verdictText,
          voice: logisticsShadow.top.verdictText, voiceSource: "FALLBACK",
        } : null,
      },
    };

    const watching: Record<string, AgentWatchMetric[]> = {
      PROCUREMENT: [
        { label: "승인 대기", value: `${procurementShadow.summary.pendingApproval}건`, tone: procurementShadow.summary.pendingApproval > 0 ? "warn" : "normal" },
        { label: "긴급(60분+, 자동승인)", value: `${procurementShadow.summary.urgent}건`, tone: procurementShadow.summary.urgent > 0 ? "critical" : "normal" },
        { label: "입고 보류", value: `${procurementShadow.summary.inboundHeld}건`, tone: procurementShadow.summary.inboundHeld > 0 ? "critical" : "normal" },
      ],
      MATERIALS: [
        { label: "ROP 미만 자재", value: `${belowRop}종`, tone: belowRop > 0 ? "warn" : "normal" },
        { label: "최저 커버리지", value: lowestCoverage ? `${lowestCoverage.code} ${lowestCoverage.days.toFixed(1)}일` : "—", tone: lowestCoverage && lowestCoverage.days < 5 ? "critical" : "normal" },
        { label: "추적 자재", value: `${materialIds.length}종` },
      ],
      PRODUCTION: [
        { label: "진행 중 WIP", value: `${wipCount.toLocaleString("ko-KR")} FOUP` },
        { label: "자재차단", value: `${materialBlockedLotCount.toLocaleString("ko-KR")}건`, tone: materialBlockedLotCount > 0 ? "critical" : "normal" },
        { label: "완제품창고 차단", value: `${finishedGoodsHoldLotCount.toLocaleString("ko-KR")}건`, tone: finishedGoodsHoldLotCount > 0 ? "warn" : "normal" },
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
        consciousness: p.consciousness, judgmentMode: p.judgmentMode, roadmapNote: p.roadmapNote,
        watching: watching[role] ?? [],
        judgment: judgmentByRole[role],
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
        pendingApprovalPOs: pendingApprovalCount,
        urgentApprovalPOs: urgentApprovalCount,
        inboundHoldPOs: inboundHoldCount,
        materialBlockedLots: materialBlockedLotCount,
      },
      ai: {
        configured: Boolean(process.env.OPENAI_API_KEY),
        enabled: aiEnabled,
        model: CONTROL_TOWER_AI_MODEL,
        episode: latestAI,
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
