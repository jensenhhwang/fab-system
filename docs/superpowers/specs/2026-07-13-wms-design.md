# WMS (창고관리시스템) 설계 스펙

**날짜**: 2026-07-13  
**범위**: WMS Phase 1 — Lot 추적 + 입출고 이력 + FEFO/FIFO + 시설 마스터 재코딩  
**다음 단계**: MES (제조실행), AMHS (자동 이송) — 별도 스펙

---

## 배경

현재 시스템은 자재별 총 재고량(qty)과 일평균 사용량(daily)만 관리한다. 창고 내 위치, 입출고 이력, Lot 단위 추적이 없어 FEFO 관리가 불가능하다. 이번 WMS Phase 1에서 이를 해결한다.

---

## 1. 시설 마스터 재코딩

`warehouse-storage-rules.ts`의 `FACILITY_MASTER`를 SAP WM 스타일 코드 체계로 변경한다.

| 현재 코드 | 새 코드 | 명칭 | 슬롯 추적 방식 |
|----------|---------|------|--------------|
| WH-A | `MWH-01` | 자동화 자재창고 (AS/RS) | Row-Col-Level |
| WH-B | `MWH-02` | 항온 자재창고 | 구역-랙-단 |
| WH-C | `HZW-01` | 특수가스 위험물창고 | 캐비닛-슬롯 |
| WH-D | `MRO-01` | 공구·MRO 창고 | 개체 ID |
| YD-GAS | `BGY-01` | 벌크가스 야드 | 탱크 번호 + % |
| YD-CHEM | `BCY-01` | 벌크케미컬 야드 | 탱크 번호 + % |
| SUP-PREC | `PRS-01` | 전구체 공급실 | 캐니스터 슬롯 |
| FAC-UPW | `UPW-01` | 초순수 생산시설 | 연속생산 (없음) |

**마이그레이션 범위**: `warehouse-storage-rules.ts`, `seed.ts`, `inventory` 컬렉션, UI 전체, `getCanonicalFacility()` 함수.

---

## 2. 데이터 모델

### 신규 컬렉션: `lots`

Lot 단위 재고. 기존 `inventory`는 Lot 합산 뷰로 유지된다.

```ts
{
  _id: string;          // "LOT-20260713-001"
  materialId: string;   // "CHM-007" (기존 자재 코드)
  facilityCode: string; // "MWH-02" (새 시설 코드)
  slotId?: string;      // "MWH-02-A03-02" (선택, 위치 태그)
  qty: number;          // 잔여 수량
  mfgDate?: Date;       // 제조일 (선택)
  expiresAt?: Date;     // 유효기간 — FEFO 기준. 없으면 FIFO(입고일 순)
  status: "AVAILABLE" | "RESERVED" | "CONSUMED";
  createdAt: Date;      // 입고일 — FIFO 기준
}
```

### 신규 컬렉션: `transactions`

모든 입출고 이벤트 로그. 불변 기록이다.

```ts
{
  _id: string;          // "TX-20260713-001"
  type: "INBOUND" | "OUTBOUND";
  lotId: string;        // 연결된 Lot
  materialId: string;
  qty: number;          // 입고(+) / 출고(-)
  facilityCode: string;
  userId: string;       // 처리자. 자동 출고 시 "system"
  processCode?: string; // 출고 시만 — 어느 공정으로 나갔는지
  note?: string;
  createdAt: Date;
}
```

### 기존 `inventory` 처리

`inventory.qty`를 직접 관리하는 대신, `lots` 집계로 계산한다:

```
inventory.qty = SUM(lots.qty) WHERE materialId = X AND status = AVAILABLE
```

API 레이어에서 집계하거나, MongoDB aggregation view로 구성한다.

---

## 3. 입출고 흐름

### 입고 (수동)

1. 담당자가 창고관리 탭 → [입고 등록] 버튼
2. 자재 선택 → 시설/슬롯 → 수량 → 제조일·유효기간 입력
3. 저장 시:
   - `lots` 신규 문서 생성 (status: AVAILABLE)
   - `transactions` INBOUND 기록

### 출고 (자동 + 수동)

**자동 출고**: 월별 `processUsage` 기반으로 FEFO 순 Lot 차감
- expiresAt 있는 자재: expiresAt ASC 정렬 → 순서대로 차감
- expiresAt 없는 자재(가스류 등): createdAt ASC (FIFO)
- Lot qty가 부족하면 다음 Lot으로 이어서 차감
- 모든 AVAILABLE Lot 소진 시 재고 부족 알람

**수동 출고**: 담당자가 직접 처리 (긴급 출고, 폐기, 이동 등)

### FEFO 추천 로직

```
입력: materialId, qty
→ lots WHERE materialId = X AND status = AVAILABLE
→ ORDER BY expiresAt ASC NULLS LAST, createdAt ASC
→ qty 채울 때까지 순서대로 차감 제안
→ 부족 시 경고 반환
```

---

## 4. UI 구조

### 기존 재고 탭 — 변경 최소화

- 현재 자재별 총 재고량·DOH·ROP 알람 유지
- Lot 개수 뱃지 추가 (예: `CHM-007 · 3 Lots`)
- 자재 행 클릭 시 창고관리 탭의 해당 자재 Lot 목록으로 이동

### 신규 "창고관리" 탭

**상단**: 시설 필터 + 자재 필터 + [입고 등록] 버튼

**Lot 목록 테이블**
- FEFO 순(expiresAt ASC) 정렬이 기본
- 컬럼: Lot ID / 자재명 / 시설 / 슬롯 / 수량 / 유효기간 / D-Day / 상태
- D-Day 30일 이하 🔴, 60일 이하 🟡 색상 경고

**입출고 이력 테이블**
- 컬럼: 일시 / 유형(입고·출고) / 자재명 / 수량 / 공정 / 처리자
- 필터: 시설 / 자재 / 기간

**입고 등록 모달**
- 자재 검색 → 시설 선택 → 슬롯 입력(선택) → 수량 → 제조일·유효기간 → 저장

---

## 5. API 설계

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/lots` | Lot 목록 (materialId, facilityCode, status 필터) |
| POST | `/api/lots` | 입고 등록 (lots + transactions INBOUND 생성) |
| POST | `/api/lots/[id]/consume` | 수동 출고 |
| GET | `/api/transactions` | 이력 조회 (materialId, type, 기간 필터) |
| GET | `/api/lots/fefo` | FEFO 추천 (materialId + qty 입력 → Lot 순서 반환) |

---

## 6. 범위 밖 (다음 단계)

- 슬롯 지도 시각화 → AMHS 연동 단계에서
- 발주(PO) → 자동 입고 연동 → MES 단계에서
- 창고 간 이송 요청/승인 → AMHS 단계에서
- 실물 스캐너/바코드 연동 → AMHS 단계에서
