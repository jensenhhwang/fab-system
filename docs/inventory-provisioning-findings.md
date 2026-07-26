# 재고 프로비저닝 · 창고 Capacity 진단 및 수정 계획

- **작성일**: 2026-07-25
- **상태**: 운영재고 집계 현실화 적용 완료 · LOT/HU 상세 투영 보정은 후속
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
