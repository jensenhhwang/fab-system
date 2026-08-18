# 운영 트렌드 대시보드 — 설계

작성일 2026-08-18 · 대상 브랜치 `feat/dram-nand-finished-goods`

## 1. 이 문서가 푸는 문제

기존 화면 11개는 전부 **현재 시점 스냅샷**이다. 시계열 화면이 하나도 없어서 두 가지를 볼 수 없다.

1. **설계 기준선에서 얼마나, 어느 방향으로 벌어지고 있는가.** `docs/fab-operating-baseline.md`가 기준선과 정합 조건(R1~R5)을 정의했지만, 그 위반이 시간에 따라 쌓이는지 줄어드는지는 매번 감사 스크립트를 손으로 돌려야만 알 수 있다.
2. **엔진이 살아있는가.** 2026-08-12 22:35부터 08-18까지 트윈 엔진이 132시간 동안 tick을 돌리지 않았는데 아무도 몰랐다. `tick-diagnosis.ts`에 `STOPPED_AFTER_MIN = 60` 판정이 이미 있어 시스템은 자기가 죽은 걸 알 수 있었지만, 그 판정에 도달하는 경로가 없었다.

이 대시보드는 **하나의 시간축 위에 운영 실측과 정책 변경을 겹쳐** 두 질문에 답한다.

## 2. 설계 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 목적 | 설계 기준선 대비 편차 추적 | 사용자 선택 |
| x축 | **운영일 기본 · 벽시계일 토글** | 정지 구간(운영시계는 평평, 벽시계는 흐름) 대조가 곧 사고 감지 |
| 지표 | 생산 · 자재 · 창고 · 출하 4축 | 사용자 선택 |
| 적재 | **일별 스냅샷 컬렉션 신설** | 재고 커버리지·창고 점유는 *상태*라 이벤트로 과거 복원 불가 |
| 과거 백필 | **하지 않는다** | 운영일 축은 원리적으로 복원 불가(§2.1). 벽시계 축만 과거가 있으면 토글 시 범위가 달라져 오해를 만든다 |
| 24배속 위반 | **선행 수정** | 위반을 둔 채 그리면 그래프가 틀린 숫자를 그린다 |
| 차트 | **인라인 SVG, 라이브러리 없음** | 필요한 형태가 라인·막대·스파크라인 셋뿐. 프로젝트 차트 의존성 0 |
| 다크모드 | **만들지 않음** | 앱이 라이트 테마 고정(devlog day 0) |

### 2.1 왜 과거 운영일을 복원할 수 없는가

벽시계에서 운영시각을 역산하려면 매핑이 고정 24×여야 한다. 그렇지 않다. `operating-clock.ts`의 `OPERATING_CATCH_UP_LIMIT_MS`가 정지 공백을 잘라내기 때문에 매핑이 구간별로 끊긴다 — 실측으로 5.5 벽시계일 정지에 운영시각은 1일만 흘렀다. 따라서 과거 이벤트의 `tickAt`(벽시계)으로부터 그 시점의 운영일을 되살릴 방법이 없다.

## 3. 선행 수정

대시보드보다 먼저 들어간다. 각 항목은 독립적으로 검증 가능하다.

### F1. 계약 이행률 집계 창 (심각)

`src/app/api/customers/route.ts`가 `shippedAt >= 벽시계 월초`로 집계하는데, 자동출하는 운영시간 기준으로 나간다(`auto-shipment.ts`: `due = contractedMonthlyQty / DAYS_PER_MONTH × 운영일수`). 벽시계 한 달 창에는 운영 24개월치가 쌓이고 분모는 운영 1개월치다.

실측 2026-08-18: DRAM 6.5배 · NAND 6.4배 · HBM 3.8배 과대. 매시간 커지다 벽시계 월초에 0으로 리셋되는 톱니다.

- `ShipmentDoc`에 `shippedOperatingMs: number` 추가 (신규 출하부터 기록)
- 집계 창을 **운영월**로: `operatingMonth = floor(operatingEpochMs / (30 × 86_400_000))`
- 필드가 없는 과거 출하는 집계에서 제외한다 — 벽시계로 폴백하면 같은 오류가 섞인다

