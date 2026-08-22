# 재고 프로비저닝 · 창고 Capacity 진단 및 수정 계획

- **작성일**: 2026-07-25
- **상태**: 운영재고 집계 현실화 적용 완료 · LOT/HU 상세 투영 보정은 후속 · [2026-08-09] 완제품 창고 단위 버그·INBOUND_HOLD 교착 모두 코드 수정 완료(완제품 창고 DB 마이그레이션은 대기) · [2026-08-09] 김구매 승인 게이트↔08-08 자동실행 정책 충돌은 SLA 타임아웃으로 절충 완료
- **발단**: 사용자 "가용 재고가 너무 적은 애들이 많다, 왜 이런 문제가 생겼는지 보자. 엔진이 안정적으로 돌게 자재를 여유있게 셋팅하고 창고 capacity·3D까지 검토하자."

## 진단 (systematic-debugging, 근거 기반)

### 결론: 엔진 탓 아님. 오프닝 재고가 예전 소규모 기준으로 시딩된 뒤 재스케일이 안 됨.

- **엔진은 재고를 거의 안 태웠다**: `twinBurnEvents` 총합 GAS-018 3개, CHM-004 13개 수준(27틱). 재고는 엔진 가동 전부터 이미 바닥.
- **오프닝 재고가 의도된 기준의 1/17~1/100**: `seed.ts:485` 공식은 `dailyUsage × ropDays`(DOH=ropDays)로 재고를 잡게 돼있음. GAS-001이면 ~242,000개가 나와야 하는데 DB엔 2,356개. → 소비 마스터가 117K WSPM으로 상향된 뒤 **오프닝 재고 프로비저닝이 현재 스케일로 적용된 적이 없음**.
- DOH 분포(designed): <1일 2개, 1~3일 14개, 중앙값 13.9일 — bimodal(소비 많은 가스·핵심 화학이 바닥).

### 오탐 정정 2건 (초기 가설 → 근거로 기각)
- ~~"processUsage 드리프트 728K vs 124K"~~ → **오탐**. GAS-001은 M20/M21/M22 공용이라 전팹 합계(728K)를 M20 단독(124K)과 비교한 측정 오류. `migrate-m20-material-consumption` DRY-RUN `changed=0` — M20 processUsage는 코드 마스터와 일치.
- 엔진 `avgDailyBurn`이 designed 대비 ~110× 부풀려짐: WIP를 5초/스텝(타임랩스)으로 진행시키는데 그 소비를 "실시간 일일소비율"로 EMA 환산해서 발생. **재고 부족의 원인은 아님**(ROP 표시만 과대). 별도 캘리브레이션 이슈로 분리.

### 핵심 발견: 벌크 가스 오모델링이 진짜 병목 (왜 재고를 작게 눌러놨는지 설명)
- **GAS-001(N2)이 unit="봄베"(실린더, 환산 0.5)로 모델됨.** ropDays 기준 스케일업하면 target 242,833개 × 0.5 = **121,416 파렛트** — 물리적으로 불가능.
- 가스 야드 창고가 이미 초과: **BCY-01 233%(cap 100), BGY-01 2,249%(cap 100)** — 현재 작은 재고로도 넘침.
- **인과 해석**: 벌크 가스가 실린더로 잘못 모델돼서 재고를 조금만 넣어도 capacity가 터지니, 오프닝 재고를 억지로 작게 유지해온 것. 순진한 스케일업은 창고를 폭발시킴.
- 추가 불일치: `inventory.avgDailyUsage` 필드가 processUsage 기반 실제 일일소비보다 훨씬 작게 stale(GAS-001 저장값 ~235 vs 실제 20,121/일). ROP/DOH 계산이 무엇을 읽느냐에 따라 달라짐.

