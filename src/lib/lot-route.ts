import { collections } from "@/lib/db";
import type { WaferLotDoc, WaferLotStepEventDoc, WaferLotStepTriggerType, RouteMasterDoc, RouteMasterNode } from "@/lib/db";
import type { FabId } from "@/lib/fab-domain";
import type { Product } from "@/lib/db";
import { getRouteMaster, expandRouteMaster, type RouteVisit } from "@/lib/route-master";
import { createM20PilotWorkOrder } from "@/lib/m20-agent-service";

export const FOUP_CODES = Array.from({ length: 12 }, (_, i) => `FOUP-${String(i + 1).padStart(2, "0")}`);

// MES 텔레메트리가 아직 없어서, 폴링될 때마다 "마지막 스텝 이후 이만큼 지났으면 다음 스텝으로 진행"하는 방식으로
// 자동 진행을 흉내낸다. 실제 설비 신호가 붙으면 이 타이머 대신 MES_TELEMETRY 이벤트가 들어오면 된다.
// 실제 웨이퍼 투입→패키징 완료는 약 3~4개월인데 130스텝을 5초 간격으로 돌리면 약 10.8분 — 약 1.2만~1.6만배 배속 타임랩스다.
// 균등 배분 가정이라 정밀한 시간 비례는 아님. 자세한 근거는 docs/route-master.md의 "시뮬레이션 배속 가정" 참고.
export const AUTO_ADVANCE_INTERVAL_MS = 5_000;

export type LotRouteState = {
  lot: WaferLotDoc;
  nodes: RouteMasterNode[]; // routeMaster 노드 목록 (9노드 세그먼트 표시용)
  totalSteps: number;
  currentStepIndex: number; // 다음에 완료해야 할(=아직 안 끝난) 스텝의 절대 순번
  currentVisit: RouteVisit | null; // isDone이면 null
  nextVisit: RouteVisit | null;
  isDone: boolean;
  history: WaferLotStepEventDoc[];
};

async function getLotRouteMaster(lot: WaferLotDoc): Promise<RouteMasterDoc> {
  const routeMaster = await getRouteMaster(lot.fabId, lot.product);
  if (!routeMaster) throw new Error(`routeMaster가 없습니다: ${lot.routeMasterId}`);
  return routeMaster;
}

export async function getOrCreateActiveLot(fabId: FabId, product: Product, foupCode: string, actorId: string): Promise<WaferLotDoc> {
  const { waferLots } = await collections();
  const existing = await waferLots.findOne({ fabId, product, foupCode, status: "IN_PROGRESS" }, { sort: { createdAt: -1 } });
  if (existing) return existing;
  const now = new Date();
  const doc: WaferLotDoc = {
    _id: `WLOT:${fabId}:${product}:${foupCode}:${now.getTime()}`,
    fabId,
    product,
    routeMasterId: `${fabId}:${product}`,
    foupCode,
    status: "IN_PROGRESS",
    createdBy: actorId,
    createdAt: now,
    updatedAt: now,
  };
  await waferLots.insertOne(doc);
  return doc;
}

// FOUP-01~12 전부 활성 로트를 보장하고(없으면 새 웨이퍼 25장으로 재시작), 12개 상태를 한번에 반환.
// 조회할 때마다 "타이머상 다음 스텝이 도래한" 로트는 MES_TELEMETRY로 자동 진행시킨다 (운영자 수동 확인 버튼과 병행).
export async function listActiveLotStates(fabId: FabId, product: Product, actorId: string): Promise<LotRouteState[]> {
  const lots = await Promise.all(FOUP_CODES.map((foupCode) => getOrCreateActiveLot(fabId, product, foupCode, actorId)));
  await Promise.all(lots.map((lot) => autoAdvanceIfDue(lot._id, actorId)));
  return Promise.all(lots.map((lot) => getLotRouteState(lot._id)));
}

