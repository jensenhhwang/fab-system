# M20 Twin Physics Engine 설계 스펙

- **작성일**: 2026-07-25
- **상태**: 사용자 승인 대기 → (승인 후) 구현
- **목표**: M20 디지털 트윈이 "각 공정이 실시간으로 재고를 태우고, 입고 엔진이 창고를 다시 채우는" 살아있는 물리 시스템이 되게 한다. 자재별 실시간 소모/입고 현황을 화면에서 본다.
- **관련 메모**: [[project-mes-process-modernization]]

## 1. 배경 & "버그" 재평가

시작은 "공정 소비 시 재고가 안 깎이는 버그"였으나, 전체 자재 흐름을 추적한 결과 **버그가 아님**을 확인했다.

M20 자재의 실제 재고 차감 지점:

| 단계 | 위치 | 차감 대상 |
|------|------|-----------|
| ① 예약 | `m20-agent-service.ts` | `inventoryLots.availableQuantity` |
| ② 출고 IN_TRANSIT | `twin/transfers/[id]/transition/route.ts:102` | **`inventory.quantity`(창고 on-hand) ← 창고 재고는 여기서 이미 정확히 차감** |
| ③ 입고 RECEIVED | `transition/route.ts:115` | `fabMaterialStocks`(PRS) 증가 |
| ④ 인계 DELIVERED | `transition/route.ts:135` | `fabMaterialStocks`(LINE_SIDE) 증가 |
| ⑤ 소비 | `mes/workorders/[id]/consume/route.ts:44` | `fabMaterialStocks`(LINE_SIDE) 차감 |

`consume`에 `decreaseInventoryProjection`을 추가하면 창고 재고가 **이중 차감**된다(②에서 이미 깎임). Daily Control이 읽는 `inventory`(`daily-control-live.ts:54`)는 창고 on-hand이고, 라인사이드는 별개 물리 위치다. 장부는 이미 정합적이므로 이 "버그 수정"은 하지 않는다.

**진짜 gap**: 자재를 실제로 태우는 건 VISUAL FOUP 12개가 패키징(P10)에 도달할 때뿐. 실제 생산 물량인 AGGREGATE 코호트(~1.4만~1.6만 WIP)는 아무것도 소비하지 않고, 나머지 자재는 월평균 추정으로만 깎인다. 디지털 트윈이 생산 스케일의 재고 소진을 반영하지 못한다.

## 2. 설계 개요

기존 두 시계를 결합한다:

- **WIP 시계** `advanceAggregateWip()` (`lot-route.ts`) — FOUP 로트를 스텝으로 진행. 자재는 안 태움.
- **시뮬 시계** `sim-runner.ts` — 자재 소모+ROP발주+리드타임입고. 단 실제 WIP와 무관한 월평균 flat 소모율, 샌드박스(`simulated:true`) lot 위에서 동작. **rewind/checkpoint가 붙은 what-if 계획 도구이므로 건드리지 않는다.**

새 **Twin Physics Engine**을 만들어 라이브 창고 재고(`inventory`)를 구동하되, 검증된 로직(소모 계수, 리드타임/PO)만 재사용한다.

```
서버 스케줄러 (instrumentation.ts → 싱글턴 setInterval, DB 락으로 중복 tick 방지)
   │  매 tick (실제시간 1:1, Δt = now − lastTickAt):
   ├─ ① WIP 진행    advanceAggregateWip()  ← 이미 있음. 이번 tick에 각 스텝을 통과한 웨이퍼 수 반환
   ├─ ② 소모(burn)  Σ(통과 웨이퍼 × equivalentPerWafer)  ← material-consumption.ts 계수 재사용
   │                 → inventory.quantity 자재별 배치 차감
   └─ ③ 입고(inbound) inventory + in-transit < ROP → PO 발주 → 리드타임 후 도착 → inventory 증가 + RECEIPT
                      ← sim-engine의 PO/리드타임 로직을 inventory 타깃으로 이식
```

