import { randomUUID } from "crypto";
import { collections } from "@/lib/db";
import type { WaferLotDoc, WaferLotStepEventDoc, WaferLotStepTriggerType, RouteMasterDoc, RouteMasterNode } from "@/lib/db";
import type { FabId } from "@/lib/fab-domain";
import type { Product } from "@/lib/db";
import { getRouteMaster, getRouteMasterById, expandRouteMaster, type RouteVisit } from "@/lib/route-master";
import type { StepConsumption } from "@/lib/twin/burn";
import { M20_PRODUCTION_SCENARIOS, targetWipCount } from "@/lib/fab-scenario";
import { getProductionConfig } from "@/lib/fab-production-config";
import {
  FOUP_WIP_BOOTSTRAP_VERSION,
  FOUP_WIP_DWELL_MODEL,
  M20_DOWNSTREAM_WIP_EQUIVALENT,
} from "@/lib/foup-wip-model";

export const FOUP_CODES = Array.from({ length: 12 }, (_, i) => `FOUP-${String(i + 1).padStart(2, "0")}`);

// MES 텔레메트리가 아직 없어서, 폴링될 때마다 "마지막 스텝 이후 이만큼 지났으면 다음 스텝으로 진행"하는 방식으로
// 자동 진행을 흉내낸다. 실제 설비 신호가 붙으면 이 타이머 대신 MES_TELEMETRY 이벤트가 들어오면 된다.
// 실제 웨이퍼 투입→패키징 완료는 약 3~4개월인데 HBM4 12-Hi V2 140스텝을 5초 간격으로 돌리면 약 11.7분 — 약 1.1만~1.5만배 배속 타임랩스다.
// 균등 배분 가정이라 정밀한 시간 비례는 아님. 자세한 근거는 docs/route-master.md의 "시뮬레이션 배속 가정" 참고.
export const AUTO_ADVANCE_INTERVAL_MS = 5_000;

// 생산 기준의 단일 출처는 fab-master/M20_PRODUCTION_SCENARIOS다.
export const M20_CYCLE_DAYS = M20_PRODUCTION_SCENARIOS.NORMAL.cycleTimeDays;

export type LotRouteState = {
  lot: WaferLotDoc;
  nodes: RouteMasterNode[]; // routeMaster 노드 목록 (V2는 15개 operation 세그먼트)
  totalSteps: number;
  currentStepIndex: number; // 다음에 완료해야 할(=아직 안 끝난) 스텝의 절대 순번
  currentVisit: RouteVisit | null; // isDone이면 null
  nextVisit: RouteVisit | null;
  isDone: boolean;
  history: WaferLotStepEventDoc[];
};

async function getLotRouteMaster(lot: WaferLotDoc): Promise<RouteMasterDoc> {
  const routeMaster = await getRouteMasterById(lot.routeMasterId) ?? await getRouteMaster(lot.fabId, lot.product);
  if (!routeMaster) throw new Error(`routeMaster가 없습니다: ${lot.routeMasterId}`);
  return routeMaster;
}

export async function getOrCreateActiveLot(fabId: FabId, product: Product, foupCode: string, actorId: string): Promise<WaferLotDoc> {
  const { waferLots } = await collections();
  const existing = await waferLots.findOne({ fabId, product, foupCode, status: "IN_PROGRESS" }, { sort: { createdAt: -1 } });
  if (existing) return existing;
  const routeMaster = await getRouteMaster(fabId, product);
  if (!routeMaster) throw new Error(`활성 routeMaster가 없습니다: ${fabId}:${product}`);
  const now = new Date();
  const doc: WaferLotDoc = {
    _id: `WLOT:${fabId}:${product}:${foupCode}:${now.getTime()}`,
    fabId,
    product,
    routeMasterId: routeMaster._id,
    foupCode,
    status: "IN_PROGRESS",
    createdBy: actorId,
    createdAt: now,
    updatedAt: now,
  };
  await waferLots.insertOne(doc);
  return doc;
}

// 레거시 시뮬레이션/검증용 진입점. FOUP-01~12 활성 로트를 보장한 뒤 자동 진행한다.
// HTTP GET에서는 호출하지 않는다. 조회가 공정 진행이나 작업지시 생성을 유발하면 안 된다.
export async function listActiveLotStates(fabId: FabId, product: Product, actorId: string): Promise<LotRouteState[]> {
  const lots = await Promise.all(FOUP_CODES.map((foupCode) => getOrCreateActiveLot(fabId, product, foupCode, actorId)));
  await Promise.all(lots.map((lot) => autoAdvanceIfDue(lot._id, actorId)));
  return Promise.all(lots.map((lot) => getLotRouteState(lot._id)));
}

