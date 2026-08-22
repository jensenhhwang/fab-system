# Warehouse Capacity Master — 자재 보관·용량·할당 기준

상태: `DRAFT_FOR_WAREHOUSE_REVIEW`  
버전: `WAREHOUSE_CAPACITY_MASTER_V0.1`  
기준일: 2026-07-25  
대상: 현재 `materials` 63종, `warehouses` 8개 시설

## 1. 문서 목적

이 문서는 각 자재를 **어느 시설·구역에 어떤 형태로 보관하며, 물리·법적 용량 안에서 얼마까지 할당할 수 있는지** 정의하는 기준 초안이다.

```text
material-master.md
  └─ 자재 정체성·FAB/공정 사용처

material-consumption-master.md
  └─ WSPM에 따른 자재 원단위·월소요량

warehouse-capacity-master.md
  └─ 보관 형태·허용 시설/Zone·공간 환산·할당량·물리/법적 상한

WMS 운영 원장
  └─ 실제 Lot·Handling Unit·Location·현재 점유량
```

이 문서는 현재 재고 스냅샷을 고정하는 문서가 아니다. 현재고와 점유량은 DB에서 실시간으로 계산하고, 이 문서는 계산에 사용하는 **변하지 않는 기준과 승인값**만 관리한다.

## 2. 현재 초안의 결론

1. 현재 8개 시설의 `totalCapacity`는 현장 실측값이 아니라 시스템의 `MODELED_BASELINE`으로 취급한다.
2. `BGY-01`, `BCY-01`, `UPW-01`의 `100%`는 물리 용량이 아니라 화면 표시 척도다.
3. `HZW-01.legalLimit = 6,750 cylinder-slot`은 허가증 확인 전 `PLANNING_ASSUMPTION`이다.
4. 현재 `inventory.capacityLimit`은 자재별 승인 할당량으로 사용하지 않는다. 다수 행이 시드 또는 마이그레이션 과정에서 현재고를 기준으로 생성된 계획용 proxy다.
5. `palletFactor`와 단위별 환산표는 현장 포장·적재 사양 승인 전 `MODELED_CONVERSION`이다.
6. 현재 DB에는 자재별 `allocatedCapacity` 원장이 없다. 따라서 이 초안의 자재별 최소·최대 할당량은 임의 숫자를 넣지 않고 `TBD`로 둔다.

## 3. Capacity 용어

| 용어 | 정의 | 현재 시스템 필드 |
|---|---|---|
| `ratedCapacity` | 도면·랙·탱크·설비 사양상 총용량 | `warehouses.totalCapacity`가 계획 기준으로 대행 |
| `usableCapacity` | 통로·정비·차단·운전 상하한을 제외한 실사용 가능량 | 없음 |
| `legalLimit` | 법령·허가·SDS 기준 상한 | `warehouses.legalLimit`, `materials.permittedQuantity` 후보 |
| `allocatableCapacity` | 실제 자재에 배정할 수 있는 총량 | 없음 |
| `guaranteedCapacity` | 특정 자재에 보장한 전용·최소 용량 | 없음 |
| `maximumCapacity` | 특정 자재가 점유할 수 있는 최대 상한 | 없음 |
| `reservedCapacity` | 검수·격리·비상·신규 자재를 위해 비워 둔 공간 | 없음 |
| `occupiedCapacity` | 현재 Lot/HU가 실제 점유한 공간 | 재고수량 × 승인된 환산계수로 파생 |
| `sharedPoolCapacity` | 특정 자재에 고정하지 않은 공용 공간 | 없음 |
| `availableCapacity` | 할당량 안에서 추가 적치 가능한 공간 | 파생값 |

```text
usableCapacity
  = ratedCapacity
  - aisleAndAccessLoss
  - maintenanceExclusion
  - operatingDeadVolume

effectiveLimit
  = min(usableCapacity, legalLimit)  // legalLimit가 있을 때

allocatableCapacity
  = effectiveLimit
  - quarantineReserve
  - operationalReserve

occupiedCapacity(material)
  = Σ(available lot quantity × storageConversionFactor)

availableCapacity(material)
  = maximumCapacity
  - reservedCapacity(material)
  - occupiedCapacity(material)
```

모든 계산은 동일한 `capacityPoolId + capacityUnit` 안에서만 수행한다. `pallet-slot`, `cylinder-slot`, `canister-slot`, `tank volume`, `slot`, `m³/day`를 서로 더하지 않는다.

## 4. 상태와 근거 등급

### 4.1 승인 상태

