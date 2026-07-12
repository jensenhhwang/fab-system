# 데이터 정합 + 창고 Capacity 설계 스펙

- **작성일**: 2026-07-12
- **상태**: 사용자 승인 완료 → 구현
- **원칙**: 모든 탭 데이터는 단일 진실원으로 연결 + 실시간 대비 ([[feedback-data-interconnection]])

## 1. 문제
- 재고 DOH는 `Inventory.avgDailyUsage`(하드코딩), 공정별 사용량은 `ProcessUsage.monthlyQty` → 독립·불일치 (예: N₂ 180/일 vs 공정합산 ~542/일).
- 창고 Capacity 산정 근거 없음 (대시보드 `quantity>500?0.2:0.5` 임시 환산).

## 2. 설계 (사용자 선택 반영)

### A. 소비량 단일 진실원 = ProcessUsage
- `dailyUsage(자재) = Σ ProcessUsage.monthlyQty(그 자재, 전 제품) ÷ WORKING_DAYS(=30)`.
- **비공정 자재(UPW·유틸·MRO 등 ProcessUsage 없음)** → 기존 `avgDailyUsage`를 "기타 소비"로 **fallback**.
- `DOH = 총재고 ÷ dailyUsage`. 계산은 `src/lib/queries.ts` 한 곳.

### B. 공간 환산 = 단위종류별 표준표 + 자재별 override
- `UNIT_PALLET_FACTOR`(파렛트 환산/단위): 봄베 0.5·드럼 0.4·캔(20L) 0.06·캔(1L) 0.015·병(20L) 0.06·롤 0.15·장 0.04·개 0.08·세트 0.3·kg 0.003·wafer-lot 0.2·톤 0(현장생산)·default 0.1.
- `Material.palletFactor?`(예외 override) 있으면 우선.
- `창고 점유 = Σ(수량 × factor)`, `점유율 = 점유 / totalCapacity`.

### C. 창고 Capacity 페이지 (`/warehouse`)
1. 창고별 **점유율**(현재/총 capacity) 게이지
2. **카테고리별 점유 분해**(GAS/CHM/CSM/UTL/PKG 스택)
3. **위험물 법적 한도 경보** — `Warehouse.legalLimit?`(C동) 대비 현황
4. **자동화(AS/RS)/평치 특성·효율** — type별 밀도·특성 표시

## 3. 스키마(문서 필드) 추가
- `MaterialDoc.palletFactor?: number`
- `WarehouseDoc.legalLimit?: number` (위험물 C동 등)

## 4. 구현 파일
- `src/lib/capacity.ts` — UNIT_PALLET_FACTOR, WORKING_DAYS, `materialFactor()`.
- `src/lib/queries.ts` — `getMaterialDailyUsage()`(Map), `getInventoryRows()`(dailyUsage·doh 포함), `getWarehouseCapacity()`.
- `inventory/page.tsx`·`(dashboard)/page.tsx`·`lib/ai.ts` — 유도 usage 사용.
- `(dashboard)/warehouse/page.tsx` + `WarehouseClient.tsx` — Capacity 페이지, nav 추가.
- `prisma/seed.ts` — warehouse `legalLimit`, 필요한 material `palletFactor`. 재시딩.

## 5. 정합 결과
재고·공정·창고·대시보드·3D가 모두 ProcessUsage + Inventory + factor에서 유도 → 한 숫자로 연결. ProcessUsage/재고 바뀌면 전 탭 자동 반영. 실시간(revalidate/폴링) 확장 용이.
