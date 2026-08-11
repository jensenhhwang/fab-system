# 공정 흐름도 분리·통합 운영 화면 설계

**작성일:** 2026-08-11  
**상태:** 사용자 설계 승인 대기

## 목표

`/usage`에서 자재 분석과 생산 실행을 분리한다. 새 `/process-flow`는 Route 전체·선택 공정·WIP/Lot·설비·자재 사용량·3D 공간 위치를 하나의 선택 상태로 연결해 보여주는 공정 운영 화면이 된다.

## 문제와 결정

현재 `/usage`에는 공정 사전, 3D FAB, 설비 원장, M20 Lot 추적, WIP 밀도, 자재 계획·실적 테이블이 모두 있다. 자재 원인 분석과 생산 공정 관찰의 목적이 달라 화면의 주제가 흐려진다.

다음 구조로 결정한다.

- `/usage`는 자재 사용량 분석 화면이다. Fab·공정·자재별 계획 사용량, 최근 30일 실사용, 차이, 재고일수, 창고 공급 관계를 제공한다.
- `/process-flow`는 생산 운영 화면이다. 2D Route 맵이 주 화면이며, 선택된 공정/Route 노드가 우측 인스펙터, 활성 Lot, 3D FAB 위치, 해당 공정의 자재 사용량을 함께 갱신한다.
- 3D FAB는 Route 전체의 실제 실행 순서를 대표하지 않는다. 설비의 물리적 위치와 선택 공정/FOUP의 공간 맥락을 확인하는 보조 뷰다.
- 두 화면은 URL 컨텍스트를 보존해 양방향으로 이동한다.

## 정보 구조

사이드바 `생산 실행` 그룹을 다음 순서로 구성한다.

1. `공정 흐름도` → `/process-flow`
2. `공정별 사용량` → `/usage`
3. `완제품 재고` → `/finished-goods`

`/usage`에서 제거해 `/process-flow`로 옮기는 기능은 공정 사전, 3D 공정 흐름도, 설비 원장, 노드 WIP 밀도, M20 Lot Route 추적, Blocked Lot 패널이다. 사용량 화면에는 공정 선택 필터와 `공정 흐름도에서 보기` 딥링크를 남긴다.

## 공정 흐름도 화면

### 상단 컨텍스트 바

- Fab 선택: `M20 · HBM`, `M21 · DRAM`, `M22 · NAND`, `전체 3FAB` 중 하나. 세부 Route/3D/Lot 관찰은 Fab 하나를 선택했을 때 제공한다.
- Route 식별: 활성 Route Master의 `routeMasterId`, `routeVersion`, 노드 수와 확장 Step 수를 표시한다.
- 데이터 기준을 화면 전체에서 명확히 표시한다.
  - M20: `LIVE TWIN · WATCHED/MODELED_FOUP` — 폴링되는 Twin 상태이며 MES 실측으로 표기하지 않는다.
  - M21/M22: `MODELED_BASELINE · FOUP_EQUIVALENT` — step-bucket 집계이며 개별 Lot 추적처럼 표기하지 않는다.
- 마지막 데이터 기준 시각과 연결 상태를 표시한다. API가 실패하거나 연결되지 않으면 이전 수치에 `데이터 연결 실패` 상태를 함께 표시한다.

### 전체 3FAB 상태

`전체 3FAB`에서는 서로 다른 제품의 양을 합산하지 않는다. Fab별 카드로 Route 버전, WIP 단위/연결 상태, 설비 총수, 자재 연결 공정 수를 비교하고, 카드를 누르면 해당 Fab의 세부 공정 흐름도로 진입한다.

### 단일 Fab 통합 운영 화면

한 화면의 고정 순서는 다음과 같다.

1. **운영 요약 띠:** 현재 WIP, 활성 Lot 또는 FOUP-equivalent, 관심 공정, 설비 총수, 데이터 기준.
2. **Route 맵:** 화면의 가장 넓은 영역을 차지한다. 활성 Route Master의 `nodes` 순서를 사용한다. 각 노드는 `label`, `stage`, `operationCode`, `cycle`, `repeatCount`, WIP 수, 설비 기준 대수를 보인다. 반복은 동일 노드를 여러 장 복제하지 않고 `cycle × repeatCount` 배지로 접는다. 노드를 선택하면 실제 방문 순서(`expandRouteMaster`)와 선택 Visit의 위치를 인스펙터에서 펼친다.
3. **선택 인스펙터:** 선택한 Route 노드의 공정 목적, operation, 반복/방문 순서, 이전/다음 방문, WIP, 설비 기준 대수, 연결 자재 수, 최근 30일 계획 대비 실사용을 표시한다. M20에서만 그 노드의 활성 watched Lot 목록과 상태를 보인다.
4. **하단 연동 영역:** 왼쪽은 선택 공정에 카메라가 맞춰진 3D FAB, 오른쪽은 선택 공정의 자재 사용량 상위 항목과 계획 대비 실사용 차이를 표시한다. 이 영역은 같은 선택 상태를 사용하며 별도 탭으로 숨기지 않는다.

Route 맵에서 선택 가능한 단위는 `processCode`가 아니라 Route 노드(`nodeId`)다. 따라서 P10처럼 operation이 여러 개인 공정도 서로 다른 노드로 정확히 구별된다. 자재 분석으로 넘어갈 때는 선택 노드의 `processCode`를 사용한다.

## 상태와 딥링크

두 화면은 다음 쿼리 컨텍스트를 공유한다.