| 상태 | 의미 | Capacity 판정 사용 |
|---|---|---|
| `DRAFT_TBD` | 구조만 정의되고 값이 미확정 | 사용 금지 |
| `MODELED_BASELINE` | 시스템 계획값으로 채운 상태 | 참고 시뮬레이션만 허용 |
| `OPS_VERIFIED` | 물류·시설 운영 검증 완료 | 일반창고 승인 후보 |
| `EHS_VERIFIED` | 법적·안전·혼재 검증 완료 | 위험물 승인 후보 |
| `APPROVED_ACTIVE` | 운영·EHS·시스템 담당 승인 | What-if 운영 판정에 사용 |
| `RETIRED` | 더 이상 사용하지 않는 기준 | 사용 금지 |

### 4.2 근거 등급

| 등급 | 의미 |
|---|---|
| `MODELED_BASELINE` | 현재 시스템 화면·시뮬레이션용 계획값 |
| `MODELED_CONVERSION` | 단위별 공통표로 계산한 적치 환산 |
| `FIELD_MEASURED` | 현장 실측·도면으로 확인 |
| `EQUIPMENT_SPEC` | 랙·탱크·설비 사양서로 확인 |
| `PERMIT_VALIDATED` | 허가증·법적 기준으로 확인 |
| `SOP_APPROVED` | 운영/EHS SOP와 담당자 승인 완료 |

승인 상태와 근거 등급을 섞지 않는다. `FIELD_SURVEY_REQUIRED`, `EQUIPMENT_SPEC_REQUIRED`, `SAFETY_REVIEW_REQUIRED`는 승인 상태가 아니라 현재 부족한 증거를 나타내는 `reviewGap`이다.

## 5. 시설 Capacity Master

| 시설 | 시설명 | Mode | 현재 계획 Capacity | 법적 상한 | 이 문서의 해석 | 승인 / Review Gap |
|---|---|---|---:|---:|---|---|
| `MWH-01` | 자동화 자재창고 (AS/RS) | `SPACE` | 2,000 pallet | TBD | AS/RS 총 팔레트 계획값. 비가용 랙·통로 제외 전 | `MODELED_BASELINE` / `FIELD_SURVEY_REQUIRED` |
| `MWH-02` | 항온 자재창고 | `SPACE` | 2,600 pallet | TBD | 항온 구역 전체 팔레트 계획값. 온도 Zone별 분할 필요 | `MODELED_BASELINE` / `FIELD_SURVEY_REQUIRED` |
| `HZW-01` | 특수가스 위험물창고 | `SPACE` | 7,500 cylinder-slot | 6,750* | 독성·자연발화성·산화성 Zone 분할 전 총계 | `MODELED_BASELINE` / `SAFETY_REVIEW_REQUIRED` |
| `MRO-01` | 공구·MRO 창고 | `SPACE` | 2,200 slot | TBD | 개체관리 슬롯 계획값. 품목별 용적 차이 미반영 | `MODELED_BASELINE` / `FIELD_SURVEY_REQUIRED` |
| `BGY-01` | 벌크가스 야드 | `TANK_LEVEL` | 100% | 탱크별 TBD | 총용량이 아님. N₂·H₂·Ar·O₂·CO₂·He 자산별 탱크 원장 필요 | `DRAFT_TBD` / `EQUIPMENT_SPEC_REQUIRED` |
| `BCY-01` | 벌크케미컬 야드 | `TANK_LEVEL` | 100% | 탱크별 TBD | 총용량이 아님. 물질별 전용 탱크·운전 상하한 필요 | `DRAFT_TBD` / `EQUIPMENT_SPEC_REQUIRED` |
| `PRS-01` | 전구체 공급실 | `SPACE` | 500 canister-slot | 물질별 TBD | 캐니스터 규격·가스캐비닛별 허용 수량 확인 전 계획값 | `MODELED_BASELINE` / `SAFETY_REVIEW_REQUIRED` |
| `UPW-01` | 초순수 생산시설 | `CONTINUOUS` | 100% | 해당 없음 | 창고 Capacity가 아님. 생산능력과 Buffer tank를 분리해야 함 | `DRAFT_TBD` / `EQUIPMENT_SPEC_REQUIRED` |

`*` HZW-01의 6,750은 현재 코드에 있는 계획상 한도다. 실제 허가 수량으로 승인하려면 사업장 허가증과 Zone별 허용량을 연결해야 한다.

### 5.1 필요한 Capacity Pool