// 운영 조회 전용: 로트를 생성하거나 공정 스텝을 진행하지 않고 현재 활성 로트만 반환한다.
export async function listExistingActiveLotStates(fabId: FabId, product: Product): Promise<LotRouteState[]> {
  const { waferLots } = await collections();
  const lots = await waferLots.find({
    fabId,
    product,
    foupCode: { $in: FOUP_CODES },
    status: "IN_PROGRESS",
  }).sort({ foupCode: 1, createdAt: -1 }).toArray();

  const latestByFoup = new Map<string, WaferLotDoc>();
  for (const lot of lots) {
    if (!latestByFoup.has(lot.foupCode)) latestByFoup.set(lot.foupCode, lot);
  }
  return Promise.all([...latestByFoup.values()].map((lot) => getLotRouteState(lot._id)));
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
    operationCode: visit.operationCode,
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

  return getLotRouteState(lotId);
}

export type AggregateWipSummary = {
  targetWip: number;
  currentWip: number;
  aggregateWip: number;
  visualWip: number;
  occupiedTarget: number;
  downstreamWipEquivalent: number;
  downstreamStatus: "NOT_BOOTSTRAPPED";
  unit: "FOUP_EQUIVALENT";
};

// 조회 전용 집계. VISUAL 12개는 전체 WIP 안의 추적 표본이므로 AGGREGATE에 더해 목표치를 초과 생성하지 않는다.
export async function getAggregateWipSummary(fabId: FabId, product: Product): Promise<AggregateWipSummary> {
  const cfg = getProductionConfig(fabId, product);
  if (!cfg) {
    return {
      targetWip: 0, currentWip: 0, aggregateWip: 0, visualWip: 0,
      occupiedTarget: 0, downstreamWipEquivalent: 0, downstreamStatus: "NOT_BOOTSTRAPPED",
      unit: "FOUP_EQUIVALENT",
    };
  }

  const { waferLots } = await collections();
  const targetWip = targetWipCount(cfg.waferStartsPerMonth, cfg.cycleTimeDays);
  const [aggregateWip, visualWip] = await Promise.all([
    waferLots.countDocuments({ fabId, product, cohort: "MODELED_FOUP", status: "IN_PROGRESS" }),
    waferLots.countDocuments({ fabId, product, cohort: "WATCHED", status: "IN_PROGRESS" }),
  ]);
  return {
    targetWip,
    currentWip: aggregateWip + visualWip,
    aggregateWip,
    visualWip,
    occupiedTarget: cfg.targetOccupiedFoup,
    downstreamWipEquivalent: product === "HBM" ? M20_DOWNSTREAM_WIP_EQUIVALENT : 0,
    downstreamStatus: "NOT_BOOTSTRAPPED",
    unit: "FOUP_EQUIVALENT",
  };
}

// Legacy API 호환용 no-op. 실제 FOUP 원장은 versioned bootstrap만 생성할 수 있다.
export async function ensureAggregateWip(fabId: FabId, product: Product, actorId: string): Promise<{ targetWip: number; currentWip: number; created: number }> {
  if (fabId !== "M20" || product !== "HBM") return { targetWip: 0, currentWip: 0, created: 0 };
  void actorId;
  const modeledSummary = await getAggregateWipSummary(fabId, product);
  return { targetWip: modeledSummary.occupiedTarget, currentWip: modeledSummary.currentWip, created: 0 };
}

// tick당 advance 배치 상한은 이제 제품별 config(cfg.advanceBatchMax = targetOccupiedFoup + 2,000)에서
// 가져온다. AUTO_ADVANCE_INTERVAL_MS(5s)가 tick 간격과 같아 만재고에서 전체가 동시에 due가 될 수
// 있으므로, 상한을 목표 재고보다 넉넉히 잡아 특정 스텝에 로트가 뭉치는 정체를 막는다(Day-N 발견).

// tick 간격과 AUTO_ADVANCE_INTERVAL_MS가 같아서(둘 다 5s), 한 번이라도 같은 tick에 같이
// 처리된 로트들은 그 순간부터 영원히 동기화된 채로 움직인다 — 자재 소모/발주가 tick마다
// 거대하게 몰려 창고가 넘치는 원인이었다(Day-N 발견). 매 advance/release마다 소확률로
// 정확히 한 tick 더 미뤄서, 뭉친 무리가 시간이 지나면서 서서히 흩어지게 한다.
// 확률을 낮게 유지하는 이유: 평균 처리량(목표 생산속도)을 크게 해치지 않기 위해서다.
export const DESYNC_EXTRA_DELAY_CHANCE = 0.15;

export function jitteredLastEventAt(now: Date, intervalMs: number, rand: number): Date {
  return rand < DESYNC_EXTRA_DELAY_CHANCE ? new Date(now.getTime() + intervalMs) : now;
}