- `fab`: M20, M21, M22, ALL
- `process`: P01–P10. 자재 분석 필터 및 3D 공정 강조의 공통 키
- `node`: Route 노드 ID. 공정 흐름도에서의 정확한 선택 키
- `lot`: M20 watched Lot ID. 존재하지 않거나 현재 Fab과 다르면 선택을 해제한다.
- `material`: 자재 ID. 사용량 테이블의 고정 선택에 사용한다.
- `routeMasterId`: 공정 흐름도 Route의 명시 선택. 없으면 Fab·제품의 활성 Route Master를 사용한다. 현재 Route의 `routeVersion`은 URL에 보존하되, ID와 버전이 맞지 않으면 현재 활성 Route로 안전하게 되돌리고 안내를 표시한다.
- `mode`, `time`: 기존 Twin 탐색 컨텍스트를 그대로 보존한다.

`/usage?fab=M20&process=P03`의 공정 흐름도 링크는 `/process-flow?fab=M20&process=P03`로 이동한다. `/process-flow`의 자재 사용량 링크는 선택 노드의 공정 코드와 Fab을 유지해 `/usage`로 이동한다. 라우트 노드 선택은 `node`를 추가해 새로고침과 뒤로 가기에서도 유지한다.

## 데이터와 갱신

초기 서버 렌더링은 기존 데이터 계약을 재사용한다.

- Route: `getRouteMaster`, `getRouteMasterById`, `expandRouteMaster`
- 공정 설명: `getProcessGuide`
- 자재 계획/실사용/창고 정보: `getUsageTwinData`
- 설비 기준 대수: `getEquipmentCapacity`, Fab별 Equipment Master builder

클라이언트는 선택 Fab이 바뀔 때 다음 읽기 전용 API를 호출하고, 문서 탭이 보이는 동안 10초 간격으로 갱신한다.

- `/api/wafer-lots/node-density?fabId=&product=`: Route 노드별 WIP, Route 버전, WIP 단위와 연결 상태.
- `/api/wafer-lots/active-all?fabId=&product=`: M20 활성 Lot/방문 상태. M21/M22에서는 목록을 표시하지 않는다.
- 기존 `/api/wafer-lots/foup-fleet`: M20 3D FOUP 표현에만 사용한다.

초기 구현에서는 새 쓰기 API, Route 편집, 드래그 재배치, MES 입력, 도구 상태/Queue/Dwell 산출을 추가하지 않는다.

## 3D FAB 경계

`ProcessFlow3D`는 기존 창고·배관·설비·FOUP 기능을 유지하되, 새 `selectedProcess`/`selectedNode` 입력으로 외부 선택에 카메라를 맞출 수 있어야 한다. 선택 노드의 공정 코드로 설비 bay를 강조한다. `node`가 같은 공정의 여러 반복 방문을 구별하더라도 3D는 공정 bay 하나를 강조하는 것이 정상이다.

3D의 장식 wafer 애니메이션은 Route 전체 실제 순서나 MES 실측으로 표현하지 않는다. 화면은 실제 Twin/API 기반 Lot과 장식 애니메이션을 시각적으로 구분하고, 데이터 기준 라벨을 유지한다.

## 오류 처리와 빈 상태

- Route Master가 없으면 Route 맵 대신 재시도 안내와 Fab 선택을 표시한다. 사용량 화면은 계속 사용할 수 있다.
- 노드 WIP API가 실패하면 Route 구조와 설비 기준 대수는 표시하되 WIP 영역에 `연결 실패`를 표시한다.
- M20의 활성 Lot이 없으면 인스펙터에 `추적 중인 활성 Lot 없음`을 표시한다. 자동 생성이나 자동 진행을 조회 화면에서 수행하지 않는다.
- 쿼리 값이 유효하지 않거나 서로 불일치하면 유효한 Fab 범위와 활성 Route로 복구하고, 선택이 초기화되었음을 한 줄로 알린다.
- M21/M22는 개별 Lot 또는 실측 병목/지연으로 표현하지 않는다. 집계 WIP와 모델 상태만 표시한다.

## 검증 기준

- 사이드바에서 두 화면이 독립 항목으로 탐색되고, 현재 경로가 각각 정확히 활성화된다.
- `/usage`에는 더 이상 3D, 공정 사전, 설비 원장, Lot 추적이 렌더링되지 않으며, 공정 흐름도로 이동하는 딥링크가 Fab/공정 컨텍스트를 보존한다.
- `/process-flow`에서 M20/M21/M22/전체 범위를 모두 안전하게 전환할 수 있다.
- 단일 Fab에서 Route 노드 선택은 인스펙터·3D 강조·자재 사용량을 동시에 바꾸고 URL의 `node`와 `process`를 동기화한다.
- Route 노드의 반복 수와 확장 step 순서가 `expandRouteMaster` 결과와 일치한다.
- M20은 watched Lot을 표시하되 조회가 Lot 생성/진행을 유발하지 않는다. M21/M22는 `MODELED_BASELINE · FOUP_EQUIVALENT` 라벨을 표시한다.
- API 오류/빈 데이터/잘못된 딥링크 상태가 페이지 오류 없이 명시적으로 안내된다.

## 범위 제외

- Route Master의 생성·편집·버전 관리 UI
- Drag-and-drop 공정 배치
- MES에서 체류시간, queue, tool 상태, 실측 병목을 수집하거나 추론하는 기능
- M21/M22의 개별 Lot 원장 및 실시간 추적
- 자재 계획 또는 설비 원장의 데이터 모델 변경
