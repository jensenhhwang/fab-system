// 동기화된 WIP 무리가 같은 tick에 한 스텝을 같이 완료하면 그 tick의 관측치가 순간적으로
// 폭증할 수 있다. 한 tick의 극단값이 EMA를 통째로 흔들지 못하도록 이전 EMA의 배수로 상한을
// 둔다 — 진짜 지속적인 증가는 alpha만큼씩 여러 tick에 걸쳐 반영되고, 한 번의 튀는 값만
// 걸러낸다(실관측: burst 한 번으로 재주문량이 폭주해 창고가 넘침).
const EMA_SPIKE_CLIP_FACTOR = 3;

// EMA 아사 나선 회귀 배경: engine.ts가 실제 요청량(qty) 대신 burnInventoryProjection이 반환한
// burned(재고가 부족해 실제로 차감된 양, min(onHand, qty))만 EMA에 넣고 있었다. 재고가
// 부족할수록 burned가 작아지고 → avgDailyBurn(EMA)이 내려가고 → ROP·재주문 판단이 그 내려간
// EMA를 기준으로 하니 발주가 더 안 나가고 → 재고가 더 부족해지는 자기강화 나선이었다(실관측:
// 결품률 08-05 40%→08-09 73% 악화, GAS-024·GAS-010 설계수요의 32%까지 자기부양). burned는
// "실제로 얼마나 줄었나"가 아니라 "얼마나 필요했나"를 재야 한다 — 진짜 수요는 burned+shortfall
// (=요청한 qty 그대로)이다. 상한(referenceCeiling)과 3배 스파이크 클립은 그대로 유지되므로
// 부족량이 크게 튀어도 EMA가 즉시 폭주하지는 않는다.
export function observedDailyDemand(trueDemandQty: number, emaSimDays: number): number {
  return emaSimDays > 0 ? trueDemandQty / emaSimDays : trueDemandQty;
}

// 지수이동평균. prevEma가 0이면 첫 관측값을 그대로 채택한다 — 단, referenceCeiling(설계기준
// 수요 등 외부 상한)이 있으면 부트스트랩이든 아니든 항상 그 이하로 잘라낸다. Twin이 며칠
// 멈췄다 재개되면 밀린 로트가 한 tick에 몰려 그 순간 burn이 폭증하는데, 하필 리셋 직후
// 첫 관측이면 위의 3배 클리핑조차 적용 안 돼(prevEma=0이라 0*3=0) 그대로 새 기준선이 되고,
// 거기서 다시 3배씩 불어나 결국 설계기준 대비 수십 배까지 벌어진다(실관측: CSM-001 설계
// 173/일 대비 실측 7,083/일).
export function updateBurnEma(prevEma: number, observedDailyBurn: number, alpha: number, referenceCeiling?: number): number {
  const capped = referenceCeiling != null ? Math.min(observedDailyBurn, referenceCeiling) : observedDailyBurn;
  if (prevEma <= 0) return capped;
  const clipped = Math.min(capped, prevEma * EMA_SPIKE_CLIP_FACTOR);
  return alpha * clipped + (1 - alpha) * prevEma;
}

// avgDailyBurn의 정합성과 무관하게(EMA 클리핑 우회든 수동 리셋 실수든), 발주량 자체가 최근
// 발주 이력 대비 비정상적으로 크면 한 번에 다 승인하지 않는다 — 실관측: avgDailyBurn 오설정
// 한 번으로 PKG-LBD-001이 30분 만에 입고 1.39억 vs 소비 428만(32배)까지 벌어짐. 진짜 지속적인
// 수요 증가는 여러 번의 발주를 거쳐 서서히 반영되면 된다(이력 없는 최초 발주는 클리핑하지 않음
// — EMA 부트스트랩과 동일한 철학).
const ORDER_QTY_SPIKE_CLIP_FACTOR = 5;