### 결정 사항 (사용자 확정)
- **소모 대상 레이어 = 창고 `inventory` 직접 차감.** "생산이 곧 창고 소진"으로 배관 단순화. 자재별 실시간 잔량 그래프가 가장 직관적으로 움직인다.
- **입고 시나리오 필수** — 창고를 계속 태우면 0으로 수렴하므로 양방향(소모↓ + 입고↑) 엔진.
- **tick 간격 = 실제시간 1:1.** Δt는 실제 경과 벽시계 시간. 배속은 나중에 `speedMultiplier`(기본 1)만 올려서 확장 — 지금 구조에 필드만 넣어둔다.
- **tick driver = 서버 주도 스케줄러** — 아무도 안 봐도 팹이 계속 돈다.

### 무회귀 경계
- **소모는 AGGREGATE 코호트의 진행만 태운다.** VISUAL 12 FOUP 파일럿은 기존 배관(② 출고 시 `inventory` 차감) 그대로 유지. 둘은 서로 다른 로트 집단이라 이중 차감 없음.
- 기존 `sim-engine`/`sim-runner`/`simPurchaseOrders`(샌드박스)는 변경 없음. 트윈은 별도 컬렉션(`twinPurchaseOrders`, `twinEngineState`)을 쓴다.

## 3. 소모 엔진 (Burn)

매 tick, 자재별로 배치 집계 차감 — 14k WIP를 로트별 이벤트로 쓰지 않아 쓰기 증폭을 피한다.

```
burnByMaterial = {}
for step in material-소모 스텝:               # M20_MATERIAL_CONSUMPTION의 processCode 집합
    wafers = advanceResult.wafersCrossed[step]  # 이번 tick에 그 스텝을 통과한 웨이퍼 수
    for (materialId, equivalentPerWafer) in step의 소모 행:
        burnByMaterial[materialId] += wafers × equivalentPerWafer
for materialId, qty in burnByMaterial:
    inventory.updateOne({ materialId, warehouseId }, { $inc: { quantity: −qty } })   # 클램프: 0 미만 방지
```

- 계수는 `M20_MATERIAL_CONSUMPTION`(`material-consumption.ts`)의 `equivalentPerWafer`. 웨이퍼당 원단위이므로 tick 시간압축과 무관하게 "통과 웨이퍼 수"에만 비례 → 실제 생산과 정합.
- `advanceAggregateWip()`가 스텝별 통과 웨이퍼 수를 반환하도록 확장(현재 반환 형태 확인 후 필요한 최소 필드 추가). 반환하지 않으면 tick 전후 노드 밀도 diff로 산출.
- 창고 재고가 부족하면 가능한 만큼만 차감하고 부족분을 `twinBurnEvents`에 `shortfall`로 기록(생산 중단이 아니라 결품 신호로 표면화).

## 4. 입고 엔진 (Inbound)

매 tick, 자재별로:

```
onHand      = inventory.quantity
inTransit   = Σ twinPurchaseOrders(status ∈ {ORDERED, IN_TRANSIT}, 미도착).qty
rop         = avgDailyBurn × material.ropDays
if onHand + inTransit < rop:
    reorderQty = max(rop × 2 − (onHand + inTransit), 0)   # 재주문 상한까지 채움
    twinPurchaseOrders.insert({ materialId, qty: reorderQty, orderedAt: now,
                                leadTimeDays, etaAt: now + leadTimeDays, status: ORDERED })
# 도착 정산
for po in twinPurchaseOrders(status ≠ RECEIVED, etaAt ≤ now):
    inventory.quantity += po.qty
    inventoryMovements.insert({ type: RECEIPT, materialId, quantity: po.qty, ... })
    po.status = RECEIVED
```

- `avgDailyBurn`은 엔진이 실측한 소모율의 EMA(지수이동평균) — flat 추정이 아니라 살아있는 물량에 반응. `inventory` 문서에 `avgDailyBurn` 필드 추가(EMA 상태 저장).
- 리드타임: `sim-engine.ts`의 `LEAD_TIME_RANGE`/`getBaseLeadTime`을 **공유 모듈 `src/lib/lead-time.ts`로 추출**해 sim과 twin이 공유(중복 제거). 카테고리별 GAS 3~7 / CHM 7~14 / PKG 5~10일.
- PO는 신설 컬렉션 `twinPurchaseOrders`에 저장(샌드박스 `simPurchaseOrders`와 분리).

## 5. 상태 & 스키마

