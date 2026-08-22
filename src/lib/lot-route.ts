import { randomUUID } from "crypto";
import { collections } from "@/lib/db";
import type { WaferLotDoc, WaferLotStepEventDoc, WaferLotStepTriggerType, RouteMasterDoc, RouteMasterNode } from "@/lib/db";
import type { FabId } from "@/lib/fab-domain";
import type { Product } from "@/lib/db";
import { getRouteMaster, getRouteMasterById, expandRouteMaster, type RouteVisit } from "@/lib/route-master";
import type { StepConsumption } from "@/lib/twin/burn";
import { M20_PRODUCTION_SCENARIOS, targetWipCount } from "@/lib/fab-scenario";
import { getProductionConfig } from "@/lib/fab-production-config";
import { operatingMsToDays } from "@/lib/twin/operating-clock";
import { stableOperatingPhaseMs, stepDwellOperatingMs } from "@/lib/twin/wip-flow";
import type { AnyBulkWriteOperation } from "mongodb";
import {
  FOUP_WIP_BOOTSTRAP_VERSION,
  FOUP_WIP_DWELL_MODEL,
  M20_DOWNSTREAM_WIP_EQUIVALENT,
} from "@/lib/foup-wip-model";

export const FOUP_CODES = Array.from({ length: 12 }, (_, i) => `FOUP-${String(i + 1).padStart(2, "0")}`);

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