| 시설 | 필수 Pool | 단위 | 현재 rated | 비고 |
|---|---|---|---:|---|
| MWH-01 | `PALLET_AMBIENT` | pallet-slot | 2,000 계획값 | 랙/비가용 위치 분리 필요 |
| MWH-02 | `PALLET_TEMP_*` | pallet-slot | 2,600 계획값 | 온도·차광 Zone별 분리 |
| HZW-01 | `CYL_TOXIC`, `CYL_PYROPHORIC`, `CYL_OXIDIZING` | cylinder-slot | Zone별 TBD | 혼재금지 경계 |
| MRO-01 | `MRO_TARGET`, `MRO_PROBE`, `MRO_PARTS` | slot | 품목군별 TBD | 개체 크기·검사대기 구분 |
| BGY-01 | `TANK_<MATERIAL>` | m³ 또는 kg | 탱크별 TBD | 물질 간 공유 금지 |
| BCY-01 | `TANK_<MATERIAL>` | m³ 또는 L | 탱크별 TBD | 산·알칼리·산화제 공유 금지 |
| PRS-01 | `CAN_<MATERIAL>` | canister-slot | 물질별 TBD | 캐비닛 호환성 필요 |
| UPW-01 | `UPW_PRODUCTION`, `UPW_BUFFER` | m³/day, m³ | TBD | 생산률과 저장량 분리 |

### 5.2 완제품 창고 (Finished Goods)

완제품 창고는 `materials`/`inventory`가 아니라 `finishedGoods` 집계 컬렉션을 쓰고(`getWarehouseCapacity()`, `src/lib/queries.ts`), 제품별로 창고를 분리한다 — §3의 "서로 다른 단위는 합산하지 않는다" 원칙을 완제품에도 그대로 적용한 것이다.

| 시설 | 소속 Fab · 제품 | 단위 | 산정 방식 | 승인 / Review Gap |
|---|---|---|---|---|
| `WH-FG01` | M20 · HBM | STACK | NORMAL 일산출 × 5일 버퍼(최초 950,625 STACK, 이후 수요에 맞춰 운영 중 재산정됨 — 현재값은 `/warehouse` 화면 기준) | `MODELED_BASELINE` / `FIELD_SURVEY_REQUIRED` |
| `WH-FG02` | M21 · DRAM | CHIP | NORMAL 일산출(4,562,090 CHIP/일) × 5일 버퍼 = 22,810,450 | `MODELED_BASELINE` / `FIELD_SURVEY_REQUIRED` |
| `WH-FG03` | M22 · NAND | DIE | NORMAL 일산출(4,316,544 DIE/일) × 5일 버퍼 = 21,582,720 | `MODELED_BASELINE` / `FIELD_SURVEY_REQUIRED` |

제품별 창고 ID는 `finishedGoodsWarehouseFor(product)`(`src/lib/finished-goods.ts`)가 반환한다. 2026-08-09 이전에는 3제품이 `WH-FG01` 하나(HBM 기준 STACK 용량)를 공유해서 `getWarehouseCapacity()`가 STACK·CHIP·DIE 수량을 단위 구분 없이 합산했다 — HBM 재고가 132일치(약 2,510만 STACK, 198%)까지 쌓이면서 DRAM·NAND WIP까지 마지막 스텝(CAPACITY_OVER 게이팅)에서 함께 멈추는 결과로 이어졌다. `src/lib/twin/engine.ts`의 `finishedGoodsCapacityOver` 판정도 제품 루프 안에서 자기 창고만 보도록 함께 고쳤다. 마이그레이션: `scripts/migrate-finished-goods-warehouse-split.ts`(`npm run db:migrate-fg-warehouse-split`), 검증: `scripts/test-finished-goods-warehouse-split.ts`.

## 6. 자재 보관 프로파일 필드 계약

| 필드 | 설명 |
|---|---|
| `materialId` | `material-master.md`의 자재 자연키 |
| `inventoryUom` | 현재 재고 원장의 수량 단위 |
| `supplyMode` | 공급·보관 형태 |
| `primaryFacilityId` | 기본 보관시설 |
| `secondaryFacilityId` | 비상·대체 시설. 승인 전 null |
| `capacityPoolId` | 동일 단위와 제약을 공유하는 용량 Pool |
| `storageForm` | 실린더·드럼·캔·롤·트레이·탱크 등 |
| `capacityUnit` | 실제 Capacity 계산 단위 |
| `storageConversionFactor` | 재고 1단위당 Capacity 점유량 |
| `compatibilityGroup` | 혼재 가능성 판정 그룹 |
| `temperatureBand` | 승인된 보관 온도 범위 |
| `allocationType` | `DEDICATED`, `MIN_GUARANTEE`, `SHARED_ELIGIBLE` |
| `guaranteedCapacity` | 전용 또는 최소 보장 할당량 |
| `maximumCapacity` | 자재가 점유할 수 있는 최대 상한 |
| `priority` | 공유 Pool 부족 시 우선순위 |
| `overflowPoolId` | 승인된 대체 Pool. 없으면 null |
| `evidenceStatus` | 값의 근거 등급 |
| `approvalStatus` | `DRAFT_TBD`부터 `APPROVED_ACTIVE`까지의 승인 상태 |