### F2. 사용량 실적 창 (심각)

`src/lib/usage-twin-data.ts:31`이 `Date.now() - 30 × 86_400_000`(30 벽시계일 = 운영 720일 = 24개월) 창의 소모를 모아, 운영 1개월 설계치(`monthlyQty`)와 나란히 놓고 `usageGap`을 계산한다(`UsageClient.tsx:519`).

- 창을 **운영 30일**로 교체
- 소스를 `materialFlowEvents` → `twinBurnEvents`로 교체. 전자는 2026-07-27 이후 적재가 끊겨 실적이 사실상 0이다
- `TwinBurnEventDoc`에 `operatingEpochMs` 추가

### F3. 화면 배속 표기

`twinState.speedMultiplier`는 `1`로 박힌 사문화 필드이고 운영시계가 읽지 않는다(`state.ts:15`). 그런데 `M20NodeDensityCard.tsx:119`가 `{speedMultiplier}× MODELED_BASELINE`으로 표시해 화면이 "1×"라고 말한다. 실제는 24×.

- `TwinEngineStateDoc.speedMultiplier` 제거, API·화면은 `OPERATING_SPEED_MULTIPLIER` 표기

### F4. tick 횟수 기반 시간

`scripts/approve-all-pending-pos.ts`의 `simDaysPerTick(cycleDays, totalSteps)`는 RULES가 명시적으로 금지한 패턴이다. 운영시계를 쓰도록 교체한다.

### F5. 스케줄러 기동 취약점

```ts
// src/instrumentation.ts — 현재
const { startTwinScheduler } = await import("@/lib/twin/scheduler");
const { startInboundReceiptTaskScheduler } = await import("@/lib/inbound-receipt-task-scheduler");
startTwinScheduler();          // 두 import를 모두 await한 뒤에야 호출
startInboundReceiptTaskScheduler();
```

두 번째 import가 부팅 시 던지면 트윈 스케줄러가 **아예 시작되지 않고**, 실패는 조용하다. 2026-08-12 5일 공백의 유력한 경로다(그 날 22:38에 이 순서를 만든 편집이 있었다). 각 스케줄러를 독립적으로 기동하고 실패를 개별 로깅한다.

## 4. 데이터 모델

```ts
export interface TwinDailySnapshotDoc {
  _id: string;                 // `OP-${operatingDay}` — 운영일이 키라 중복 적재 불가
  operatingDay: number;        // 운영 절대일 = floor(operatingEpochMs / 86_400_000)
  wallDayKey: string;          // "2026-08-18" — 벽시계 토글용 버킷
  recordedAt: Date;            // 벽시계 사실 기록 (가속하지 않음)

  production: { product: Product; producedQty: number; designDailyQty: number; ratePct: number }[];
  materials: {
    stockoutCount: number;     // 재고 0
    criticalCount: number;     // 커버리지 < ROP×0.5
    medianDoh: number;
    worst: { materialCode: string; doh: number }[];   // 하위 5종
  };
  warehouses: { code: string; utilization: number; baselineUtilization: number }[];
  shipments: { product: Product; shippedQty: number; contractDailyQty: number; fulfillmentPct: number }[];

  policy: { r1: number; r2: number; r3: number; r4: number };  // 위반 건수
  engine: { ticks: number; elapsedOperatingMs: number; clampedCatchUps: number };
}
```

### 적재 트리거

엔진 tick이 **운영일 경계를 넘을 때** 직전 운영일을 확정 upsert한다. 별도 스케줄러를 만들지 않는다 — RULES의 "기능별 독자 시계 금지"에 걸리고, 운영시계를 이미 들고 있는 tick이 유일하게 옳은 위치다.

이 모델의 성질: **엔진이 멈추면 운영일이 안 넘어가므로 스냅샷도 안 생긴다.** 벽시계 축으로 토글하면 그 구간이 구멍으로 드러나고, `clampedCatchUps`가 정지가 있었다는 증거로 남는다.

