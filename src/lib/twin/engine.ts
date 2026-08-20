import { randomUUID } from "crypto";
import type { Product } from "@/lib/db";
import type { FabId } from "@/lib/fab-domain";
import { collections } from "@/lib/db";
import { advanceAggregateWip, releaseAggregateWip } from "@/lib/lot-route";
import { getRouteMaster, expandRouteMaster } from "@/lib/route-master";
import { materialConsumptionFor } from "@/lib/material-consumption";
import { buildStepConsumption, computeBurn, type StepConsumption } from "@/lib/twin/burn";
import { planInbound, settleArrivals, updateBurnEma, observedDailyDemand } from "@/lib/twin/inbound";
import { resolveLeadTimeDays } from "@/lib/twin/lead-time";
import { getOrInitTwinState, acquireTwinLock, releaseTwinLock } from "@/lib/twin/state";
import { advanceOperatingClock, operatingDaysToMs, operatingMsToDays, OPERATING_SPEED_MULTIPLIER } from "@/lib/twin/operating-clock";
import { burnInventoryProjection, increaseInventoryProjection } from "@/lib/inventory-projection";
import { isRoleAutomationReady } from "@/lib/operations-automation-gate-server";
import { autonomyCeiling, initialPurchaseOrderStatus, shouldAutoApprovePendingOrder } from "@/lib/procurement-agent";
import { loadLiveScenarioMaterials } from "@/lib/material-scenario-server";
import { warehouseVerdict } from "@/lib/logistics-agent";
import { getWarehouseCapacity } from "@/lib/queries";
import { BURN_EMA_CEILING_MULTIPLIER, warehouseOccupancyFactor } from "@/lib/capacity";
import { blockingMaterialIds, coverageState, criticalMaterialIds, type MaterialSignal } from "@/lib/materials-agent";
import { finishedGoodsPerWafer, finishedGoodsUnit, finishedGoodsWarehouseFor, applyFinalTestQueue } from "@/lib/finished-goods";
import { ACTIVE_PRODUCTION_PRODUCTS, getProductionConfig } from "@/lib/fab-production-config";
import { advanceStepBucketWip, releaseStepBucketWip } from "@/lib/twin/step-bucket";
import { planAutoShipments } from "@/lib/twin/auto-shipment";
import { buildContractLines } from "@/lib/customer-contracts";

// 자동 출하의 실행 주체 — shipments.shippedBy에 남아 사람 출하와 구분된다.
const AUTO_SHIPMENT_ACTOR = "AGENT:정영업";

// tick 겹침 회귀 배경: 30초였을 때 실측 tick 소요가 95초(자재 44종 순차 쿼리 N+1)까지 걸려서,
// 30초 시점에 락이 만료되고 5초 간격 스케줄러의 다음 호출이 같은 tick을 또 실행했다 —
// advanceStepBucketWip(findOne→계산→updateOne)이 lost update, burnInventoryProjection의 $inc가
// 같은 소모를 두 번 차감하는 이중 실행으로 이어졌다. 실측 tick 소요보다 여유 있게 잡는다
// (scheduler.ts의 self-scheduling 전환과 함께 적용 — 그것만으로는 다중 프로세스/핫리로드가
// 동시에 도는 경우를 못 막는다).
const LOCK_TTL_MS = 300_000;
const EMA_ALPHA = 0.2;

// 발주가 창고를 정확히 100%까지 채우면, 그 즉시 박물류의 CAPACITY_OVER 임계(>=100%)에 걸려
// 다음 입고가 전부 보류된다 — 정원을 꽉 채우는 것과 입고를 멈추는 것이 같은 지점이 되는 셈이다
// (실관측 2026-08-11: 용량 인식 발주를 넣자 MWH-01·MWH-02가 정확히 100%에서 고착). 발주는
// 정원의 이 비율까지만 채워서 박물류가 판단할 여유를 남긴다.
const ORDER_CAPACITY_TARGET_RATIO = 0.95;

// 한 스텝이 차지하는 운영시간(일) = 사이클타임 / 전체 스텝수.
//
// 2026-08-12까지 이 값은 "한 tick에 흐르는 시간"으로 쓰였다(tick 횟수 기반 진행). 그래서 팹마다
// 시간이 다르게 흐르고(M20 1,832× / M21 1,629× / M22 1,431×) tick 간격이 흔들리면 배속도 같이
// 흔들렸다 — RULES.md가 금지한 형태다. 지금은 시간이 공통 운영시계에서만 오고, 이 함수는
// "한 스텝을 지나는 데 운영시간이 얼마나 드는가"라는 route의 성질만 나타낸다.
export function operatingDaysPerStep(cycleDays: number, totalSteps: number): number {
  if (totalSteps <= 0) return 1;
  return cycleDays / totalSteps;
}