### 벌크 재모델링 대상 (전팹 일일소비 × ropDays 실린더 환산 1,000+ 파렛트)
GAS-001(24,283/일), GAS-003(1,891), GAS-008(1,208), GAS-004(560), GAS-006(220), GAS-009(651), GAS-002(647), GAS-010(136), GAS-017(111), GAS-018(73). → 고소비 벌크(N2·O2·Ar·H2급). 저소비 특수가스는 실린더 유지.

## 수정 계획 (사용자 결정: "벌크 저장으로 재모델링", 버퍼는 자재별 ropDays=업계표준)

**순서 중요 — naive 스케일업 금지.**

1. **벌크 가스 재모델링** — 위 대상 가스를 벌크 저장으로 전환: `palletFactor=0`(파렛트 미점유) + 별도 탱크 용량 개념(신규 필드 or 벌크 warehouse 유형). 3D/창고 점유에서 제외하고 탱크 게이지로 표현.
2. **`inventory.avgDailyUsage` 재싱크** — processUsage 기반 실제 일일소비로 갱신(ROP/DOH 정합). 재싱크 스크립트 필요(dry-run/apply).
3. **이산 자재(화학·소모품·저소비 가스)만 ropDays DOH 스케일업** — 기존 `db:scale-opening-inventory`(dailyUsage×ropDays, dry-run/rollback 지원) 사용. 벌크 가스는 이 스케일업에서 제외하거나 탱크 DOH로 별도 처리. capacity 여유 확인됨(HZW-01 46%, MWH 52~70%).
4. **벌크 가스 탱크 용량 별도 관리 + 3D 반영** — 창고 capacity 페이지/3D에 벌크 탱크를 파렛트 창고와 구분해 표시.
5. **(분리) 엔진 avgDailyBurn 캘리브레이션** — 타임랩스↔실시간 정합. 이번 remediation과 독립. 배속 기능과 함께 다룰 것.

## 미결정/설계 필요
- 탱크 용량을 어디에 저장할지(신규 `bulkTankCapacity` 필드 vs 벌크 warehouse zoneType).
- 벌크 재모델링 대상 가스의 정확한 경계(소비량 임계 vs 실제 공급 방식 태깅).
- 스케일업을 벌크 제외 후 실행하는 방식(스크립트 필터 추가).

## [2026-07-25 추가] 진행 상황 & 추가 발견

- **Task 1 (엔진 캘리브레이션) 완료·커밋 aa52759**: `engine.ts`의 avgDailyBurn을 실벽시계 dtDays(5초=5.79e-5일) 대신 `simDaysPerTick(M20_CYCLE_DAYS=105, totalSteps≈130)≈0.808일`로 정규화. ~1.7만배 왜곡 제거. `scripts/test-twin-calibration.ts`로 순수+통합 검증. daily-control(ProcessUsage 기준)과 정합.
- **오염 정리 완료**: 전 자재 `inventory.avgDailyBurn=0` 리셋, bogus PO 47건(총 7.4M) 삭제, stale twinBurnEvents 909건 삭제. 엔진 PAUSED 복귀.
- **[신규 발견 — 별개 버그] 코호트 이름 불일치로 엔진이 실제 WIP를 안 태움.** 실제 가동 WIP는 `cohort="MODELED_FOUP"`(14,028 IN_PROGRESS)인데(`lot-route.ts:178`·`foup-wip-server.ts:23`이 이걸 읽음), 트윈 엔진이 매 tick 호출하는 `advanceAggregateWip`은 `cohort="AGGREGATE"`(`lot-route.ts:217`)만 진행 — 그건 사실상 0개(1개 DONE). **즉 트윈 엔진은 실제 생산 WIP를 한 번도 소모한 적이 없음**(테스트가 심은 AGGREGATE 로트만 태웠음). AGGREGATE↔MODELED_FOUP 네이밍이 반복 개발 중 갈라진 것. 수정 방향: `advanceAggregateWip`을 MODELED_FOUP 대상으로 전환하거나 코호트 정본화. 단 14k 로트가 실제로 진행되므로 부작용(P10 패키징 진입 시 createM20PilotWorkOrder 미호출 가드는 이미 있음, 3D 표시 영향) 확인 후 진행.
- **[관측] AGGREGATE WIP 고갈**: 별도로, AGGREGATE 코호트 자체가 완료·소진돼 신규 착수(ensureAggregateWip)로 유지되지 않으면 엔진이 태울 대상이 계속 비어감.