## 5. 화면

**위치**: `/trends` "운영 트렌드" — 사이드바 최상단 그룹, `관제탑 라이브` 바로 아래. 관제탑이 "지금", 트렌드가 "지금까지".

**상단 필터 한 줄**: `[운영일 ⇄ 벽시계일]` · 기간(운영 7/30/90일) · 제품 필터.

### 4개 섹션

| 축 | 형태 | 근거 |
|---|---|---|
| 생산 | 3계열 라인 + 100% 기준선 | 설계 대비 **비율**이라 3제품이 한 축에 들어온다 |
| 자재 | 결품 종수 막대 **＋** 커버리지 중앙값 라인 (**차트 2개**) | 종수와 일수는 단위가 달라 한 축 불가 — 이중축 금지 |
| 창고 | 창고 8개 **스파크라인 small multiples** | 8계열은 categorical 한계 초과. 칸마다 95% 발주상한·100% 임계 기준선 |
| 출하 | 3계열 라인 + 100% 계약선 | 생산과 **같은 제품 = 같은 색** |

### 시간축을 가로지르는 레이어

- **정책 변경 마커** — 세로선 + 라벨. R1·R2·R4는 마스터가 바뀔 때만 계단으로 변하므로 연속 곡선이 아니라 사건으로 표현한다. "ROP 37종 교정 → 이후 결품 곡선이 꺾였는가"를 한 화면에서 읽게 하는 장치.
- **엔진 공백 밴드** — 벽시계 축에서 스냅샷이 없는 구간을 회색 빗금.

### 색

상태색(`#EA002C` critical · `#F7A600` warning · `#00B96B` ok)은 **예약**이며 계열 색으로 재사용하지 않는다.

제품 categorical 팔레트 — `#0078D4` HBM · `#B5179E` DRAM · `#0E9B8A` NAND.
`dataviz/scripts/validate_palette.js` 6검사 전항목 PASS (light, surface `#fcfcfb`): 최악 인접쌍 deutan ΔE 9.8 · tritan 28.9 · 정상시야 26.9 · 대비 전부 ≥3:1.

색은 **엔티티에 고정**한다. 필터가 계열 수를 바꿔도 살아남은 계열의 색이 바뀌지 않는다.

### 상호작용·접근성

- 공유 크로스헤어 + 툴팁 (4섹션 동기화)
- 계열 2개 이상이면 범례 상시 노출, 4개 이하는 직접 라벨 병행 — 식별이 색에만 의존하지 않게
- 표 보기 토글
- 화면에 **적재 시작일**을 명시한다 (백필하지 않으므로 초기 며칠은 표본이 얇다)

## 6. 테스트

TDD로 진행한다. 순수 함수를 분리해 DB 없이 검증한다.

| 대상 | 검증 |
|---|---|
| `operatingMonthOf(operatingEpochMs)` | 운영월 경계, 0일차, 음수 방어 |
| `snapshotBoundaryCrossed(prevOpMs, nextOpMs)` | 경계 미도달/1일/다일 점프(catch-up) |
| `buildDailySnapshot(input)` | 4축 집계, 제로 분모, 제품 누락 |
| `fulfillmentPctOf` (F1 후) | 운영월 창 기준 값 |
| 차트 스케일 함수 | 도메인 0폭, 단일 표본, 결측 구간 |

기존 `test:twin-*` · `test:inventory-policy` 회귀 전부 통과해야 한다.

## 7. 구현 순서

1. F5 스케줄러 기동 (엔진이 안 뜨면 나머지가 무의미)
2. F3 · F4 (표기·스크립트, 독립적)
3. F1 · F2 (집계 창 — 이벤트에 운영시각 필드 추가 포함)
4. `twinDailySnapshots` 모델 + tick 적재
5. `/api/twin/trends` 조회 API
6. `/trends` 화면 — 필터 → 4섹션 → 마커·공백 밴드