## 7. 63종 자재 보관·할당 초안

표의 `환산`은 현재 시스템 계산을 설명하기 위한 값이다. `*`는 현장 승인 전 `MODELED_CONVERSION`이며, `TBD`는 Capacity 계산에 사용하면 안 된다. `최대할당`은 현재 별도 원장이 없으므로 전부 미확정이다.

### 7.1 GAS — 26종

| 자재 | 재고단위 | 기본시설 / Pool | 보관형태 | 할당유형 | 환산 | 최대할당 | 상태 |
|---|---|---|---|---|---:|---:|---|
| `GAS-001` 질소 N₂ | 봄베 | BGY-01 / `TANK_GAS-001` | 벌크 탱크 | `DEDICATED` | TBD | TBD | `EQUIPMENT_SPEC_REQUIRED` |
| `GAS-002` 수소 H₂ | 봄베 | BGY-01 / `TANK_GAS-002` | 벌크 탱크 | `DEDICATED` | TBD | TBD | `EQUIPMENT_SPEC_REQUIRED` |
| `GAS-003` 아르곤 Ar | 봄베 | BGY-01 / `TANK_GAS-003` | 벌크 탱크 | `DEDICATED` | TBD | TBD | `EQUIPMENT_SPEC_REQUIRED` |
| `GAS-004` 실란 SiH₄ | 봄베 | HZW-01 / `CYL_PYROPHORIC` | 실린더 | `SHARED_ELIGIBLE` | 1.0* | TBD | `SAFETY_REVIEW_REQUIRED` |
| `GAS-005` 암모니아 NH₃ | 봄베 | HZW-01 / `CYL_TOXIC` | 실린더 | `SHARED_ELIGIBLE` | 1.0* | TBD | `SAFETY_REVIEW_REQUIRED` |
| `GAS-006` NF₃ | 봄베 | HZW-01 / `CYL_OXIDIZING` | 실린더 | `SHARED_ELIGIBLE` | 1.0* | TBD | `SAFETY_REVIEW_REQUIRED` |
| `GAS-007` WF₆ | 봄베 | HZW-01 / `CYL_TOXIC` | 실린더 | `SHARED_ELIGIBLE` | 1.0* | TBD | `SAFETY_REVIEW_REQUIRED` |
| `GAS-008` 산소 O₂ | 봄베 | BGY-01 / `TANK_GAS-008` | 벌크 탱크 | `DEDICATED` | TBD | TBD | `EQUIPMENT_SPEC_REQUIRED` |
| `GAS-009` 이산화탄소 CO₂ | 봄베 | BGY-01 / `TANK_GAS-009` | 벌크 탱크 | `DEDICATED` | TBD | TBD | `EQUIPMENT_SPEC_REQUIRED` |
| `GAS-010` 헬륨 He | 봄베 | BGY-01 / `TANK_GAS-010` | 벌크 탱크 | `DEDICATED` | TBD | TBD | `EQUIPMENT_SPEC_REQUIRED` |
| `GAS-011` CF₄ | 봄베 | HZW-01 / `CYL_OXIDIZING` | 실린더 | `SHARED_ELIGIBLE` | 1.0* | TBD | `SAFETY_REVIEW_REQUIRED` |
| `GAS-012` SF₆ | 봄베 | HZW-01 / `CYL_OXIDIZING` | 실린더 | `SHARED_ELIGIBLE` | 1.0* | TBD | `SAFETY_REVIEW_REQUIRED` |
| `GAS-013` 염소 Cl₂ | 봄베 | HZW-01 / `CYL_TOXIC` | 실린더 | `SHARED_ELIGIBLE` | 1.0* | TBD | `SAFETY_REVIEW_REQUIRED` |
| `GAS-014` TEOS | 드럼 | PRS-01 / `CAN_GAS-014` | 캐니스터 | `DEDICATED` | TBD | TBD | `SAFETY_REVIEW_REQUIRED` |
| `GAS-015` DCS | 봄베 | HZW-01 / `CYL_PYROPHORIC` | 실린더 | `SHARED_ELIGIBLE` | 1.0* | TBD | `SAFETY_REVIEW_REQUIRED` |
| `GAS-016` BDEAS | 봄베 | PRS-01 / `CAN_GAS-016` | 캐니스터 | `DEDICATED` | TBD | TBD | `SAFETY_REVIEW_REQUIRED` |
| `GAS-017` TiCl₄ | 봄베 | PRS-01 / `CAN_GAS-017` | 캐니스터 | `DEDICATED` | TBD | TBD | `SAFETY_REVIEW_REQUIRED` |
| `GAS-018` TDMAT | 봄베 | PRS-01 / `CAN_GAS-018` | 캐니스터 | `DEDICATED` | TBD | TBD | `SAFETY_REVIEW_REQUIRED` |
| `GAS-019` TEMAHf | 봄베 | PRS-01 / `CAN_GAS-019` | 캐니스터 | `DEDICATED` | TBD | TBD | `SAFETY_REVIEW_REQUIRED` |
| `GAS-020` DIPAS | 봄베 | PRS-01 / `CAN_GAS-020` | 캐니스터 | `DEDICATED` | TBD | TBD | `SAFETY_REVIEW_REQUIRED` |
| `GAS-021` BF₃ | 봄베 | HZW-01 / `CYL_TOXIC` | 실린더 | `SHARED_ELIGIBLE` | 1.0* | TBD | `SAFETY_REVIEW_REQUIRED` |
| `GAS-022` PH₃ | 봄베 | HZW-01 / `CYL_PYROPHORIC` | 실린더 | `SHARED_ELIGIBLE` | 1.0* | TBD | `SAFETY_REVIEW_REQUIRED` |
| `GAS-023` AsH₃ | 봄베 | HZW-01 / `CYL_PYROPHORIC` | 실린더 | `SHARED_ELIGIBLE` | 1.0* | TBD | `SAFETY_REVIEW_REQUIRED` |
| `GAS-024` B₂H₆ | 봄베 | HZW-01 / `CYL_PYROPHORIC` | 실린더 | `SHARED_ELIGIBLE` | 1.0* | TBD | `SAFETY_REVIEW_REQUIRED` |
| `GAS-025` HBr | 봄베 | HZW-01 / `CYL_TOXIC` | 실린더 | `SHARED_ELIGIBLE` | 1.0* | TBD | `SAFETY_REVIEW_REQUIRED` |
| `GAS-026` C₄F₈ | 봄베 | HZW-01 / `CYL_OXIDIZING` | 실린더 | `SHARED_ELIGIBLE` | 1.0* | TBD | `SAFETY_REVIEW_REQUIRED` |