// 이자재(MATERIALS)가 COVERAGE_CRITICAL로 판단한 자재를 다음 스텝에서 쓰는 로트인지 확인한다.
// true면 advanceAggregateWip가 그 로트의 진행을 막는다 — "자재 없이 공정을 통과한" 물리적
// 모순 없이 WIP 진행(최생산 도메인)과 자재 소모(이자재 도메인)를 한 지점에서 같이 게이팅한다.
export function isLotMaterialBlocked(
  fromStep: number,
  stepConsumption: StepConsumption,
  blockedMaterialIds: ReadonlySet<string>,
): boolean {
  if (blockedMaterialIds.size === 0) return false;
  const consumers = stepConsumption.get(fromStep);
  if (!consumers) return false;
  return consumers.some((c) => blockedMaterialIds.has(c.materialId));
}

// AGGREGATE 코호트를 벌크로 한 스텝씩 진행시킨다. VISUAL 코호트(advanceLotStep)와 달리
// waferLotStepEvents를 쓰지 않고, P10 package operation 진입 시에도 createM20PilotWorkOrder를 절대 호출하지 않는다
// (자재 소비 트리거는 여전히 VISUAL 12개 전용 스코프).
export async function advanceAggregateWip(
  fabId: FabId,
  product: Product,
  gating?: { stepConsumption: StepConsumption; blockedMaterialIds: ReadonlySet<string>; finishedGoodsCapacityOver?: boolean },
): Promise<{ advanced: number; completed: number; completedWaferQty: number; blocked: number; advancedFromStepIndex: Record<number, number> }> {
  const empty = { advanced: 0, completed: 0, completedWaferQty: 0, blocked: 0, advancedFromStepIndex: {} };
  const cfg = getProductionConfig(fabId, product);
  if (!cfg) return empty;

  const { waferLots } = await collections();
  const routeMaster = await getRouteMaster(fabId, product);
  if (!routeMaster) return empty;
  const visits = expandRouteMaster(routeMaster);
  const totalSteps = visits.length;
  if (totalSteps === 0) return empty;

  // 라이브 WIP 원장은 MODELED_FOUP 코호트로 만들어지는데, 진행기가 옛 이름 AGGREGATE만
  // 조회해 실제로는 아무 로트도 진행·소모되지 않던 버그(Day15 발견). 두 코호트 모두 진행한다.
  // 밀릴 때는 가장 오래 밀린 로트부터 처리해 특정 로트가 계속 굶지 않게 한다(FIFO 공정성).
  const due = await waferLots.find({
    fabId, product, cohort: { $in: ["AGGREGATE", "MODELED_FOUP"] }, status: "IN_PROGRESS",
    lastEventAt: { $lte: new Date(Date.now() - AUTO_ADVANCE_INTERVAL_MS) },
  }).sort({ lastEventAt: 1 }).limit(cfg.advanceBatchMax).toArray();
  if (due.length === 0) return empty;

  const now = new Date();
  let completed = 0;
  let completedWaferQty = 0;
  let advanced = 0;
  let blocked = 0;
  const advancedFromStepIndex: Record<number, number> = {};
  const ops = due.map((lot) => {
    const fromStep = lot.currentStepIndex ?? 0;
    const nextStep = fromStep + 1;
    const isDone = nextStep >= totalSteps;
    const materialBlocked = Boolean(gating && isLotMaterialBlocked(fromStep, gating.stepConsumption, gating.blockedMaterialIds));
    // 박물류(LOGISTICS)가 완제품 창고를 CAPACITY_OVER로 판정하면, 이번 스텝으로 완제품이 될
    // 로트는 자재차단과 같은 방식으로 멈춘다 — 안 그러면 갈 곳 없는 완제품이 계속 쌓인다.
    const fgHeld = isDone && gating?.finishedGoodsCapacityOver === true;
    if (materialBlocked || fgHeld) {
      // 진행은 안 시키되, lastEventAt은 갱신해서 FIFO 대기열 선두를 영구 점유하지 않게 한다
      // (안 그러면 오늘 낮 겪은 배치상한 정체 버그가 재발한다). 최초 차단 시각은 보존한다.
      blocked++;
      const setFields: Record<string, Date> = {
        lastEventAt: jitteredLastEventAt(now, AUTO_ADVANCE_INTERVAL_MS, Math.random()),
        updatedAt: now,
      };
      if (materialBlocked) setFields.materialBlockedAt = lot.materialBlockedAt ?? now;
      if (fgHeld) setFields.finishedGoodsHoldAt = lot.finishedGoodsHoldAt ?? now;
      return {
        updateOne: {
          filter: { _id: lot._id, lastEventAt: lot.lastEventAt },
          update: { $set: setFields },
        },
      };
    }
    advanced++;
    advancedFromStepIndex[fromStep] = (advancedFromStepIndex[fromStep] ?? 0) + (lot.waferQty ?? 25);
    if (isDone) { completed++; completedWaferQty += lot.waferQty ?? 25; }
    const nextNodeId = isDone ? visits[totalSteps - 1].nodeId : visits[nextStep].nodeId;
    return {
      updateOne: {
        filter: { _id: lot._id, lastEventAt: lot.lastEventAt },
        update: {
          $set: {
            currentStepIndex: isDone ? totalSteps : nextStep, currentNodeId: nextNodeId,
            lastEventAt: jitteredLastEventAt(now, AUTO_ADVANCE_INTERVAL_MS, Math.random()),
            updatedAt: now, status: isDone ? "DONE" as const : "IN_PROGRESS" as const,
          },
          $unset: { materialBlockedAt: "" as const, finishedGoodsHoldAt: "" as const },
        },
      },
    };
  });
  await waferLots.bulkWrite(ops, { ordered: false });
  return { advanced, completed, completedWaferQty, blocked, advancedFromStepIndex };
}