## 재현/검증에 쓴 방법
- `twinBurnEvents` 집계로 엔진 소비량 확인 / `m20MaterialDemandForScenario` vs DB processUsage 비교 / `apply-opening-inventory-scaleup` DRY-RUN(totalDelta 286,399) / `capacity.ts materialFactor`로 창고별 점유 투영.

## [2026-07-26] 운영재고 현실화 적용 결과

- 적용 버전: `OPERATIONAL_REALISM_V1`
- 감사 배치: `REALISM-2026-07-26T00:16:09.918Z-46d8db`
- 63개 자재를 공급모드별 기준 시설에 하나의 운영재고 행으로 정규화했다. GAS-001의 BGY/HZW 중복 행도 BGY 기준 행으로 통합했다.
- 벌크 가스는 `Nm³`, 벌크 케미컬과 전구체는 `L`, Base Die는 `KGD_DIE`를 운영 기준단위로 사용한다. 발주단위와 보관공간 환산은 별도 필드로 분리했다.
- 목표수량은 `max(현재수량, 안전재고, 일사용량 × max(ROP일수, 리드타임))`으로 설정했다. 적용 후 5일 미만 자재는 26개에서 0개, 사용량 스케일 불일치 후보는 39개에서 0개, 중복 재고행은 1개에서 0개가 됐다.
- 재실행 드라이런은 `totalDelta=0`, `duplicateRows=0`으로 멱등성을 확인했다. 모든 시설의 계획 점유율은 한도 이내다.
- MWH-01 3,500 pallet, PRS-01 800 canister slot은 실제 WMS 실측이 아닌 계획 기준값이다. 자재 사용량도 다수가 `LEGACY_DERIVED / LOW`이므로 MES·유량계·WMS 실적이 들어오면 교체해야 한다.
- aggregate 운영재고와 기존 LOT/HU 상세 투영은 아직 일치하지 않는다. 재감사 결과 LOT 7개, HU 57개가 불일치하며, 운영재고 현실화 배치가 임의의 제조 LOT나 용기를 생성하지는 않았다.
- 원복: `npm run db:realize-operational-inventory -- --rollback REALISM-2026-07-26T00:16:09.918Z-46d8db`

## [2026-07-26] LOT/HU 실물 투영 정합화

- 적용 버전: `OPENING_RECONCILIATION_V1`
- 적용 배치: `RECON-2026-07-26T00:59:34.729Z-c9025d`
- stale 예약 복구 배치: `RESERVATION-REPAIR-2026-07-26T00:55:40.940Z-b7bb39`
- 삭제된 테스트 WorkOrder·Transfer를 참조하던 PKG-001 HU 98kg 예약 1건을 해제하고 Lot 가용량으로 되돌렸다.
- 기존 58개 고아 HU는 삭제하거나 수량을 바꾸지 않고, 원래 `inventoryLotId`로 HOLD 복구 Lot을 생성해 참조를 복원했다.
- 기존 실물 투영을 제외한 부족량은 자재별 모델 재고 포지션 58개로 추가했다. 생성 Lot/HU는 모두 `HOLD`, `PENDING_PHYSICAL_VERIFICATION`, `MODELED_CONTAINER_GROUP`이며 실제 공급사 Lot·제조일·유효기한을 만들지 않았다.
- aggregate `inventory`는 변경하지 않았다. 적용 후 재실행은 `recoveryLots=0`, `fillHU=0`, `openingPositions=0`, `blocked=0`이다.
- 상태 기반 재감사 결과 `lotMismatch=0`, `huMismatch=0`, `orphanHu=0`이다. `IN_TRANSIT`, `RECEIVED`, `LINE_SIDE`, `CONSUMED`는 창고 on-hand에서 제외하고 `RESERVED`, `STAGED`는 Lot 가용량에 다시 더해 비교한다.
- CSM-016~019는 `RATE_TBD / CALIBRATION_REQUIRED`이고 수요·안전재고·aggregate가 모두 0이므로 `SKIPPED_UNCALIBRATED_ZERO_BASELINE`으로 기록했으며 Lot/HU를 생성하지 않았다.
- 정합화 원복: `npm run db:reconcile-inventory-projections -- --rollback RECON-2026-07-26T00:59:34.729Z-c9025d`
- stale 예약 복구 원복: `npx tsx scripts/repair-stale-inventory-reservations.ts --rollback RESERVATION-REPAIR-2026-07-26T00:55:40.940Z-b7bb39`