- **`twinEngineState`** (싱글턴 `_id: "singleton"`): `status`(RUNNING/PAUSED), `lastTickAt`, `tickIntervalMs`, `speedMultiplier`(기본 1), `lockedBy`, `lockExpiresAt`(중복 tick 방지 락).
- **`inventory`** (기존): 엔진이 `quantity` 증감. 신규 필드 `avgDailyBurn`(EMA).
- **`twinPurchaseOrders`** (신설): `_id, materialId, qty, orderedAt, etaAt, leadTimeDays, status(ORDERED/IN_TRANSIT/RECEIVED)`.
- **`twinBurnEvents`** (신설, 경량 append): `_id, tickAt, materialId, burnedQty, shortfallQty` — 자재별 실시간 현황/그래프 소스. TTL 또는 tick 카운트로 오래된 것 정리.
- 인덱스: `twinPurchaseOrders`에 `{ status, etaAt }`, `twinBurnEvents`에 `{ materialId, tickAt }`.

## 6. 스케줄러

- **위치**: Next.js 16 `instrumentation.ts`의 `register()` — 서버 부팅 시 1회, 싱글턴 `setInterval` 시작. 별도 프로세스 관리 없음.
- **중복 방지**: 매 tick 시작 시 `twinEngineState`에 락 획득(`lockExpiresAt` 만료 기반 원자적 findOneAndUpdate). 멀티인스턴스/HMR 재시작에도 tick이 겹치지 않게.
- **Δt**: `now − lastTickAt`(실제 경과). tick 주기는 `tickIntervalMs`(기본값 예: 5000ms). 엔진이 멈춰있던 동안의 경과는 다음 tick에서 한 번에 반영(catch-up)하되 상한(예: 최대 Δt clamp)으로 폭주 방지.
- **status=PAUSED**이면 tick 무동작.

## 7. API & 화면

- `GET /api/twin/engine` — 엔진 상태 + 자재별 `{ onHand, avgDailyBurn(/일), rop, inTransit: [{poId, qty, etaAt}], recentBurn }`.
- `POST /api/twin/engine` — `{ action: "start" | "pause" }`, (미래) `{ speedMultiplier }` 운영 레버.
- **UI**: Usage 페이지(또는 신규 트윈 패널)에 자재별 카드 —
  - 현재고 게이지(ROP 대비, ROP 밑이면 경고 톤)
  - burn-rate 스파크라인(`twinBurnEvents` 기반)
  - "입고 중: PKG-001 3,000 (ETA 4일)" in-transit 배지
  - 기존 WATCH/MODEL 배지 패턴 재사용

## 8. 테스트 (TDD)

순수 함수로 추출해 DB 없이 검증:
- `computeBurn(wafersCrossedByStep, coefficients) → burnByMaterial`
- `planInbound({ onHand, inTransit, avgDailyBurn, ropDays }) → newPO | null`
- `settleArrivals(pos, now) → { receipts, updatedPOs }`
- `updateBurnEma(prevEma, observedDailyBurn, alpha) → nextEma`

통합 검증 스크립트 `scripts/test-twin-engine.ts`(dry-run 기본):
- 1 tick 후 inventory 감소량 = Σ(통과 웨이퍼 × 계수) 확인
- 재고를 ROP 밑으로 만들어 PO 생성 확인
- etaAt 지난 PO가 inventory를 늘리고 RECEIPT movement를 남기는지 확인
- VISUAL 파일럿 흐름이 이중 차감되지 않는지(엔진 burn은 AGGREGATE만) 확인

`package.json`에 `test:twin-engine` 스크립트 추가.

## 9. 범위 밖 (YAGNI)

- 배속(speedMultiplier > 1) UI 토글 — 필드만 넣고 실제 배속 기능은 필요 시 추가.
- M21/M22 — M20부터 확실히. 엔진 시그니처는 fabId를 받되 M20 외 즉시 no-op 하드가드.
- 3D 트윈 소진 히트맵, 보충 제안 승인 큐(엑스의 C/D 안) — 엔진이 데이터를 쌓은 뒤 별도 라운드.
- 개별 웨이퍼 단위 계보 추적 — 카디널리티 폭발, FOUP/집계 단위로 충분.
