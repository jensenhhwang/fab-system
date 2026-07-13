# ERP 시뮬레이터 + 타임 액셀레이터 설계 스펙

**날짜**: 2026-07-13
**범위**: 가상 ERP 연동 + 실시간 시뮬레이션 엔진 + 타임 액셀레이터 UI
**전제**: WMS Phase 1 완료 (Lot 추적, FEFO, inventoryLots/inventoryMovements 컬렉션 존재)

---

## 배경

현재 시뮬레이션 탭(`/simulation`)은 단순 정적 계산(90일 재고 예측)만 수행한다. 실제 DB를 건드리지 않아 "계산 결과"에 불과하다.

이번 구현에서는 가상 ERP 사이클(발주→입고)과 FEFO 기반 소비를 실제 DB에 반영하는 **살아있는 시뮬레이터**를 만든다. 재고 모델이 불확실한 공급 환경에서도 버텨낸다는 것을 입증하는 것이 목표다.

---

## 핵심 설계 결정

| 항목 | 결정 | 이유 |
|------|------|------|
| DB 접근 | 실제 DB + `simulated: true` 마킹 | WMS·재고 탭 전체 연동 + 리셋 가능 |
| 속도 모드 | 실시간 스트리밍 + N일 점프 | 라이브 관찰 + 빠른 검증 둘 다 필요 |
| ERP 사이클 | 변동 리드타임 + 랜덤 이벤트 + 수동 트리거 | 불확실성 하에서 모델 검증 |
| 엔진 아키텍처 | DB 상태 기반 + SSE 푸시 | 탭 재접속 시 이어서 재개, 서버 재시작 후에도 상태 복원 |
| 리셋 | `deleteMany({ simulated: true })` | 전 컬렉션 시뮬 데이터 일괄 삭제 |

---

## 1. 데이터 모델

### 신규 컬렉션: `simState` (싱글턴)

시뮬레이션 전체 상태. 문서 1개 고정 (`_id: "singleton"`).

```ts
{
  _id: "singleton",
  status: "IDLE" | "RUNNING" | "PAUSED",
  simDate: Date,           // 현재 가상 날짜
  simStartDate: Date,      // 시뮬 시작 가상 날짜
  realStartedAt: Date,     // 실시간 시작 시각
  speedMultiplier: number, // 1=1일/초, 10=10일/초, 100=100일/초
}
```

### 신규 컬렉션: `simPurchaseOrders`

가상 ERP 발주 이력. 실제 PO처럼 상태 전이한다.

```ts
{
  _id: string,             // "PO-{timestamp}"
  materialId: string,
  qty: number,
  status: "PENDING" | "IN_TRANSIT" | "RECEIVED" | "CANCELLED",
  createdSimDate: Date,    // 발주 생성 가상 날짜
  expectedArrival: Date,   // 원래 예정 도착 가상 날짜
  actualArrival?: Date,    // 실제 도착 가상 날짜 (RECEIVED 시 기록)
  leadTimeDays: number,    // 기본 리드타임 (랜덤 적용 전)
  delayDays: number,       // 추가 지연일수 (0 = 정상)
  simulated: true,
}
```

### 신규 컬렉션: `simEvents`

틱마다 발생한 이벤트 로그. 입증 자료로 보존한다.

```ts
{
  _id: string,
  simDate: Date,
  type: "CONSUMPTION" | "PO_CREATED" | "GR_ARRIVED" | "STOCKOUT_RISK" | "DELAY" | "PARTIAL_GR" | "PO_CANCELLED" | "MANUAL",
  materialId?: string,
  qty?: number,
  poId?: string,
  note: string,
  simulated: true,
}
```

### 기존 컬렉션 변경

시뮬레이터가 생성하는 `inventoryLots`, `inventoryMovements` 문서에 `simulated: true` 필드 추가. 기존 실제 데이터는 해당 필드 없음 → 리셋 시 `{ simulated: true }` 조건으로 일괄 삭제.

---

## 2. 시뮬레이션 엔진 (틱 프로세서)

`POST /api/sim/tick` — 가상 하루 1일을 처리한다. 아래 순서대로 실행.

### 틱 처리 순서

**① 소비 처리**
- `inventoryLots` AVAILABLE → FEFO 순 (`expiryDate ASC, receivedAt ASC`)
- 자재별 `processUsage.monthlyQty / 30` 만큼 차감 (`availableQuantity` 감소)
- 수량 0 도달 시 `qualityStatus: "CONSUMED"`
- `simEvent: CONSUMPTION` 기록

**② ROP 체크 → 자동 발주**
- 자재별 `SUM(availableQuantity) < ropDays × dailyUsage` 이면 PO 생성
- 기존 `PENDING` 또는 `IN_TRANSIT` PO가 이미 있으면 중복 발주 안 함
- 리드타임 = 카테고리 기본값 × `(0.8 ~ 1.2)` 랜덤

  | 카테고리 | 기본 리드타임 |
  |---------|-------------|
  | CHM     | 7~14일      |
  | GAS     | 3~7일       |
  | PKG     | 5~10일      |
  | 기타    | 7일         |