### 7.2 CHM — 13종

| 자재 | 재고단위 | 기본시설 / Pool | 보관형태 | 할당유형 | 환산 | 최대할당 | 상태 |
|---|---|---|---|---|---:|---:|---|
| `CHM-001` 불산 HF | 병(20L) | BCY-01 / `TANK_CHM-001` | 벌크 탱크 | `DEDICATED` | TBD | TBD | `EQUIPMENT_SPEC_REQUIRED` |
| `CHM-002` 과산화수소 H₂O₂ | 드럼 | BCY-01 / `TANK_CHM-002` | 벌크 탱크 | `DEDICATED` | TBD | TBD | `EQUIPMENT_SPEC_REQUIRED` |
| `CHM-003` 황산 H₂SO₄ | 드럼 | BCY-01 / `TANK_CHM-003` | 벌크 탱크 | `DEDICATED` | TBD | TBD | `EQUIPMENT_SPEC_REQUIRED` |
| `CHM-004` 암모니아수 NH₄OH | 드럼 | BCY-01 / `TANK_CHM-004` | 벌크 탱크 | `DEDICATED` | TBD | TBD | `EQUIPMENT_SPEC_REQUIRED` |
| `CHM-005` 염산 HCl | 드럼 | BCY-01 / `TANK_CHM-005` | 벌크 탱크 | `DEDICATED` | TBD | TBD | `EQUIPMENT_SPEC_REQUIRED` |
| `CHM-006` 인산 H₃PO₄ | 드럼 | BCY-01 / `TANK_CHM-006` | 벌크 탱크 | `DEDICATED` | TBD | TBD | `EQUIPMENT_SPEC_REQUIRED` |
| `CHM-007` ArF PR | 캔(1L) | MWH-02 / `PALLET_TEMP_PHOTO` | 캔/케이스 | `SHARED_ELIGIBLE` | 0.015 pallet* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CHM-008` KrF PR | 캔(1L) | MWH-02 / `PALLET_TEMP_PHOTO` | 캔/케이스 | `SHARED_ELIGIBLE` | 0.015 pallet* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CHM-009` EUV PR | 캔(1L) | MWH-02 / `PALLET_TEMP_PHOTO` | 캔/케이스 | `SHARED_ELIGIBLE` | 0.015 pallet* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CHM-010` TMAH 현상액 | 드럼 | BCY-01 / `TANK_CHM-010` | 벌크 탱크 | `DEDICATED` | TBD | TBD | `EQUIPMENT_SPEC_REQUIRED` |
| `CHM-011` Cu ECD 도금액 | 드럼 | MWH-01 / `PALLET_AMBIENT` | 드럼 | `SHARED_ELIGIBLE` | 0.4 pallet* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CHM-012` EBR 신너 | 드럼 | MWH-02 / `PALLET_TEMP_CHEM` | 드럼 | `SHARED_ELIGIBLE` | 0.4 pallet* | TBD | `SAFETY_REVIEW_REQUIRED` |
| `CHM-013` Post-CMP 세정액 | 드럼 | MWH-02 / `PALLET_TEMP_CHEM` | 드럼 | `SHARED_ELIGIBLE` | 0.4 pallet* | TBD | `SAFETY_REVIEW_REQUIRED` |