export type TwinTickResult = {
  advanced: number;
  burnedByMaterial: Record<string, number>;
  shortfalls: Record<string, number>;
  newPOs: number;
  receipts: number;
  released: number;
  held: number;
  blocked: number;
  autoApproved: number;
  finishedGoodsAdded: number;
  // 이번 tick에 계약 rate로 자동 출하된 완제품 총량(제품 단위 혼합 합계 — 규모 감시용).
  autoShipped: number;
  finishedGoodsAddedByProduct: Partial<Record<Product, number>>;
  skipped?: "PAUSED" | "LOCKED" | "ROLE_GATE";
};

// 제품별 stepConsumption(공정 스텝 → 소모 자재) 캐시. route+원단위는 정적이므로 1회만 만든다.
const stepConsumptionCache = new Map<Product, { stepConsumption: StepConsumption; totalSteps: number }>();
async function getStepConsumption(fabId: FabId, product: Product): Promise<{ stepConsumption: StepConsumption; totalSteps: number }> {
  const cached = stepConsumptionCache.get(product);
  if (cached) return cached;
  const routeMaster = await getRouteMaster(fabId, product);
  if (!routeMaster) return { stepConsumption: new Map(), totalSteps: 0 };
  const visits = expandRouteMaster(routeMaster);
  const built = {
    stepConsumption: buildStepConsumption(visits, [...materialConsumptionFor(product)]),
    totalSteps: visits.length,
  };
  stepConsumptionCache.set(product, built);
  return built;
}

// avgDailyBurn EMA가 부트스트랩(리셋 직후) 시 걸러지지 않고 폭주하던 문제(실관측: CSM-001
// 설계 173/일 대비 실측 7,083/일, 41배)의 상한 기준 — 설계기준 수요를 얼마나 초과하는 관측치까지
// 정상적인 수요 증가로 인정할지는 capacity.ts의 BURN_EMA_CEILING_MULTIPLIER가 정한다. 창고 정원
// 산정도 같은 상수를 쓰므로 "정원은 설계 기준, 발주는 EMA 기준"으로 갈라지지 않는다.
// 자재는 3팹이 공유하므로 설계 수요도 HBM/DRAM/NAND 전 제품의 합으로 잡는다.
let cachedDesignDailyDemand: Map<string, number> | null = null;
function getDesignDailyDemand(): Map<string, number> {
  if (cachedDesignDailyDemand) return cachedDesignDailyDemand;
  const demand = new Map<string, number>();
  for (const { fabId, product } of ACTIVE_PRODUCTION_PRODUCTS) {
    const cfg = getProductionConfig(fabId, product);
    if (!cfg) continue;
    const dailyWaferStarts = cfg.waferStartsPerMonth / 30;
    for (const row of materialConsumptionFor(product)) {
      demand.set(row.materialId, (demand.get(row.materialId) ?? 0) + row.equivalentPerWafer * dailyWaferStarts);
    }
  }
  cachedDesignDailyDemand = demand;
  return cachedDesignDailyDemand;
}

// 3팹이 소모하는 전체 자재 집합(발주·게이팅 대상). 자재 재고는 fab 공유이므로 합집합으로 1회만 다룬다.
function allConsumedMaterialIds(): string[] {
  const set = new Set<string>();
  for (const { product } of ACTIVE_PRODUCTION_PRODUCTS) {
    for (const row of materialConsumptionFor(product)) set.add(row.materialId);
  }
  return [...set];
}