- `simEvent: PO_CREATED` 기록

**③ GR 처리**
- `expectedArrival + delayDays <= simDate` 인 `IN_TRANSIT` PO 전체 처리
- → `inventoryLots` 신규 Lot 생성 (`simulated: true`)
- → `inventoryMovements` RECEIPT 기록 (`simulated: true`)
- → PO `status: "RECEIVED"`, `actualArrival: simDate`
- `simEvent: GR_ARRIVED` 기록

**④ 랜덤 이벤트** (틱당 확률, IN_TRANSIT PO 대상)

| 이벤트 | 확률 | 처리 |
|--------|------|------|
| 공급 지연 | 5% | 랜덤 PO의 `delayDays += 2~5` |
| 부분 입고 | 2% | GR qty × 60~80%, 잔여분 새 PO 재생성 |
| PO 취소 | 1% | `status: "CANCELLED"` + 즉시 재발주 |

**⑤ simDate 전진**
- `simState.simDate += 1일`
- `simEvent` 없으면 조용히 넘어감

### 속도 제어

| 모드 | 동작 |
|------|------|
| 실시간 스트리밍 | SSE 연결 시 서버 `setInterval(tick, 1000 / speedMultiplier)` |
| N일 점프 | `POST /api/sim/jump?days=N` → 틱 N회 동기 루프 → 완료 후 결과 반환 |

SSE 연결 해제 시 interval 클리어 + `simState.status: "PAUSED"`. 재접속 시 simDate 이어서 재개.

---

## 3. API 설계

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/sim/state` | simState 조회 |
| POST | `/api/sim/start` | 시뮬레이션 시작 (status: RUNNING) |
| POST | `/api/sim/pause` | 일시정지 |
| POST | `/api/sim/reset` | 전체 리셋 (`deleteMany({ simulated: true })`) |
| POST | `/api/sim/tick` | 틱 1회 수동 실행 |
| POST | `/api/sim/jump` | `?days=N` — N일 점프 |
| GET | `/api/sim/stream` | SSE 스트림 (이벤트 푸시) |
| GET | `/api/sim/pos` | 진행 중 PO 목록 |
| POST | `/api/sim/pos/[id]/delay` | 수동 지연 트리거 |
| POST | `/api/sim/pos/[id]/partial` | 수동 부분 입고 |
| POST | `/api/sim/pos` | 수동 긴급 발주 |
| GET | `/api/sim/events` | 이벤트 로그 조회 |

---

## 4. UI

기존 `/simulation` 탭(`OperationalScenarioClient.tsx` 위에 추가). 새 탭 불필요.

### 컨트롤 바 (상단 고정)

```
[ 가상 날짜: 2026-07-13 → 2026-09-21  (70일 경과) ]

[▶ 시작]  [⏸ 멈춤]  [⏮ 리셋]       속도: [━━●━━] 10×
                                      [30일 점프]  [90일 점프]
```

- 속도 슬라이더: 1×, 5×, 10×, 30×, 100× 단계
- 시뮬레이션 중 상태바: `🔵 RUNNING · 2026-09-21`

### 이벤트 피드 (중단, 최신 50건)

```
🟢 2026-09-21  GR 도착      CHM-007  +500kg     MWH-02
🔴 2026-09-20  재고 위험    GAS-019  잔여 2일치
🟡 2026-09-20  공급 지연    PO-0041  +3일 지연 (랜덤)
📦 2026-09-19  자동 발주    CHM-007  PO 생성 → 예정 10/01
⚙️ 2026-09-18  소비         전체 자재 일일 차감 완료
```

### 수동 ERP 트리거 패널 (하단)

진행 중 PO 목록 테이블:

| PO ID | 자재 | 수량 | 예정 도착 | 액션 |
|-------|------|------|-----------|------|
| PO-0041 | CHM-007 | 500kg | 10/01 | [지연 +3일] [부분입고 70%] |
| PO-0039 | GAS-019 | 200ea | 09/28 | [지연 +3일] [부분입고 70%] |

[+ 긴급 발주] 버튼: 자재 선택 → 수량 입력 → 즉시 PO 생성

### 기존 탭 연동

시뮬레이션 RUNNING 중 재고·WMS 탭 상단에 `🔵 시뮬레이션 진행 중 · 2026-09-21` 배지. 데이터는 `simulated: true` 포함해서 자동으로 흘러들어옴.

---

## 5. 리셋 동작

```
POST /api/sim/reset
→ simState.status: "IDLE", simDate: 오늘
→ deleteMany({ simulated: true }) — 전 컬렉션
   대상: inventoryLots, inventoryMovements, simPurchaseOrders, simEvents
→ 실제 시드 데이터(simulated 필드 없음)는 보존
```

---

## 6. 범위 밖 (다음 단계)

- 시뮬레이션 결과 스냅샷 저장 / 비교
- 멀티 시나리오 (A안 vs B안 병렬 시뮬)
- 실제 SAP RFC 연동 (Vercel Edge에서 불가 → 별도 서버 필요)
- AMHS 자동 이송 시뮬레이션