### 7.3 CSM — 19종

| 자재 | 재고단위 | 기본시설 / Pool | 보관형태 | 할당유형 | 환산 | 최대할당 | 상태 |
|---|---|---|---|---|---:|---:|---|
| `CSM-001` Ceria Slurry | 캔(20L) | MWH-01 / `PALLET_AMBIENT` | 캔/팔레트 | `SHARED_ELIGIBLE` | 0.06 pallet* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CSM-002` Silica Slurry | 캔(20L) | MWH-01 / `PALLET_AMBIENT` | 캔/팔레트 | `SHARED_ELIGIBLE` | 0.06 pallet* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CSM-003` Cu Slurry | 캔(20L) | MWH-01 / `PALLET_AMBIENT` | 캔/팔레트 | `SHARED_ELIGIBLE` | 0.06 pallet* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CSM-004` CMP Pad | 장 | MWH-01 / `PALLET_AMBIENT` | 박스/팔레트 | `SHARED_ELIGIBLE` | 0.04 pallet* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CSM-005` Conditioner Disk | 개 | MWH-01 / `PALLET_AMBIENT` | 박스/팔레트 | `SHARED_ELIGIBLE` | 0.08 pallet* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CSM-006` PVD Ti Target | 개 | MRO-01 / `MRO_TARGET` | 전용 Cradle | `SHARED_ELIGIBLE` | 1 slot* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CSM-007` PVD W Target | 개 | MRO-01 / `MRO_TARGET` | 전용 Cradle | `SHARED_ELIGIBLE` | 1 slot* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CSM-008` PVD TiN Target | 개 | MRO-01 / `MRO_TARGET` | 전용 Cradle | `SHARED_ELIGIBLE` | 1 slot* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CSM-009` HBM Probe Card | 장 | MRO-01 / `MRO_PROBE` | 전용 Case | `SHARED_ELIGIBLE` | 1 slot* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CSM-010` DRAM Probe Card | 장 | MRO-01 / `MRO_PROBE` | 전용 Case | `SHARED_ELIGIBLE` | 1 slot* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CSM-011` PR Stripper | 드럼 | MWH-01 / `PALLET_AMBIENT` | 드럼 | `SHARED_ELIGIBLE` | 0.4 pallet* | TBD | `SAFETY_REVIEW_REQUIRED` |
| `CSM-012` SnAg μBump | wafer-lot | MWH-01 / `PALLET_AMBIENT` | Lot Container | `SHARED_ELIGIBLE` | 0.2 pallet* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CSM-013` Backgrinding Tape | 롤 | MWH-01 / `PALLET_AMBIENT` | 롤/박스 | `SHARED_ELIGIBLE` | 0.15 pallet* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CSM-014` TC-NCF | 롤 | MWH-02 / `PALLET_TEMP_FILM` | 냉장·항온 롤 | `SHARED_ELIGIBLE` | 0.15 pallet* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CSM-015` Quartz Kit | 세트 | MRO-01 / `MRO_PARTS` | 세트 Case | `SHARED_ELIGIBLE` | 1 slot* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CSM-016` Edge Trim Blade/Wheel | 개 | MWH-01 / `PALLET_AMBIENT`* | TBD | `SHARED_ELIGIBLE`* | 0.08 pallet* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CSM-017` Dicing Blade | 개 | MWH-01 / `PALLET_AMBIENT`* | TBD | `SHARED_ELIGIBLE`* | 0.08 pallet* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CSM-018` Dicing UV Tape | 롤 | MWH-01 / `PALLET_AMBIENT`* | TBD | `SHARED_ELIGIBLE`* | 0.15 pallet* | TBD | `FIELD_SURVEY_REQUIRED` |
| `CSM-019` Memory KGD Die Tray | TRAY | MWH-01 / `PALLET_AMBIENT`* | 회수형 Tray | `SHARED_ELIGIBLE`* | TBD | TBD | `FIELD_SURVEY_REQUIRED` |