export async function executeTwinTick(now: Date = new Date()): Promise<TwinTickResult> {
  const empty: TwinTickResult = { advanced: 0, burnedByMaterial: {}, shortfalls: {}, newPOs: 0, receipts: 0, released: 0, held: 0, blocked: 0, autoApproved: 0, finishedGoodsAdded: 0, autoShipped: 0, finishedGoodsAddedByProduct: {} };
  const state = await getOrInitTwinState();
  if (state.status !== "RUNNING") return { ...empty, skipped: "PAUSED" };
  // DB 상태가 수동으로 RUNNING으로 바뀌더라도 레거시 직접 쓰기는 역할 이관 전까지 봉인한다.
  if (!isRoleAutomationReady()) return { ...empty, skipped: "ROLE_GATE" };

  const owner = randomUUID();
  if (!(await acquireTwinLock(owner, LOCK_TTL_MS))) return { ...empty, skipped: "LOCKED" };

  try {
    const phase: Record<string, number> = {};
    let phaseMark = Date.now();
    const mark = (name: string) => { const t = Date.now(); phase[name] = (phase[name] ?? 0) + (t - phaseMark); phaseMark = t; };
    const { inventory, materials, materialSuppliers, suppliers, twinPurchaseOrders, twinBurnEvents, finishedGoods, finishedGoodsEvents, shipments, customers } = await collections();

    // tick 겹침 수정(LOCK_TTL_MS 주석)과 별개로, tick 자체가 자재 44종 × 최대 3배(자재/창고
    // 게이팅·소모·발주 3개 구간이 각자 resolveWarehouse+findOne을 다시 불렀다)로 순차 쿼리를
    // 날려 95초까지 걸렸던 N+1을 없앤다. 자재의 대표 창고(재고 최다 문서)·재고·자재 마스터를
    // tick 시작 시 배치로 한 번만 읽고, 이후 구간은 이 in-memory 스냅샷을 읽고 쓴다 — 락으로
    // 이 tick 동안 단일 쓰기자임이 보장되므로(§ acquireTwinLock) 안전하다. 재고 수량·EMA는
    // 실제 DB 쓰기(burnInventoryProjection/inventory.updateOne)와 같은 시점에 스냅샷도 같이
    // 갱신해서, 뒤 구간(③ 입고)이 이번 tick에 소모된 이후의 최신 값을 보게 한다.
    const allMaterialIds = allConsumedMaterialIds();
    // 조달 마스터(공급사 링크)도 같은 배치에 실어 읽는다 — 발주 리드타임의 진실원이라 자재마다
    // 필요하지만, 자재별로 조회하면 여기서 없앤 N+1이 그대로 되살아난다(§resolveLeadTimeDays).
    const [allInventoryDocs, allMaterialDocs, allSupplierLinks, allSupplierDocs] = await Promise.all([
      inventory.find({ materialId: { $in: allMaterialIds } }).toArray(),
      materials.find({ _id: { $in: allMaterialIds } }).toArray(),
      materialSuppliers.find({ materialId: { $in: allMaterialIds } }).toArray(),
      suppliers.find({}).toArray(),
    ]);
    mark("자재·재고·조달마스터 배치조회");
    const materialsById = new Map(allMaterialDocs.map((m) => [m._id, m]));
    const supplierLinksByMaterial = new Map<string, typeof allSupplierLinks>();
    for (const link of allSupplierLinks) {
      const list = supplierLinksByMaterial.get(link.materialId);
      if (list) list.push(link); else supplierLinksByMaterial.set(link.materialId, [link]);
    }
    // materialId → 대표 재고 스냅샷(재고 최다 창고, resolveWarehouse와 동일 규칙). quantity·
    // avgDailyBurn은 ② 소모 구간에서 실제 DB 쓰기와 함께 이 객체를 직접 mutate해 최신 상태로 유지한다.
    const invSnapshotByMaterial = new Map<string, { warehouseId: string; quantity: number; avgDailyBurn: number }>();
    for (const doc of allInventoryDocs) {
      const prev = invSnapshotByMaterial.get(doc.materialId);
      if (!prev || doc.quantity > prev.quantity) {
        invSnapshotByMaterial.set(doc.materialId, { warehouseId: doc.warehouseId, quantity: doc.quantity, avgDailyBurn: doc.avgDailyBurn ?? 0 });
      }
    }

    // 이자재(MATERIALS)의 COVERAGE_CRITICAL 판단을 최생산(PRODUCTION) WIP 진행보다 먼저
    // 계산해야 한다 — advanceAggregateWip가 다음 스텝에 CRITICAL 자재를 쓰는 로트를
    // 배제하려면 "지금 무엇이 CRITICAL인지"를 진행 전에 알아야 한다. 자재는 3팹 공유라 합집합으로 1회.
    const materialSignals: MaterialSignal[] = [];
    for (const materialId of allMaterialIds) {
      const inv = invSnapshotByMaterial.get(materialId);
      const mat = materialsById.get(materialId);
      if (!inv || !mat) continue;
      const dailyBurn = inv.avgDailyBurn;
      materialSignals.push({
        materialId, code: mat.code, name: mat.name, unit: mat.unit,
        ropDays: mat.ropDays, quantity: inv.quantity, dailyBurn,
        coverageDays: dailyBurn > 0 ? inv.quantity / dailyBurn : null,
        state: coverageState(inv.quantity, dailyBurn, mat.ropDays),
      });
    }
    // 두 신호를 분리해서 쓴다(§materials-agent 주석):
    //  · blockedMaterialIds(STOCKOUT)  → 라인을 세운다. 자재가 실제로 없으면 공정을 못 지난다.
    //  · urgentMaterialIds(+CRITICAL)  → 창고가 초과여도 입고한다. 결품 나기 전에 채운다.
    // 하나로 합쳐 쓰면 재고가 있는데도 라인이 서고, 그게 재주문 정책과 충돌해 구조적 결품이 났다.
    const blockedMaterialIds = blockingMaterialIds(materialSignals);
    const urgentMaterialIds = criticalMaterialIds(materialSignals);

    // 박물류(LOGISTICS)의 창고 용량 판정도 WIP 진행보다 먼저 계산해야 한다 — 완제품 창고가
    // CAPACITY_OVER면 이번 tick에 완료될(=완제품이 될) 로트도 자재차단과 같은 방식으로
    // advanceAggregateWip가 막아야 한다. 원자재 입고 게이팅(③)도 같은 값을 재사용한다.
    mark("자재신호");
    const warehouseCapacity = await getWarehouseCapacity();
    mark("창고용량");
    const capacityOverWarehouseIds = new Set(
      warehouseCapacity
        .filter((wh) => warehouseVerdict({ code: wh.code, name: wh.name, utilization: wh.utilization, legalUtilization: wh.legalUtilization, capacityMode: wh.capacityMode }) === "CAPACITY_OVER")
        .map((wh) => wh.id),
    );

    // 창고별 잔여 용량 예산(점유 단위). ③ 발주 구간에서 자재마다 이 예산을 깎아 쓴다 —
    // 한 창고를 여러 자재가 공유하므로, 자재별로 독립 판단하면 각자 "아직 여유 있다"고 보고
    // 다 같이 주문해 합계가 정원을 넘는다. TANK_LEVEL·CONTINUOUS는 적치 용량 개념이 아니라
    // 예산을 두지 않는다(무제한). 이미 초과된 창고는 음수가 되어 발주가 나가지 않는다.
    const capacityHeadroomByWarehouse = new Map<string, number>();
    const warehouseTypeById = new Map<string, string>();
    for (const wh of warehouseCapacity) {
      warehouseTypeById.set(wh.id, wh.type);
      if (wh.capacityMode !== "SPACE") continue;
      const limit = wh.legalLimit ?? wh.totalCapacity;
      capacityHeadroomByWarehouse.set(wh.id, limit * ORDER_CAPACITY_TARGET_RATIO - wh.occupancy);
    }

    // ── 공통 운영시계 전진 (RULES.md § Twin 운영시간) ──
    // 실제 경과 벽시계 × 24. tick 횟수·팹·제품과 무관하게 이 하나가 모든 모델 시간의 근거다.
    const clock = advanceOperatingClock({
      operatingEpochMs: state.operatingEpochMs ?? 0,
      lastWallClock: state.operatingClockWallAt ?? null,
      now,
    });
    // 이번 tick에 흐른 운영시간(일). 예전 simDays 자리를 전부 이 값이 대신한다.
    const elapsedOperatingDays = operatingMsToDays(clock.elapsedOperatingMs);
    if (clock.clampedCatchUp) {
      console.warn(`[twin] 운영시계 catch-up 상한 적용 — 정지 공백이 한꺼번에 반영되지 않도록 잘랐다`);
    }

    // ── 제품 루프: HBM/DRAM/NAND 각각 WIP 진행 → 소모 계산 → 완제품 적립 ──
    // 자재 소모는 fab 공유 재고이므로 제품별 burn을 materialId로 합산한 뒤, 루프 밖에서 1회만 재고에 반영한다.
    const carryByProduct: Partial<Record<Product, number>> = { ...(state.releaseCarryByProduct ?? {}) };
    // 하위호환: 예전 단일 releaseCarry는 HBM 몫으로 이어받는다.
    if (carryByProduct.HBM == null && state.releaseCarry != null) carryByProduct.HBM = state.releaseCarry;

    // 계약 라인(고객 × 제품) — 자동출하의 상한이자 배분 기준. 고객 마스터는 tick 중 안 변하므로 1회만 읽는다.
    const customerDocs = await customers.find({}).toArray();
    mark("고객조회");
    const autoShipmentLines = buildContractLines(customerDocs);
    let autoShipped = 0;

    const burnedByMaterialAgg = new Map<string, number>();
    let totalAdvanced = 0;
    let totalBlocked = 0;
    let totalReleased = 0;
    const finishedGoodsAddedByProduct: Partial<Record<Product, number>> = {};

    for (const { fabId, product } of ACTIVE_PRODUCTION_PRODUCTS) {
      const cfg = getProductionConfig(fabId, product);
      if (!cfg) continue;
      const { stepConsumption, totalSteps } = await getStepConsumption(fabId, product);
      if (totalSteps === 0) continue;

      // 완제품 창고 게이팅은 이 제품의 창고만 본다 — 옛 단일창고(WH-FG01) 방식에서는 HBM 적체가
      // DRAM/NAND 생산까지 같이 멈췄다.
      const fgWarehouseId = finishedGoodsWarehouseFor(product);
      const finishedGoodsCapacityOver = capacityOverWarehouseIds.has(fgWarehouseId);

      // 시간은 제품 루프 밖의 공통 운영시계에서만 온다 — 여기서 팹별 시계를 만들지 않는다.

      // ① WIP 진행(자재 서킷브레이커 + 완제품 창고 게이팅) → ② 소모 → ①.5 재투입
      // HBM은 per-lot(waferLots), DRAM/NAND는 step-bucket 집계(대규모 WIP 고속 진행).
      let completedWaferQty = 0;
      const productMark = Date.now();
      if (cfg.wipMode === "PER_LOT") {
        const adv = await advanceAggregateWip(fabId, product, { stepConsumption, blockedMaterialIds, finishedGoodsCapacityOver });
        totalAdvanced += adv.advanced;
        totalBlocked += adv.blocked;
        completedWaferQty = adv.completedWaferQty;
        for (const [materialId, qty] of computeBurn(adv.advancedFromStepIndex, stepConsumption)) {
          if (qty > 0) burnedByMaterialAgg.set(materialId, (burnedByMaterialAgg.get(materialId) ?? 0) + qty);
        }
        const release = await releaseAggregateWip(fabId, product, now, elapsedOperatingDays, carryByProduct[product] ?? 0);
        carryByProduct[product] = release.nextCarry;
        totalReleased += release.released;
      } else {
        const adv = await advanceStepBucketWip(fabId, product, { stepConsumption, blockedMaterialIds, finishedGoodsCapacityOver, wafersPerFoup: cfg.wafersPerFoup });
        totalAdvanced += adv.advancedFoup;
        totalBlocked += adv.blockedFoup;
        completedWaferQty = adv.completedWaferQty;
        for (const [materialId, qty] of adv.burnByMaterial) {
          if (qty > 0) burnedByMaterialAgg.set(materialId, (burnedByMaterialAgg.get(materialId) ?? 0) + qty);
        }
        const release = await releaseStepBucketWip(fabId, product, elapsedOperatingDays, carryByProduct[product] ?? 0, cfg.dailyLotRelease, cfg.targetOccupiedFoup);
        carryByProduct[product] = release.nextCarry;
        totalReleased += release.released;
      }

      phase[`  └${fabId} WIP진행`] = Date.now() - productMark;
      const fgMark = Date.now();
      // ①.6 이번 tick에 완료된 웨이퍼를 완제품으로 적립. 웨이퍼 수량을 제품별 환산으로 완제품 단위 수로 바꾼다.
      // 패키징(WIP 완료)이 끝났다고 바로 판매재고가 되지 않는다 — 최종테스트(Final Test) 대기열을 거친다.
      const fgId = `${fabId}__${product}__${fgWarehouseId}`;
      const newlyCompletedQuantity = completedWaferQty * finishedGoodsPerWafer(product);
      const fgDoc = await finishedGoods.findOne({ _id: fgId });
      const queue = applyFinalTestQueue({
        operatingEpochMs: clock.operatingEpochMs,
        pendingTestQuantity: fgDoc?.pendingTestQuantity ?? 0,
        pendingTestReadyOperatingMs: fgDoc?.pendingTestReadyOperatingMs ?? null,
        newlyCompletedQuantity,
      });
      finishedGoodsAddedByProduct[product] = queue.releasedQuantity;
      if (newlyCompletedQuantity > 0 || queue.releasedQuantity > 0) {
        await finishedGoods.updateOne(
          { _id: fgId },
          {
            $inc: { quantity: queue.releasedQuantity },
            $set: {
              updatedAt: now,
              pendingTestQuantity: queue.nextPendingTestQuantity,
              pendingTestReadyOperatingMs: queue.nextPendingTestReadyOperatingMs,
            },
            $setOnInsert: { fabId, product, warehouseId: fgWarehouseId, unit: finishedGoodsUnit(product) },
          },
          { upsert: true },
        );
        await finishedGoodsEvents.insertOne({
          _id: randomUUID(), fabId, product, tickAt: now,
          operatingEpochMs: clock.operatingEpochMs,
          addedQty: queue.releasedQuantity, queuedQty: newlyCompletedQuantity,
        });
      }

      phase[`  └${fabId} 완제품적립`] = Date.now() - fgMark;
      const shipMark = Date.now();
      // ①.7 계약 rate만큼 자동 출하 — 완제품의 배출구.
      // 예전엔 출하가 사람이 폼을 누르거나 정리 스크립트를 돌릴 때만 생겨서, 완제품이 쌓이다
      // 창고가 CAPACITY_OVER가 되면 위 ①의 마지막 스텝이 막혀 라인 전체가 섰다(실관측: 손으로
      // 70%까지 비운 NAND 창고가 2시간 만에 192% 재포화). 계약이 곧 배출구가 되게 한다.
      const availableForShipment = (fgDoc?.quantity ?? 0) + queue.releasedQuantity;
      if (availableForShipment > 0) {
        const plan = planAutoShipments({
          lines: autoShipmentLines.filter((l) => l.product === product),
          availableQty: availableForShipment,
          simDays: elapsedOperatingDays,
        });
        for (const alloc of plan.allocations) {
          // 조건부 차감 — 재고가 모자라면 매칭이 안 되므로 음수로 내려가지 않는다.
          const res = await finishedGoods.updateOne(
            { _id: fgId, quantity: { $gte: alloc.qty } },
            { $inc: { quantity: -alloc.qty }, $set: { updatedAt: now } },
          );
          if (!res.modifiedCount) continue;
          await shipments.insertOne({
            _id: randomUUID(), fabId, product,
            warehouseId: fgWarehouseId, customerId: alloc.customerId,
            quantity: alloc.qty, unit: finishedGoodsUnit(product),
            shippedAt: now,
            shippedOperatingMs: clock.operatingEpochMs,
            // 사람이 화면에서 낸 출하와 구분되도록 실행 주체를 남긴다.
            shippedBy: AUTO_SHIPMENT_ACTOR,
          });
          autoShipped += alloc.qty;
        }
      }
      phase[`  └${fabId} 자동출하`] = Date.now() - shipMark;
    }

    mark("제품루프(WIP진행·완제품·출하)");
    // ── 누적 소모를 3팹 공유 재고에 1회 반영 ──
    const burnedByMaterial: Record<string, number> = {};
    const shortfalls: Record<string, number> = {};
    // EMA 정규화도 공통 운영시계를 쓴다 — 예전엔 제품마다 다른 simDays 중 HBM 것을 대표로 골라
    // 썼는데, 그 자체가 "제품별 임의 배속"의 잔재였다.
    const emaSimDays = elapsedOperatingDays;
    for (const [materialId, qty] of burnedByMaterialAgg) {
      if (qty <= 0) continue;
      const snapshot = invSnapshotByMaterial.get(materialId);
      const warehouseId = snapshot?.warehouseId;
      if (!warehouseId) continue;
      const { burned, shortfall } = await burnInventoryProjection({ materialId, warehouseId, quantity: qty });
      burnedByMaterial[materialId] = burned;
      if (shortfall > 0) shortfalls[materialId] = shortfall;

      // 실측 일일 소모율 EMA 갱신 — 설계기준 수요(3팹 합)의 3배를 상한으로 catch-up burst를 걸러낸다.
      // burned(실제 차감량)가 아니라 qty(진짜 요청 수요, burned+shortfall)를 넣는다 — burned만 넣으면
      // 재고가 부족할수록 EMA가 더 내려가 재발주가 더 안 나가는 자기강화 나선이 된다(observedDailyDemand 참고).
      // prevEma는 tick 시작 시 배치로 읽은 스냅샷을 쓴다 — 이 자재는 이 tick에서 여기서 처음
      // avgDailyBurn을 쓰므로 스냅샷 이후로 값이 바뀔 수 없어 별도 조회가 필요 없다.
      const observedDaily = observedDailyDemand(qty, emaSimDays);
      const designDaily = getDesignDailyDemand().get(materialId);
      const ceiling = designDaily != null ? designDaily * BURN_EMA_CEILING_MULTIPLIER : undefined;
      const nextEma = updateBurnEma(snapshot.avgDailyBurn, observedDaily, EMA_ALPHA, ceiling);
      await inventory.updateOne({ materialId, warehouseId }, { $set: { avgDailyBurn: nextEma } });
      // ③ 입고 구간이 이번 tick의 소모를 반영한 최신 재고·EMA를 읽도록 스냅샷도 같이 갱신한다.
      snapshot.quantity -= burned;
      snapshot.avgDailyBurn = nextEma;

      await twinBurnEvents.insertOne({ _id: randomUUID(), tickAt: now, operatingEpochMs: clock.operatingEpochMs, materialId, burnedQty: burned, shortfallQty: shortfall });
    }

    mark("소모반영");
    // ③ 입고: 전체 소모 자재에 대해 ROP 점검·발주, 도착 정산 (이번 tick에 소모되지 않은 자재도 도착 PO는 반드시 정산되어야 함)
    // 김구매(PROCUREMENT)의 자율등급 판단을 계산해 PO에 기록한다(투명성). 리드타임은 운영시간이며
    // 도착 판정 근거는 etaOperatingMs다(§twin/operating-clock.ts) — 예전의 tick 파생 환산은 제거됐다.
    let newPOs = 0;
    let receipts = 0;
    let held = 0;
    let autoApproved = 0;
    const { materials: scenarioMaterials } = await loadLiveScenarioMaterials(now);
    const scenarioByMaterial = new Map(scenarioMaterials.map((m) => [m.id, m]));

    // 미완결 PO를 자재별로 1회에 읽는다(자재마다 find를 돌리던 N+1 제거). 아직 도착하지 않은
    // 물량도 결국 그 창고를 점유하므로, 창고 예산에서 미리 빼둔다 — 안 그러면 매 tick이 같은
    // 여유를 보고 또 주문해서, 화물이 다 도착할 때쯤 정원을 훌쩍 넘긴다.
    const allOpenPOs = await twinPurchaseOrders.find({ status: { $nin: ["RECEIVED", "REJECTED"] } }).toArray();
    const openPOsByMaterial = new Map<string, typeof allOpenPOs>();
    for (const po of allOpenPOs) {
      const list = openPOsByMaterial.get(po.materialId) ?? [];
      list.push(po);
      openPOsByMaterial.set(po.materialId, list);
      const destination = po.destinationWarehouseId;
      const headroom = destination ? capacityHeadroomByWarehouse.get(destination) : undefined;
      if (destination == null || headroom == null) continue;
      const mat = materialsById.get(po.materialId);
      const warehouseType = warehouseTypeById.get(destination);
      if (!mat || warehouseType == null) continue;
      capacityHeadroomByWarehouse.set(destination, headroom - po.qty * warehouseOccupancyFactor(warehouseType, mat));
    }

    for (const materialId of allMaterialIds) {
      const inv = invSnapshotByMaterial.get(materialId);
      const warehouseId = inv?.warehouseId;
      const mat = materialsById.get(materialId);
      if (!inv || !warehouseId || !mat) continue;

      const openPOs = openPOsByMaterial.get(materialId) ?? [];
      // SLA 타임아웃(§procurement-agent.ts shouldAutoApprovePendingOrder) — 08-08 정책과 오늘
      // 되살린 승인 게이트를 절충한다. 사람이 60분 안에 안 누르면 자동으로 승인해서, 위험물·
      // 단일소싱 자재가 영원히 재발주 불가로 잠기는 걸 막는다. 사람 승인(decideTwinPurchaseOrder)과
      // 동시에 처리될 수 있어 status 필터로 원자적으로 선점한다(이중 승인 방지).
      for (const po of openPOs) {
        if (po.status !== "PENDING_APPROVAL") continue;
        const waitingMinutes = (now.getTime() - po.orderedAt.getTime()) / 60_000;
        if (!shouldAutoApprovePendingOrder(waitingMinutes)) continue;
        const claim = await twinPurchaseOrders.updateOne(
          { _id: po._id, status: "PENDING_APPROVAL" },
          { $set: {
            status: "ORDERED", orderedAt: now,
            etaOperatingMs: clock.operatingEpochMs + operatingDaysToMs(po.leadTimeDays),
            etaAt: new Date(now.getTime() + operatingDaysToMs(po.leadTimeDays) / OPERATING_SPEED_MULTIPLIER),
            decidedAt: now, decidedBy: "SLA_TIMEOUT_AUTO",
          } },
        );
        if (claim.modifiedCount > 0) { po.status = "ORDERED"; autoApproved++; }
      }
      const inTransit = openPOs.reduce((s, po) => s + po.qty, 0);
      const lastPO = await twinPurchaseOrders.findOne({ materialId }, { sort: { orderedAt: -1 } });
      // 리드타임은 재주문 시점 판단에도 필요하다 — ropDays가 리드타임보다 짧으면 발주가 즉시
      // 나가도 도착 전에 재고가 0을 지나간다(§twin/inbound.ts planInbound).
      const leadTimeDays = resolveLeadTimeDays(supplierLinksByMaterial.get(materialId) ?? [], allSupplierDocs, mat.category, now);
      // 목적창고의 남은 점유 여유를 이 자재의 수량 단위로 환산해 발주 상한으로 넘긴다.
      // 환산계수가 0인 자재(현장생산 UPW 등 창고를 점유하지 않음)는 용량 제약이 없다.
      const warehouseType = warehouseTypeById.get(warehouseId);
      const headroomOcc = capacityHeadroomByWarehouse.get(warehouseId);
      const occFactor = warehouseType != null ? warehouseOccupancyFactor(warehouseType, mat) : 0;
      const capacityHeadroomQty = headroomOcc == null || occFactor <= 0 ? undefined : headroomOcc / occFactor;
      const plan = planInbound({
        onHand: inv.quantity, inTransit, avgDailyBurn: inv.avgDailyBurn ?? 0, ropDays: mat.ropDays,
        leadTimeDays,
        recentOrderQty: lastPO?.qty,
        capacityHeadroomQty,
      });
      if (plan) {
        // 이 발주가 쓸 점유량만큼 창고 예산을 깎는다 — 같은 창고를 쓰는 뒤 자재들이 남은
        // 여유만 보게 해서, 자재별로 각자 "여유 있다"고 판단해 합계가 정원을 넘는 걸 막는다.
        if (headroomOcc != null && occFactor > 0) {
          capacityHeadroomByWarehouse.set(warehouseId, headroomOcc - plan.qty * occFactor);
        }
        const scenarioMat = scenarioByMaterial.get(materialId);
        const ceiling = autonomyCeiling(scenarioMat
          ? { category: scenarioMat.category, procurementAlternatives: scenarioMat.procurementAlternatives, supplyMode: scenarioMat.supplyMode }
          : { category: mat.category, procurementAlternatives: [], supplyMode: mat.supplyMode });
        await twinPurchaseOrders.insertOne({
          _id: randomUUID(), materialId, qty: plan.qty, orderedAt: now,
          // 도착 판정의 근거는 운영시각이다. etaAt(벽시계)은 화면 표시용으로 같이 남긴다.
          etaOperatingMs: clock.operatingEpochMs + operatingDaysToMs(leadTimeDays),
          etaAt: new Date(now.getTime() + operatingDaysToMs(leadTimeDays) / OPERATING_SPEED_MULTIPLIER),
          leadTimeDays,
          status: initialPurchaseOrderStatus(ceiling.level),
          autonomyCeiling: ceiling.level,
          autonomyReason: ceiling.reason,
          destinationWarehouseId: warehouseId,
        });
        newPOs++;
      }

      // 결품 임박(COVERAGE_CRITICAL) 자재의 보충분까지 용량 초과로 묶으면 "창고가 안 빠져서
      // 자재가 못 들어오고, 자재가 없어서 라인이 서고, 라인이 서서 창고가 안 빠지는" 닫힌
      // 루프가 된다 — 긴급 입고 예외로 끊는다(§inbound.ts). 라인 차단(blockedMaterialIds)보다
      // 넓은 집합이라, 라인이 서기 전에 미리 채우는 쪽으로 작동한다.
      const arrivals = settleArrivals(openPOs, now, clock.operatingEpochMs, capacityOverWarehouseIds, urgentMaterialIds);
      for (const r of arrivals.receipts) {
        // settleArrivals가 이제 INBOUND_HOLD도 재정산하므로, 같은 PO를 사람이 화면에서
        // 수동 해제(releaseTwinInboundHold)하는 것과 이 tick이 동시에 처리할 수 있다. 둘 다
        // twin 락을 공유하지 않으므로, 재고를 더하기 전에 상태 전이를 먼저 원자적으로 선점하고
        // 실패하면(이미 다른 경로가 RECEIVED로 바꿔놨으면) 건너뛴다 — 이중 입고 방지.
        const claim = await twinPurchaseOrders.updateOne(
          { _id: r.poId, status: { $in: ["ORDERED", "IN_TRANSIT", "INBOUND_HOLD"] } },
          { $set: { status: "RECEIVED" } },
        );
        if (claim.modifiedCount === 0) continue;
        await increaseInventoryProjection({ materialId: r.materialId, warehouseId, quantity: r.qty });
        receipts++;
      }
      if (arrivals.heldPoIds.length > 0) {
        await twinPurchaseOrders.updateMany(
          { _id: { $in: arrivals.heldPoIds }, status: { $ne: "INBOUND_HOLD" } },
          { $set: { status: "INBOUND_HOLD", holdReason: "박물류 판정: 목적창고 CAPACITY_OVER" } },
        );
        held += arrivals.heldPoIds.length;
      }
    }

    mark("발주·입고정산");
    const { twinEngineState } = await collections();
    await twinEngineState.updateOne(
      { _id: "singleton" },
      { $set: {
        lastTickAt: now,
        operatingEpochMs: clock.operatingEpochMs,
        operatingClockWallAt: clock.nextWallClock,
        releaseCarry: carryByProduct.HBM ?? 0,
        releaseCarryByProduct: carryByProduct,
      } },
    );

    mark("상태저장");
    const totalMs = Object.values(phase).reduce((a, b) => a + b, 0);
    console.log(`[twin] tick ${totalMs}ms — ` + Object.entries(phase).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}ms`).join(" / "));
    const finishedGoodsAdded = Object.values(finishedGoodsAddedByProduct).reduce((s, v) => s + (v ?? 0), 0);
    return { advanced: totalAdvanced, burnedByMaterial, shortfalls, newPOs, receipts, released: totalReleased, held, blocked: totalBlocked, autoApproved, autoShipped, finishedGoodsAdded, finishedGoodsAddedByProduct };
  } finally {
    await releaseTwinLock(owner);
  }
}