// MODELED_FOUP 코호트는 bootstrap이 한 번 채워놓은 유한 풀이라 advanceAggregateWip가
// 다 진행시키고 나면(전부 DONE) 재투입 로직 없이는 WIP이 영구히 0에서 멈춘다(Day20 발견 —
// tick은 계속 돌아 lastTickAt은 갱신되는데 burn/PO가 5일간 정지). dailyRate(M20_DAILY_LOT_RELEASE,
// 실제 하루 배출 목표)를 tick당 sim-day로 환산해 완료분만큼 새 로트를 step 0으로 계속 투입한다.
export function computeAggregateReleasePlan(input: {
  dailyRate: number;
  simDays: number;
  carry: number;
  currentOccupied: number;
  targetOccupied: number;
}): { releaseCount: number; nextCarry: number } {
  // 부동소수점 누적 오차(예: 0.3을 10번 더해도 정확히 3.0이 안 됨) 방어용 반올림.
  const raw = Math.round((input.carry + input.dailyRate * input.simDays) * 1e9) / 1e9;
  const wanted = Math.floor(raw);
  const room = Math.max(0, input.targetOccupied - input.currentOccupied);
  const releaseCount = Math.min(wanted, room);
  // room에 막혀 못 나간 정수분은 버린다 — 안 그러면 room이 열렸을 때 몰아서 폭증 방출된다.
  // 소수부(raw - wanted)만 이월해 장기 배출 속도가 dailyRate에 정확히 수렴하게 한다.
  const nextCarry = raw - wanted;
  return { releaseCount, nextCarry };
}

export async function releaseAggregateWip(
  fabId: FabId,
  product: Product,
  now: Date,
  simDays: number,
  carry: number,
): Promise<{ released: number; nextCarry: number }> {
  const cfg = getProductionConfig(fabId, product);
  if (!cfg) return { released: 0, nextCarry: carry };

  const { waferLots } = await collections();
  const routeMaster = await getRouteMaster(fabId, product);
  if (!routeMaster) return { released: 0, nextCarry: carry };
  const visits = expandRouteMaster(routeMaster);
  if (visits.length === 0) return { released: 0, nextCarry: carry };

  const currentOccupied = await waferLots.countDocuments({
    fabId, product, cohort: { $in: ["AGGREGATE", "MODELED_FOUP"] }, status: "IN_PROGRESS",
  });
  const { releaseCount, nextCarry } = computeAggregateReleasePlan({
    dailyRate: cfg.dailyLotRelease, simDays, carry, currentOccupied, targetOccupied: cfg.targetOccupiedFoup,
  });
  if (releaseCount <= 0) return { released: 0, nextCarry };

  const firstVisit = visits[0];
  const docs: WaferLotDoc[] = Array.from({ length: releaseCount }, () => {
    const id = randomUUID();
    return {
      _id: `WLOT-${fabId}-AUTO-${now.getTime()}-${id}`,
      fabId, product, routeMasterId: routeMaster._id,
      foupCode: `FOUP-${fabId}-AUTO-${id}`,
      status: "IN_PROGRESS",
      createdBy: "TWIN_AUTO_RELEASE",
      createdAt: now, updatedAt: now,
      cohort: "MODELED_FOUP",
      currentStepIndex: 0,
      currentNodeId: firstVisit.nodeId,
      lastEventAt: jitteredLastEventAt(now, AUTO_ADVANCE_INTERVAL_MS, Math.random()),
      waferQty: cfg.wafersPerFoup,
      watched: false,
      source: "MODELED_BASELINE",
      bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION,
      modeledReleaseAt: now,
      dwellModel: FOUP_WIP_DWELL_MODEL,
    };
  });
  await waferLots.insertMany(docs, { ordered: false });
  return { released: releaseCount, nextCarry };
}