### 7.4 UTL·PKG — 5종

| 자재 | 재고단위 | 기본시설 / Pool | 보관형태 | 할당유형 | 환산 | 최대할당 | 상태 |
|---|---|---|---|---|---:|---:|---|
| `UTL-001` 초순수 UPW | 톤 | UPW-01 / `UPW_PRODUCTION` | 현장생산·순환 | `DEDICATED` | 창고 제외 | 해당 없음 | `EQUIPMENT_SPEC_REQUIRED` |
| `UTL-002` Scrubber NaOH | 드럼 | MWH-01 / `PALLET_AMBIENT` | 드럼 | `SHARED_ELIGIBLE` | 0.4 pallet* | TBD | `SAFETY_REVIEW_REQUIRED` |
| `PKG-001` HBM용 EMC | kg | MWH-02 / `PALLET_TEMP_PKG` | 포대/박스 | `SHARED_ELIGIBLE` | 0.003 pallet* | TBD | `FIELD_SURVEY_REQUIRED` |
| `PKG-002` HBM용 DAF | 롤 | MWH-02 / `PALLET_TEMP_FILM` | 항온 롤 | `SHARED_ELIGIBLE` | 0.15 pallet* | TBD | `FIELD_SURVEY_REQUIRED` |
| `PKG-LBD-001` HBM4 Logic Base Die KGD | KGD_DIE | MWH-01* / `PALLET_AMBIENT`* | JEDEC Tray* | `SHARED_ELIGIBLE`* | TBD | TBD | `FIELD_SURVEY_REQUIRED` |

`CSM-016~019`, `PKG-LBD-001`은 현재 DB에서 `supplyMode`와 재고 행이 완전하지 않다. 별표로 표시한 기본시설은 현재 분류 함수의 fallback일 뿐이며, 포장 Spec 승인 후 확정해야 한다.

## 8. 자재별 Capacity 할당 계약

현재 `materialAllocations`는 작업오더용 자재 예약이므로 창고 Capacity 할당과 혼용하지 않는다. 신규 원장 이름은 `warehouseCapacityAllocations`로 분리한다.

| 필드 | 필수 | 설명 |
|---|---|---|
| `allocationId` | Y | 자연키 또는 UUID |
| `facilityId` | Y | 시설 |
| `capacityPoolId` | Y | 동일 단위·제약 Pool |
| `zoneId` | 조건부 | 물리 Zone |
| `materialId` | 조건부 | 전용·개별 할당 자재 |
| `materialGroup` | 조건부 | 공용 할당 품목군 |
| `allocationType` | Y | `DEDICATED`, `MIN_GUARANTEE`, `SHARED_ELIGIBLE` |
| `capacityUnit` | Y | pallet-slot, cylinder-slot, m³ 등 |
| `guaranteedCapacity` | Y | 전용 또는 최소 보장량. 공용 자재는 0 |
| `maximumCapacity` | Y | 해당 자재가 점유할 수 있는 상한 |
| `reservedCapacity` | Y | 해당 할당 안의 격리·검수 예약량 |
| `priority` | Y | 공유 Pool 부족 시 우선순위 |
| `overflowPoolId` | N | 승인된 대체 Pool |
| `conversionFactor` | 조건부 | 재고단위 → Capacity 단위 |
| `effectiveFrom` | Y | 적용 시작일 |
| `effectiveTo` | N | 종료일 |
| `evidenceStatus` | Y | 근거 등급 |
| `approvalStatus` | Y | 승인 상태 |
| `approvedBy`, `approvedAt` | 승인 시 | 승인자와 시각 |

### 8.1 검증 규칙

1. 같은 Pool에서 `Σ(guaranteedCapacity) + poolReservedCapacity ≤ effectiveLimit`.
2. `occupiedCapacity > maximumCapacity`이면 `OVER_ALLOCATION`.
3. Pool 전체 점유가 `effectiveLimit`을 넘으면 `CAPACITY_BREACH`.
4. 승인된 `storageConversionFactor`가 없으면 `CONVERSION_TBD`이며 증산 가능 판정을 금지한다.
5. 온도·방폭·혼재·캐비닛 등급이 맞지 않으면 빈 공간이 있어도 할당할 수 없다.
6. 벌크 물질은 전용 탱크별로 계산하고 서로의 여유량을 공유하지 않는다.
7. 현재 `inventory.capacityLimit`은 승인된 allocation을 대체하지 않는다.

## 9. What-if·디지털 트윈 연결