// 레거시 시뮬레이션/검증용 진입점. FOUP-01~12 활성 로트만 보장하고 조회한다.
// 조회가 공정 진행이나 작업지시 생성을 유발하지 않도록 자동 진행은 하지 않는다.
export async function listActiveLotStates(fabId: FabId, product: Product, actorId: string): Promise<LotRouteState[]> {
  const lots = await Promise.all(FOUP_CODES.map((foupCode) => getOrCreateActiveLot(fabId, product, foupCode, actorId)));
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

  const { waferLots, wipStepBuckets } = await collections();
  const targetWip = targetWipCount(cfg.waferStartsPerMonth, cfg.cycleTimeDays);
  // STEP_BUCKET(DRAM/NAND)은 개별 waferLots가 없고 step별 count 집계로 WIP를 표현한다.
  if (cfg.wipMode === "STEP_BUCKET") {
    const bucket = await wipStepBuckets.findOne({ _id: `${fabId}__${product}` });
    const aggregateWip = bucket ? bucket.counts.reduce((s, c) => s + c, 0) : 0;
    return {
      targetWip, currentWip: aggregateWip, aggregateWip, visualWip: 0,
      occupiedTarget: cfg.targetOccupiedFoup, downstreamWipEquivalent: 0,
      downstreamStatus: "NOT_BOOTSTRAPPED", unit: "FOUP_EQUIVALENT",
    };
  }
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

export type AggregateWipTiming = {
  operatingEpochMs: number;
  elapsedOperatingMs: number;
  recordedAt: Date;
};

type AggregateAdvanceResult = {
  advanced: number;
  completed: number;
  completedWaferQty: number;
  blocked: number;
  advancedFromStepIndex: Record<number, number>;
};

function emptyAggregateAdvance(): AggregateAdvanceResult {
  return { advanced: 0, completed: 0, completedWaferQty: 0, blocked: 0, advancedFromStepIndex: {} };
}

// 기존 M20 로트에는 운영 예정시각이 없다. 현재 운영시각부터 평균 체류시간 사이에 안정적으로
// 분산해 첫 전환 tick의 14K 동시 이동을 막는다. 진행 상태와 감사시각은 바꾸지 않는다.
async function initializeAggregateOperatingSchedules(input: {
  fabId: FabId;
  product: Product;
  operatingEpochMs: number;
  recordedAt: Date;
  stepDwellMs: number;
  limit: number;
}): Promise<number> {
  const { waferLots } = await collections();
  const unscheduled = await waferLots.find({
    fabId: input.fabId,
    product: input.product,
    cohort: { $in: ["AGGREGATE", "MODELED_FOUP"] },
    status: "IN_PROGRESS",
    nextStepOperatingMs: { $exists: false },
  }).limit(input.limit).toArray();
  if (unscheduled.length === 0) return 0;

  const ops: AnyBulkWriteOperation<WaferLotDoc>[] = unscheduled.map((lot) => ({
    updateOne: {
      filter: { _id: lot._id, nextStepOperatingMs: { $exists: false } },
      update: {
        $set: {
          nextStepOperatingMs: input.operatingEpochMs + stableOperatingPhaseMs(lot._id, input.stepDwellMs),
          updatedAt: input.recordedAt,
        },
      },
    },
  }));
  const result = await waferLots.bulkWrite(ops, { ordered: false });
  return result.modifiedCount;
}

// 엔진 관리 M20 로트를 운영 예정시각 순서로 진행한다. VISUAL/WATCHED 코호트와 달리
// waferLotStepEvents나 M20_PILOT 작업지시를 만들지 않는다.
export async function advanceAggregateWip(
  fabId: FabId,
  product: Product,
  timing: AggregateWipTiming,
  gating?: { stepConsumption: StepConsumption; blockedMaterialIds: ReadonlySet<string>; finishedGoodsCapacityOver?: boolean },
): Promise<AggregateAdvanceResult> {
  const empty = emptyAggregateAdvance();
  const cfg = getProductionConfig(fabId, product);
  if (!cfg || cfg.wipMode !== "PER_LOT") return empty;

  const { waferLots } = await collections();
  const routeMaster = await getRouteMaster(fabId, product);
  if (!routeMaster) return empty;
  const visits = expandRouteMaster(routeMaster);
  const totalSteps = visits.length;
  if (totalSteps === 0) return empty;
  const stepDwellMs = stepDwellOperatingMs(cfg.cycleTimeDays, totalSteps);

  await initializeAggregateOperatingSchedules({
    fabId,
    product,
    operatingEpochMs: timing.operatingEpochMs,
    recordedAt: timing.recordedAt,
    stepDwellMs,
    limit: cfg.advanceBatchMax,
  });
  if (timing.elapsedOperatingMs <= 0) return empty;

  const due = await waferLots.find({
    fabId, product, cohort: { $in: ["AGGREGATE", "MODELED_FOUP"] }, status: "IN_PROGRESS",
    nextStepOperatingMs: { $lte: timing.operatingEpochMs },
  }).sort({ nextStepOperatingMs: 1 }).limit(cfg.advanceBatchMax).toArray();
  if (due.length === 0) return empty;

  let completed = 0;
  let completedWaferQty = 0;
  let advanced = 0;
  let blocked = 0;
  const advancedFromStepIndex: Record<number, number> = {};
  const maxStepsPerLot = Math.ceil(timing.elapsedOperatingMs / stepDwellMs) + 1;
  const ops: AnyBulkWriteOperation<WaferLotDoc>[] = due.map((lot) => {
    const originalDue = lot.nextStepOperatingMs as number;
    let nextDue = originalDue;
    let currentStep = lot.currentStepIndex ?? 0;
    let movedSteps = 0;
    let materialHeld = false;
    let finishedGoodsHeld = false;

    while (
      currentStep < totalSteps
      && nextDue <= timing.operatingEpochMs
      && movedSteps < maxStepsPerLot
    ) {
      const fromStep = currentStep;
      const nextStep = fromStep + 1;
      const isDone = nextStep >= totalSteps;
      materialHeld = Boolean(
        gating && isLotMaterialBlocked(fromStep, gating.stepConsumption, gating.blockedMaterialIds),
      );
      finishedGoodsHeld = isDone && gating?.finishedGoodsCapacityOver === true;

      if (materialHeld || finishedGoodsHeld) {
        blocked++;
        nextDue = timing.operatingEpochMs + stepDwellMs;
        break;
      }

      const waferQty = lot.waferQty ?? cfg.wafersPerFoup;
      advanced++;
      movedSteps++;
      advancedFromStepIndex[fromStep] = (advancedFromStepIndex[fromStep] ?? 0) + waferQty;
      currentStep = nextStep;
      nextDue += stepDwellMs;
      if (isDone) {
        completed++;
        completedWaferQty += waferQty;
        break;
      }
    }

    const isDone = currentStep >= totalSteps;
    const nextNodeId = isDone
      ? visits[totalSteps - 1].nodeId
      : visits[currentStep].nodeId;
    const setFields: Partial<WaferLotDoc> = {
      currentStepIndex: currentStep,
      currentNodeId: nextNodeId,
      nextStepOperatingMs: nextDue,
      updatedAt: timing.recordedAt,
      status: isDone ? "DONE" : "IN_PROGRESS",
    };
    if (movedSteps > 0) setFields.lastEventAt = timing.recordedAt;
    if (materialHeld) setFields.materialBlockedAt = lot.materialBlockedAt ?? timing.recordedAt;
    if (finishedGoodsHeld) setFields.finishedGoodsHoldAt = lot.finishedGoodsHoldAt ?? timing.recordedAt;

    const update: Record<string, unknown> = { $set: setFields };
    if (movedSteps > 0 && !materialHeld && !finishedGoodsHeld) {
      update.$unset = { materialBlockedAt: "", finishedGoodsHoldAt: "" };
    }
    return {
      updateOne: {
        filter: { _id: lot._id, nextStepOperatingMs: originalDue },
        update,
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
  timing: AggregateWipTiming,
  carry: number,
): Promise<{ released: number; nextCarry: number }> {
  const cfg = getProductionConfig(fabId, product);
  if (!cfg || cfg.wipMode !== "PER_LOT") return { released: 0, nextCarry: carry };

  const { waferLots } = await collections();
  const routeMaster = await getRouteMaster(fabId, product);
  if (!routeMaster) return { released: 0, nextCarry: carry };
  const visits = expandRouteMaster(routeMaster);
  if (visits.length === 0) return { released: 0, nextCarry: carry };
  const stepDwellMs = stepDwellOperatingMs(cfg.cycleTimeDays, visits.length);
  const elapsedOperatingDays = operatingMsToDays(Math.max(0, timing.elapsedOperatingMs));

  const currentOccupied = await waferLots.countDocuments({
    fabId, product, cohort: { $in: ["AGGREGATE", "MODELED_FOUP"] }, status: "IN_PROGRESS",
  });
  const { releaseCount, nextCarry } = computeAggregateReleasePlan({
    dailyRate: cfg.dailyLotRelease,
    simDays: elapsedOperatingDays,
    carry,
    currentOccupied,
    targetOccupied: cfg.targetOccupiedFoup,
  });
  if (releaseCount <= 0) return { released: 0, nextCarry };

  const firstVisit = visits[0];
  const docs: WaferLotDoc[] = Array.from({ length: releaseCount }, () => {
    const id = randomUUID();
    return {
      _id: `WLOT-${fabId}-AUTO-${timing.recordedAt.getTime()}-${id}`,
      fabId, product, routeMasterId: routeMaster._id,
      foupCode: `FOUP-${fabId}-AUTO-${id}`,
      status: "IN_PROGRESS",
      createdBy: "TWIN_AUTO_RELEASE",
      createdAt: timing.recordedAt, updatedAt: timing.recordedAt,
      cohort: "MODELED_FOUP",
      currentStepIndex: 0,
      currentNodeId: firstVisit.nodeId,
      lastEventAt: timing.recordedAt,
      waferQty: cfg.wafersPerFoup,
      watched: false,
      source: "MODELED_BASELINE",
      bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION,
      modeledReleaseAt: timing.recordedAt,
      nextStepOperatingMs: timing.operatingEpochMs + stepDwellMs,
      dwellModel: FOUP_WIP_DWELL_MODEL,
    };
  });
  await waferLots.insertMany(docs, { ordered: false });
  return { released: releaseCount, nextCarry };
}
