# 트윈 엔진 독립 워커 분리 — 설계

작성일 2026-08-22 · 브랜치 `feat/dram-nand-finished-goods`

## 1. 문제

엔진이 Next.js 프로세스 안에서만 돈다. `instrumentation.register()`가 `setTimeout` 자기재예약 체인을 띄우는 구조라 **살아있는 Node 프로세스**를 전제하고, 그래서:

- 서버리스(Vercel)에서는 인스턴스가 내려가면 체인도 죽는다 — 조용히 멈추므로 멈춘 걸 알 수도 없다
- 웹 서버를 재시작할 때마다 tick이 중간에 끊기고 5분짜리 락이 남는다
- 개발 중 파일을 고칠 때마다 핫리로드로 엔진이 끊긴다

리드타임은 운영시간이라 화물이 도착하려면 엔진이 **실제로 그만큼 돌아야** 한다. 게다가 운영시계의 catch-up 상한이 정지 구간을 버리므로 꺼져 있던 시간은 만회되지 않는다. 2026-08-18~22 사이 결품이 풀리지 않은 직접 원인이 이것이다.

뷰어(웹·데스크톱)가 엔진을 품는 방식은 답이 아니다 — **화면을 닫으면 팹이 멈춘다.** 엔진은 어떤 화면에도 붙지 않아야 한다.

## 2. 무엇이 막고 있나

`executeTwinTick`이 `server-only`를 import하는 모듈에 전이 의존해서 Next 바깥에서 실행되지 않는다.

```
engine.ts:16  →  material-scenario-server.ts  →  import "server-only"
```

`import "server-only"`는 클라이언트 번들에 섞이면 던지는 **마커**다. 기능적 의존이 아니다.

엔진이 그 모듈을 쓰는 곳은 단 한 군데다.

```ts
// engine.ts:409 — 매 tick
const { materials: scenarioMaterials } = await loadLiveScenarioMaterials(now);
const scenarioByMaterial = new Map(scenarioMaterials.map((m) => [m.id, m]));

// engine.ts:482 — 유일한 사용처
const scenarioMat = scenarioByMaterial.get(materialId);
const ceiling = autonomyCeiling(scenarioMat
  ? { category: scenarioMat.category, procurementAlternatives: scenarioMat.procurementAlternatives, supplyMode: scenarioMat.supplyMode }
  : { category: mat.category, procurementAlternatives: [], supplyMode: mat.supplyMode });
```

세 필드 중 `category`·`supplyMode`는 이미 `mat`(자재 마스터)에 있다. **오직 `procurementAlternatives` 하나** 때문에 무거운 모듈을 부른다.

그 값은 `buildProcurementSummary(links, suppliers).alternatives`가 돌려주는 것이고, 엔진은 **이미 공급사 링크를 배치로 들고 있다**(`allSupplierLinks`·`allSupplierDocs` — 리드타임 진실원 통일 때 추가됨). 지금 있는 데이터로 계산할 수 있다.

## 3. 설계

### 3.1 `loadLiveScenarioMaterials` 호출 제거

`procurementAlternatives`를 이미 로드한 공급사 링크에서 유도한다. `material-scenario-server.ts`의 `import "server-only"`는 **그대로 둔다** — 가드를 약화시키지 않고, 엔진이 그 모듈을 안 부르게만 한다.

부수 효과로 tick이 빨라진다. 그 함수는 매 tick `getInventoryRows` + `getProcessUsagesWithMaterial` + 컬렉션 6개 스캔(`materialSuppliers`·`suppliers`·`inventoryLots`·`materialAllocations`·`inboundPlans`·`agentPolicies`)을 돌린다. 통째로 사라진다.

### 3.2 `scripts/twin-worker.ts` 신설

`executeTwinTick()`을 반복 호출하는 독립 프로세스. Next와 무관하다.

- self-scheduling `setTimeout` 체인 — 이전 tick이 끝난 뒤에만 다음을 예약한다(겹침 구조적 차단, `scheduler.ts`와 같은 규칙)
- `SIGINT`/`SIGTERM`에 진행 중 tick을 마치고 락을 반납한 뒤 종료 — 중간에 죽어 5분짜리 락이 남는 걸 막는다
- tick 간격은 `twinEngineState.tickIntervalMs`를 따른다
- 실패해도 루프를 멈추지 않고 다음 tick을 예약한다

### 3.3 기존 스케줄러와의 관계

`instrumentation.ts`의 웹 내장 스케줄러는 **그대로 둔다.** Mongo 락이 겹침을 막으므로 워커와 동시에 떠 있어도 안전하고(뒤늦은 쪽은 `skipped: "LOCKED"`), 로컬에서 웹만 띄워 쓰는 경로가 유지된다.

## 4. 검증

| 대상 | 방법 |
|---|---|
| `procurementAlternatives` 동등성 | 같은 공급사 링크에 대해 `buildProcurementSummary().alternatives`와 기존 `ScenarioMaterial.procurementAlternatives`가 `autonomyCeiling`에서 같은 판정을 내는지 (TDD) |
| 엔진 독립 실행 | `test:twin-engine`·`test:twin-calibration` 복구 — 지금 `server-only`로 죽어 있다 |
| 워커 동작 | 실제로 띄워 tick이 돌고 `lastTickAt`이 전진하는지 |
| 회귀 | 기존 `test:twin-*`·`test:inventory-policy`·`test:contract-window`·`test:daily-snapshot`·`test:chart-scale` |

## 5. 범위 밖

이번에 하지 않는 것을 명시한다.

- **소모가 설계의 4~6배인 문제** (GAS-004·006·014). 결품의 뿌리로 의심되지만 별건이다.
- **워커를 어디에 호스팅할지.** 이번엔 "돌 수 있게" 만들 뿐이고, 상시 호스트 선택은 다음 결정이다.
- **공정 3D 재설계.** 엔진이 연속으로 돌기 시작한 뒤에 착수한다 — 보여줄 팹이 돌아야 만들 수 있다.
- **엔진 정책·소모 모델.** 로직은 손대지 않는다.