```text
시나리오 WSPM
  → material-consumption-master의 예상 월소요량
  → 목표 DOH·안전재고·입고 lot 반영
  → 필요 재고량
  → 승인된 storageConversionFactor로 필요 Capacity 환산
  → 자재 guaranteed/maximum Capacity와 Pool effectiveLimit 비교
  → 판정
       OK                    증산 가능
       CONVERSION_TBD        포장·환산 기준 확인 필요
       OVER_ALLOCATION       자재 할당 확대 또는 재배치 필요
       CAPACITY_BREACH       입고 분할·외부보관·시설 증설 필요
       SAFETY_CONSTRAINT     빈 공간과 무관하게 적치 금지
```

AI는 Capacity 숫자를 생성하거나 승인하지 않는다. 결정론적 계산 결과와 근거 상태를 읽고 “지금 할 일”의 우선순위와 설명만 만든다. `DRAFT_TBD`, `MODELED_CONVERSION`, `TBD` 값은 확정 발주·입고 승인 근거로 사용하지 않는다.

## 10. 승인 절차

| 단계 | 담당 | 확인 내용 | 상태 전환 |
|---|---|---|---|
| 1. 시설 실측 | 물류·시설 | 랙, 슬롯, 비가용 위치, 통로, 정비공간 | `DRAFT_TBD → OPS_VERIFIED` |
| 2. 자산 사양 | 시설·설비 | 탱크 체적, Heel, 운전 상하한, 생산률, Buffer | `DRAFT_TBD → OPS_VERIFIED` |
| 3. 포장 환산 | 자재·물류 | 포장당 수량, 적재단수, 용기 규격, 회수율 | `MODELED_CONVERSION → FIELD_MEASURED` |
| 4. EHS 검토 | 안전·환경 | 혼재금지, 지정수량, 허가상한, 방폭·방화 | `OPS_VERIFIED → EHS_VERIFIED` |
| 5. 운영 승인 | 자재·물류·생산 | 최소보장·최대할당·공용 Pool 정책 | `OPS/EHS_VERIFIED → APPROVED_ACTIVE` |
| 6. 시스템 반영 | WMS/디지털 트윈 | DB 마이그레이션, 검증식, 감사이력 | 운영 적용 |

## 11. 현장 확인 체크리스트

- [ ] MWH-01/02의 실제 사용 가능 팔레트 위치와 비가용 위치
- [ ] MWH-02 온도·차광 Zone별 Capacity와 허용 자재
- [ ] HZW-01 허가증, Zone별 실린더 슬롯, 혼재금지 Matrix
- [ ] PRS-01 캐비닛별 캐니스터 규격과 물질 호환성
- [ ] BGY-01 물질별 탱크 체적, 단위, 정상 운전 하한·상한
- [ ] BCY-01 물질별 탱크 체적, 방유 구획, 정상 운전 하한·상한
- [ ] MRO-01 Target·Probe Card·Quartz 전용 보관 규격
- [ ] UPW 생산능력 `m³/day`, Buffer tank `m³`, 비상 유지시간
- [ ] 63종 포장당 수량과 적재 환산계수
- [ ] 자재별 최소 보장량과 최대 할당량
- [ ] 격리·검수·비상용 공통 Reserved Capacity
- [ ] 외부·공급사 보관으로 전환하는 Capacity 임계치

## 12. 관련 문서와 구현

- 자재 정체성·사용처: [`material-master.md`](./material-master.md)
- 자재 원단위·월소요량: [`material-consumption-master.md`](./material-consumption-master.md)
- FAB 생산 기준: [`fab-master.md`](./fab-master.md)
- 현재 시설 기준: `src/lib/warehouse-storage-rules.ts`
- 현재 단위 환산: `src/lib/capacity.ts`
- 현재 DB 스키마: `src/lib/db.ts`
- 현재 Capacity 계산: `src/lib/queries.ts#getWarehouseCapacity`
- 현재 시드·계획값: `prisma/seed.ts`
- 완제품 창고(§5.2) 단위·창고 배정: `src/lib/finished-goods.ts`, 시딩·이관: `scripts/migrate-finished-goods-warehouse-split.ts`

## 13. 다음 버전에서 결정할 항목

`V0.2`에서는 아래 세 표에 실제 승인값을 채운다.

1. 시설·Zone별 `rated / usable / reserved / effectiveLimit`
2. 자재별 `storageConversionFactor`
3. 자재 또는 품목군별 `guaranteedCapacity / maximumCapacity / priority`

이 세 값이 승인되기 전까지 현재 시스템의 Capacity는 운영 확정값이 아니라 계획 시뮬레이션 기준이다.