// 현재고+입고중이 ROP 미만이면 rop*2까지 채우는 재주문량을 반환. 소모가 없으면 발주하지 않는다.
//
// ropDays가 조달 리드타임보다 짧으면 발주가 즉시 나가도 구조적으로 결품난다 — ROP에서 발주를
// 걸어도 남은 재고는 ropDays치인데 화물은 leadTimeDays 뒤에 도착하므로, 그 차이만큼은 반드시
// 재고 0을 지나간다(실관측: CHM-002 ropDays 7일 vs CHM 리드타임 11일). ERP 쪽 기준수량 계산
// (inventory-policy.ts calculateBaselineTarget)은 이미 protectedDays = max(ropDays, leadTimeDays)로
// 이걸 처리하고 있었다 — twin의 재주문도 같은 기준을 써서 두 계산이 어긋나지 않게 한다.
// leadTimeDays를 안 주면 지금까지처럼 ropDays만 쓴다(기존 호출자 동작 보존).
export function planInbound(input: {
  onHand: number; inTransit: number; avgDailyBurn: number; ropDays: number;
  leadTimeDays?: number;
  recentOrderQty?: number;
  // 목적창고에 지금 더 넣을 수 있는 양(자재 수량 단위로 환산된 잔여 용량). 생략하면 무제한.
  capacityHeadroomQty?: number;
  // 이 자재를 담는 용기의 물리 한도(벌크 탱크 capacityLimit). 생략하면 무제한.
  //
  // 창고 헤드룸과 다르다 — 헤드룸은 "창고에 자리가 있나"이고 이건 "탱크에 들어가나"다. 엔진은
  // 헤드룸을 SPACE 창고에만 넘겨서 탱크 자재는 용량을 아예 안 봤고, rop×2가 탱크보다 큰 자재
  // 12종이 담을 수 없는 양을 계속 주문했다(실측 2026-08-20, 탱크의 1.1~1.5배). 그 자재들은
  // 영구히 목표 미달로 살아서 소모가 조금만 튀면 0으로 간다.
  capacityLimitQty?: number;
}): { qty: number } | null {
  if (input.avgDailyBurn <= 0) return null;
  const protectedDays = Math.max(input.ropDays, input.leadTimeDays ?? 0);
  const rop = input.avgDailyBurn * protectedDays;
  const position = input.onHand + input.inTransit;
  if (position >= rop) return null;
  const rawQty = Math.ceil(rop * 2 - position);
  if (rawQty <= 0) return null;
  const cap = input.recentOrderQty && input.recentOrderQty > 0
    ? input.recentOrderQty * ORDER_QTY_SPIKE_CLIP_FACTOR
    : Infinity;
  // 담을 수 없는 양은 애초에 주문하지 않는다. 예전엔 용량을 안 보고 발주해놓고 도착 시점에
  // 박물류가 INBOUND_HOLD로 묶었는데, 보류된 물량은 inTransit에 계속 잡혀 재발주까지 막아서
  // "자재는 결품인데 창고는 초과"인 교착이 됐다(§settleArrivals). ERP 쪽 기준수량 계산
  // (inventory-policy.ts capacityDecision)이 이미 BLOCKED_CAPACITY로 쓰는 규칙과 같다.
  const headroom = input.capacityHeadroomQty ?? Infinity;
  if (headroom <= 0) return null;
  // 탱크 잔여 = 한도 − (현재고 + 미착). 미착분도 결국 이 탱크로 들어온다.
  const tankRoom = input.capacityLimitQty != null ? input.capacityLimitQty - position : Infinity;
  if (tankRoom <= 0) return null;
  const qty = Math.min(rawQty, cap, headroom, tankRoom);
  return qty > 0 ? { qty } : null;
}