## [2026-07-26] 현장 실물검증 큐 V1

- 적용 버전: `INVENTORY_VERIFICATION_V1`
- `OPENING_RECONCILIATION_V1`이 만든 Opening Position 58개와 1:1인 Verification Case 58개를 생성했다.
- 재실행 결과 `planned=0`, `existing=58`, `blocked=0`으로 중복 생성되지 않는다.
- CSM-016~019는 `RATE_TBD / CALIBRATION_REQUIRED`이므로 Case 생성 0건이다.
- 관측 제출은 `LOGISTICS` 역할만 가능하며 `requestId`, Case `version`, 평문 십진수량, Case UOM, 동일 창고의 실제 등록 위치, 외부 증빙 참조를 요구한다.
- Observation과 Event는 불변 이력으로 추가하고 Case만 `AWAITING_OBSERVATION → OBSERVED`로 전환한다. inventory, Lot, HU, Movement는 변경하지 않는다.
- reconciliation hold 위치는 실제 관측 위치로 제출할 수 없다. 현재 실제 위치 마스터는 MWH-02에만 2개가 있으며, BCY-01·MWH-01·MRO-01·BGY-01·HZW-01·PRS-01은 실제 위치 등록 전까지 제출 버튼이 비활성화된다.
- 독립 검토, 차이 승인·전표, HOLD 해제는 V2 후속 슬라이스이며 이번 단계에서는 제공하지 않는다.

## [2026-08-09] 완제품 창고 단위 합산 + INBOUND_HOLD 교착 — 3팹 생산 정지 원인