async function autoAdvanceIfDue(lotId: string, actorId: string): Promise<void> {
  const state = await getLotRouteState(lotId);
  if (state.isDone) return;
  const lastEventAt = state.history.at(-1)?.completedAt ?? state.lot.createdAt;
  if (Date.now() - new Date(lastEventAt).getTime() < AUTO_ADVANCE_INTERVAL_MS) return;
  try {
    await advanceLotStep(lotId, actorId, `${lotId}:AUTO:${state.currentStepIndex}`, "MES_TELEMETRY");
  } catch {
    // 동시 폴링 등으로 인한 경합은 다음 주기에 자연히 해소된다.
  }
}

export async function getLotRouteState(lotId: string): Promise<LotRouteState> {
  const { waferLots, waferLotStepEvents } = await collections();
  const lot = await waferLots.findOne({ _id: lotId });
  if (!lot) throw new Error("로트를 찾을 수 없습니다.");
  const routeMaster = await getLotRouteMaster(lot);
  const visits = expandRouteMaster(routeMaster);
  const history = await waferLotStepEvents.find({ lotId }).sort({ stepIndex: 1 }).toArray();
  const completedCount = history.filter((event) => event.completedAt).length;
  const currentStepIndex = completedCount;
  const isDone = currentStepIndex >= visits.length;
  return {
    lot,
    nodes: routeMaster.nodes,
    totalSteps: visits.length,
    currentStepIndex,
    currentVisit: isDone ? null : visits[currentStepIndex],
    nextVisit: !isDone && currentStepIndex + 1 < visits.length ? visits[currentStepIndex + 1] : null,
    isDone,
    history,
  };
}

export async function advanceLotStep(lotId: string, actorId: string, idempotencyKey: string, triggerType: WaferLotStepTriggerType = "OPERATOR_CONFIRM"): Promise<LotRouteState> {
  const { waferLots, waferLotStepEvents } = await collections();
  const existingEvent = await waferLotStepEvents.findOne({ idempotencyKey });
  if (existingEvent) return getLotRouteState(lotId);

  const lot = await waferLots.findOne({ _id: lotId });
  if (!lot) throw new Error("로트를 찾을 수 없습니다.");
  if (lot.status === "DONE") throw new Error("이미 완료된 로트입니다.");

  const routeMaster = await getLotRouteMaster(lot);
  const visits = expandRouteMaster(routeMaster);
  const history = await waferLotStepEvents.find({ lotId }).sort({ stepIndex: 1 }).toArray();
  const currentStepIndex = history.filter((event) => event.completedAt).length;
  if (currentStepIndex >= visits.length) throw new Error("이미 마지막 스텝을 완료했습니다.");

  const visit = visits[currentStepIndex];
  const now = new Date();
  const event: WaferLotStepEventDoc = {
    _id: `${lotId}:${visit.stepIndex}`,
    lotId,
    nodeId: visit.nodeId,
    processCode: visit.processCode,
    stepIndex: visit.stepIndex,
    visitIndex: visit.visitIndex,
    enteredAt: now,
    completedAt: now,
    triggeredBy: { type: triggerType, actorId },
    idempotencyKey,
  };
  await waferLotStepEvents.insertOne(event);

  const isNowDone = currentStepIndex + 1 >= visits.length;
  await waferLots.updateOne({ _id: lotId }, { $set: { status: isNowDone ? "DONE" : "IN_PROGRESS", updatedAt: now } });

  // 패키징 노드에 처음 진입하는 순간 = 실제 자재(PKG-001) 소비가 필요해지는 시점.
  // M20 파일럿 워크오더를 새로 하나 만들어서(자재 준비 상태와 웨이퍼 라우팅 위치를 분리한 채로) WMS 소비 사이클을 트리거한다.
  // 워크오더 생성은 기존 /api/mes/workorders POST가 이미 하듯 orchestrateM20Agents를 자동 호출한다.
  if (lot.fabId === "M20" && lot.product === "HBM" && visit.nodeId === "packaging" && visit.visitIndex === 0) {
    try {
      await createM20PilotWorkOrder(actorId, `WLOT-PACKAGING:${lotId}:${visit.stepIndex}`, { lotId, foupCode: lot.foupCode });
    } catch {
      // 소비 사이클 생성 실패가 웨이퍼 라우팅 확인 자체를 막으면 안 됨 — 다음 조회 때 운영자가 별도로 재시도할 수 있다.
    }
  }

  return getLotRouteState(lotId);
}