export function settleArrivals(
  pos: { _id: string; etaAt: Date; etaOperatingMs?: number; qty: number; materialId: string; status: string; destinationWarehouseId?: string }[],
  now: Date,
  /** 지금 운영시각(ms). 리드타임은 운영시간이므로 도착 판정의 근거다(RULES.md § Twin 운영시간). */
  operatingEpochMs?: number,
  capacityOverWarehouseIds?: Set<string>,
  // 결품 임박(COVERAGE_CRITICAL) 자재 — 용량 초과 보류의 예외로 긴급 입고한다.
  urgentMaterialIds?: ReadonlySet<string>,
): { receipts: { poId: string; materialId: string; qty: number }[]; arrivedPoIds: string[]; heldPoIds: string[] } {
  const receipts: { poId: string; materialId: string; qty: number }[] = [];
  const arrivedPoIds: string[] = [];
  const heldPoIds: string[] = [];
  for (const po of pos) {
    // PENDING_APPROVAL(김구매 승인 대기)·REJECTED는 실제로 발주가 나간 게 아니므로 etaAt이
    // 지났어도 자동 입고되면 안 된다 — 승인 게이팅의 핵심 불변식.
    const isPending = po.status === "ORDERED" || po.status === "IN_TRANSIT";
    // INBOUND_HOLD는 이미 도착했지만 창고 용량 때문에 묶인 화물이다 — etaAt은 이미 지났으므로
    // 다시 확인하지 않고, 매 tick 용량을 재평가해서 풀리면 자동 입고한다. 그렇지 않으면 창고가
    // 회복돼도 한 번 보류된 PO는 영원히 재정산되지 않고, planInbound의 inTransit에는 계속
    // 잡혀서 재발주까지 막혀 재고 0에서도 영구 결품이 된다(실관측: 자재 7종).
    const isAlreadyHeld = po.status === "INBOUND_HOLD";
    if (!isPending && !isAlreadyHeld) continue;
    // 도착 판정은 운영시각으로 한다 — 리드타임이 운영시간이기 때문이다. etaOperatingMs가 없는
    // 옛 PO(운영시계 도입 전 발주분)는 벽시계 etaAt으로 정산해 하위호환을 지킨다.
    if (isPending) {
      const arrived = po.etaOperatingMs != null && operatingEpochMs != null
        ? operatingEpochMs >= po.etaOperatingMs
        : now.getTime() >= po.etaAt.getTime();
      if (!arrived) continue;
    }
    // 박물류(LOGISTICS)가 목적창고를 CAPACITY_OVER로 판단하면, 도착 시각이 됐어도 자동으로
    // 재고에 반영하지 않는다 — 오늘 이것 때문에 창고가 654%까지 넘쳤다. 사람이 확인해야
    // 실제 입고된다(INBOUND_HOLD).
    // 결품 임박 자재는 용량 초과여도 받는다. 용량 보류(박물류)와 자재차단(이자재+최생산)이
    // 서로를 먹여 살리는 교착을 끊는 지점이다 — 목적창고가 초과면 그 자재는 영원히 못 들어오고,
    // 못 들어오니 COVERAGE_CRITICAL이 안 풀려 라인이 서고, 라인이 서면 소모가 없어 창고도 안
    // 빠진다(실관측: 차단 로트 97~100%인데 원인 자재는 3종, 그 3종 보충분이 전부 INBOUND_HOLD).
    // 실제 팹에서 라인 정지와 통로 적치 중 하나를 골라야 하면 후자를 고른다. 나머지 자재의
    // 보류는 그대로라 창고가 무제한으로 넘치지는 않는다.
    const urgent = urgentMaterialIds?.has(po.materialId) === true;
    if (!urgent && po.destinationWarehouseId && capacityOverWarehouseIds?.has(po.destinationWarehouseId)) {
      // 이미 INBOUND_HOLD인 PO는 다시 heldPoIds에 넣지 않는다 — 엔진의 held 카운트는 "이번
      // tick에 새로 보류된 건수"를 뜻하고, 상태도 이미 INBOUND_HOLD라 갱신이 no-op이다.
      if (!isAlreadyHeld) heldPoIds.push(po._id);
      continue;
    }
    receipts.push({ poId: po._id, materialId: po.materialId, qty: po.qty });
    arrivedPoIds.push(po._id);
  }
  return { receipts, arrivedPoIds, heldPoIds };
}