- **발단**: 사용자 "결품 원인 파악 + 완제품 생산 정지 여부" 요청.
- **완제품 창고 단위 합산**: DRAM/NAND 확장 때 완제품 창고 마스터를 같이 올리지 않아, 3제품이 `WH-FG01`(HBM 기준 STACK 용량) 하나를 공유하고 있었다. `getWarehouseCapacity()`(`src/lib/queries.ts:198-202`)는 완제품 점유를 단위 구분 없이 raw 합산하므로 STACK(HBM)·CHIP(DRAM)·DIE(NAND) 수량이 그대로 더해졌다. HBM 재고가 132일치(약 2,510만 STACK, 198%)까지 쌓이면서 CAPACITY_OVER 판정이 DRAM·NAND WIP까지 마지막 스텝에서 함께 정지시켰다.
  - **수정 완료**: `finishedGoodsWarehouseFor(product)`(`src/lib/finished-goods.ts`)로 제품별 창고(`WH-FG01`/`02`/`03`)를 분리하고, `src/lib/twin/engine.ts`의 `finishedGoodsCapacityOver` 판정도 제품 루프 안에서 자기 창고만 보도록 변경. 시딩·이관: `scripts/migrate-finished-goods-warehouse-split.ts`(`npm run db:migrate-fg-warehouse-split`, 멱등), 검증: `scripts/test-finished-goods-warehouse-split.ts`. 상세는 [`warehouse-capacity-master.md`](./warehouse-capacity-master.md#52-완제품-창고-finished-goods) §5.2. DB 마이그레이션은 실행 전이며 실행 전까지 DB에는 `WH-FG01` 하나만 있을 수 있다.
- **INBOUND_HOLD 교착**: 창고 CAPACITY_OVER로 `INBOUND_HOLD`가 걸린 PO가 두 가지 이유로 재고 0에서도 재발주를 못 뚫는 구조였다.
  1. `settleArrivals`(`src/lib/twin/inbound.ts:56`)는 `ORDERED`/`IN_TRANSIT` PO만 처리했다 — 창고 여유가 회복돼도 `INBOUND_HOLD` PO는 자동 정산(입고)되지 않았다.
  2. `planInbound`의 `inTransit` 집계(`src/lib/twin/engine.ts:270`)는 `status: { $nin: ["RECEIVED", "REJECTED"] }`로 열려 있는 PO를 전부 "입고 중" 물량으로 세므로, 도착 못 한 `INBOUND_HOLD` 물량이 "이미 오고 있다"로 잡혀 신규 발주까지 억제했다.
  - 두 문제가 겹치면 재고가 0이어도 영구 결품에 갇힌다. 위 완제품 창고 단위 버그가 CAPACITY_OVER를 유발한 방아쇠 중 하나였다. 실관측: 자재 7종이 이 상태였고, 3팹 생산 정지의 직접 원인이었다.
  - **수정 완료(2026-08-09)**: `settleArrivals`가 매 tick `INBOUND_HOLD` PO도 재평가해서 목적창고 용량이 풀리면 자동 정산한다(`inTransit` 집계는 건드리지 않음 — HOLD PO가 자동으로 풀리게 되므로 "입고 중"으로 세는 게 다시 맞는 동작이 된다). 사람이 화면에서 수동 해제(`releaseTwinInboundHold`)하는 것과 twin tick이 같은 PO를 동시에 처리할 수 있어서(둘 다 twin 락을 공유하지 않음), 재고를 더하기 전에 상태 전이(`RECEIVED`)를 먼저 원자적으로 선점하고 실패하면 건너뛰도록 두 경로(`engine.ts`, `inbound-hold-decision-server.ts`, `scripts/release-inbound-holds.ts`) 모두 순서를 맞춰 이중 입고를 막았다. 회귀 테스트: `scripts/test-twin-inbound.ts`. 수동 강제 해제(용량이 아직 안 풀렸어도)는 여전히 `npm run ops:release-inbound-holds` 또는 `/erp-bridge` 화면 액션으로 가능하다.
- **후속 스코프 노트(별건, 미착수)**: `Product` 타입이 `"HBM"|"DRAM"|"NAND"` 3개뿐이고 각 Fab의 `modelProduct`도 1개(`M20-HBM4-12H-V1` 등)다. 실제로는 NAND 512Gb/1Tb/TLC/QLC, DRAM 16Gb/24Gb처럼 Fab 하나가 여러 SKU를 동시에 생산하며, `route-master`도 `fabId:product` 단일 키라 SKU 축이 없다. 다중 SKU 모델링은 이번 조사 범위 밖이라 별도 설계가 필요하다.

## [2026-08-09] 김구매 승인 게이트 — 2026-08-08 자동실행 정책과 충돌 → SLA 타임아웃으로 절충

- **배경**: 사용자 질문("김구매는 입고를 본인이 판단 안해?")에서, `PENDING_APPROVAL` 승인 UI·API·decision-server는 이미 다 구현돼 있는데 `engine.ts`가 PO 생성 시 `status`를 `ceiling.level`과 무관하게 항상 `"ORDERED"`로 하드코딩해서 이 파이프라인이 한 번도 작동한 적이 없었던 걸 발견. `initialPurchaseOrderStatus(ceilingLevel)`(`procurement-agent.ts`)로 L2(위험물·단일소싱)는 `PENDING_APPROVAL`로 묶이도록 고쳤다.
- **충돌 발견**: 이 변경이 **2026-08-08에 이미 내려진 사용자 결정**과 정반대였다 — `scripts/autonomize-pending-approvals.ts` 헤더: "사용자 결정: 김구매가 스스로 판단해서 실행하고, 사람의 승인 클릭을 요구하지 않는다. engine.ts는 이미 앞으로의 신규 발주에 이 정책을 적용하도록 고쳤다." 즉 `status: "ORDERED"` 하드코딩은 미구현이 아니라 그날 41건을 수동 정리하며 내린 의도적 정책이었다. `git log`만으로는 "항상 ORDERED였다"만 보이고 이 맥락은 안 보여서 최초 판단이 틀렸었다 — 정책성 변경 전에는 관련 스크립트·devlog까지 확인해야 한다.
- **문제의 재현**: 승인 게이트를 되살리면 `INBOUND_HOLD`와 같은 구조의 교착이 재현된다 — `PENDING_APPROVAL` PO는 `planInbound`의 `inTransit`에 계속 잡히는데, 사람이 승인 버튼을 안 누르면 영원히 안 풀려서 그 자재는 재발주까지 막힌다.
- **해결(사용자 선택 — SLA 타임아웃 절충안)**: 승인 게이트는 유지(위험물·단일소싱 자재는 여전히 `PENDING_APPROVAL`로 시작 — 오늘 요청한 투명성 확보), 대신 `approvalEscalationTier`가 URGENT(60분 이상 방치)에 도달하면 twin tick이 자동으로 승인 처리한다 — `shouldAutoApprovePendingOrder(waitingMinutes)`(`procurement-agent.ts`). 사람이 화면에서 먼저 승인/반려하면 그게 우선이고, 60분 안에 아무도 안 누르면 자동으로 풀려서 08-08이 막으려던 "영원히 막히면 안 된다"는 취지를 지킨다. 사람의 수동 승인(`decideTwinPurchaseOrder`)과 twin tick의 자동 승인이 동시에 같은 PO를 처리할 수 있어 상태 전이를 원자적으로 선점하는 방식(이중 처리 방지)으로 구현. 회귀 테스트: `scripts/test-procurement-agent.ts`.
- **미착수 대안(참고)**: 옆 세션이 별도로 3인 기획팀을 돌려 "계약범위(blanket PO/VMI) 안에서는 무승인 자동, 초과 시에만 사람 승인"이라는 대안도 제시함(`agentPolicies`에 `contractMonthlyQty` 추가하는 안) — 이번엔 채택 안 함, 필요해지면 후속 검토.

## [2026-08-10] 관제탑 4-에이전트 가정법 제거 + EMA 아사 나선 + tick 겹침 수정

- **관제탑 가정법 제거**: 사용자가 관제탑 라이브에서 김구매가 "~했을 것"(가정법)으로 말하는 걸 지적. 4개 에이전트 전수 점검 — 박물류·이자재는 이미 실제 상태 기반, `/api/twin/control-tower/route.ts`의 최생산도 이미 라이브 신호로 고쳐져 있었음(K1). 김구매만 별도의 온디맨드 그림자 시뮬레이션(`runProcurementShadow`/`buildProcurementShadow`, engine.ts의 실제 발주·승인 상태와 무관)을 그대로 썼고, AI 스냅샷 경로(`control-tower-snapshot-server.ts`)는 최생산도 여전히 죽은 `workOrders`를 참조 중이었다 — 두 화면이 서로 다른 시점에 고쳐지며 벌어진 간극. `procurement-agent.ts`에 `buildLiveProcurementShadow` 신규(실제 `twinPurchaseOrders` PENDING_APPROVAL/INBOUND_HOLD 상태를 가정법 없이 서술) → 관제탑 라이브·AI 스냅샷 두 경로 모두 교체, 최생산도 두 경로를 `buildAggregateProductionShadow`로 통일. `control-tower-live.ts`의 `procurementRule` 타입 필드도 실제 필드로 교체. 회귀 테스트: `scripts/test-procurement-agent.ts`.
- **EMA 아사 나선(자기강화 결품 루프)**: `engine.ts`가 EMA(`avgDailyBurn`)에 실제 요청량(`qty`)이 아니라 `burnInventoryProjection`이 반환한 `burned`(재고 부족 시 `min(onHand, qty)`로 깎인 값)만 넣고 있었다. 재고가 부족할수록 `burned`가 작아지고 → EMA가 내려가고 → ROP·재주문 판단이 낮아진 EMA를 기준으로 하니 발주가 더 안 나가고 → 재고가 더 부족해지는 자기강화 나선이었다. 실관측: 결품률 08-05 40% → 08-09 73% 악화, GAS-024·GAS-010이 설계수요의 32%까지 자기부양. 수정: `observedDailyDemand(trueDemandQty, emaSimDays)`(`twin/inbound.ts` 신규 pure 함수)로 `burned` 대신 `burned+shortfall`(=요청 `qty` 그대로)을 EMA에 반영. 기존 3배 상한(`BURN_EMA_CEILING_MULTIPLIER`)·3배 스파이크 클립은 그대로 유지돼 폭주 위험은 낮다. 회귀 테스트: `scripts/test-twin-inbound.ts`.
- **tick 겹침**: `LOCK_TTL_MS`가 30초였는데 자재 44종에 대한 N+1 순차 쿼리(tick당 약 480회)로 실측 tick 소요가 95초였다. `state.ts`의 `acquireTwinLock`은 `lockExpiresAt`이 지나면 만료로 보고 락을 내주므로, 30초 시점에 락이 풀리고 `scheduler.ts`의 5초 간격 `setInterval`이 다음 tick을 또 실행 — 같은 tick이 동시에 여러 개 돌았다. `advanceStepBucketWip`(findOne→계산→updateOne)이 lost update, `burnInventoryProjection`의 `$inc`가 비멱등이라 같은 소모가 두 번 차감되는 문제로 이어졌다. 수정: (1) `LOCK_TTL_MS`를 300초로 상향(실측 tick 소요보다 여유 있게), (2) `scheduler.ts`를 `setInterval`에서 self-scheduling `setTimeout` 체인으로 전환 — 다음 tick은 이전 tick의 Promise가 완전히 끝난 뒤에만 예약되므로 같은 프로세스 안에서는 겹침이 구조적으로 불가능해진다.
- **N+1 쿼리 제거(2026-08-10, 후속 완료)**: tick이 95초 걸리는 근본 원인이었던 자재별 순차 조회(자재/창고 게이팅·소모·발주 3개 구간이 각각 `resolveWarehouse`+`inventory.findOne`+`materials.findOne`을 자재마다 다시 호출 — 최대 44종×3회씩 중복)를 tick 시작 시 `$in` 배치 조회 2건(`inventory.find`, `materials.find`)으로 바꿨다. `resolveWarehouse` 함수는 삭제하고, 자재별 대표 창고·재고·EMA를 in-memory 스냅샷(`invSnapshotByMaterial`) 하나로 관리한다 — 소모 구간(②)이 실제 DB 쓰기(`burnInventoryProjection`/`inventory.updateOne`)와 같은 시점에 이 스냅샷도 함께 갱신해서, 입고 구간(③)이 이번 tick에 소모된 이후의 최신 재고·EMA를 정확히 보게 했다(락으로 tick 내 단일 쓰기자임이 보장되므로 안전). PO 관련 쿼리(`openPOs`/`lastPO`/발주·정산 쓰기)는 이번엔 자재별 개별 쿼리로 남겨뒀다 — 오늘 새로 만든 상태전이 로직(SLA 자동승인·이중입고 방지 claim)과 얽혀 있어 배치화는 별도 검증이 필요한 후속 과제로 분리.
- **적용 방법**: 위 스케줄러·EMA 변경은 코드지만, `startTwinScheduler()`가 서버 기동 시 1회만 실행되므로 **dev 서버(또는 배포) 재기동 후에만 실제로 적용된다.**
