# FAB 운영 4역할 인격·사고학습 설계

작성일: 2026-08-18  
상태: 사용자 승인 완료  
범위: 김구매·이자재·최생산·박물류의 인격 정본과 학습 거버넌스

## 목표

코드와 화면에 흩어진 네 운영 역할의 정체성·책임·금지사항을 문서 정본으로 만들고,
운영 사고에서 생성된 교훈이 사용자 승인 없이 실제 정책을 변경하지 못하도록 경계를 정한다.

## 결정

문서와 런타임 데이터를 혼합한다.

- `docs/roles/`: 안정적인 Core Identity와 공통 학습 계약의 정본
- 현재 `*-agent.ts`: 실행 중인 결정론 판단 규칙과 `policyVersion`
- MongoDB: 향후 사고·개선 제안·승인된 정책 개정 이력
- `.claude/agents/`: 개발 보조 에이전트이며 운영 역할과 분리

삭제된 M20 파일럿의 `PROCUREMENT/WMS/MES/PROCESS` 문서는 제거한다. 해당 레거시의
`agentRuns`·`agentDecisions` 스키마는 현재 네 역할 학습 원장으로 간주하지 않는다.

## 인격 모델

각 역할은 다음 세 층을 가진다.

1. `Core Identity`: 이름·소속·목적·책임·금지사항·하드 안전규칙
2. `Active Policy`: 실제 판단에 사용하는 승인된 정책과 버전
3. `Learning Memory`: 사고·분석·교훈·개선 제안·승인 또는 반려 이력

담당자는 Learning Memory에 개선안을 만들 수 있지만 Core Identity와 Active Policy를 직접
변경할 수 없다.

## 역할 경계

| 역할 | 소유 책임 | 소유하지 않는 책임 |
|---|---|---|
| 김구매 `PROCUREMENT` | 발주 시점·수량·공급 위험 | 실물 입고 확인·재고 진실성·WIP 진행 |
| 이자재 `MATERIALS` | 가용재고·소모·원장 정합 | 공급사 선택·생산 목표·창고 법적 승인 |
| 최생산 `PRODUCTION` | WIP·투입·차단·생산 영향 | 재고 조정·발주 실행·실물 입고 승인 |
| 박물류 `LOGISTICS` | 실물 입고·위치·Capacity·이동 | 수요 계산·원단위 변경·생산실적 확정 |

## 학습과 승인

학습 상태는 `OBSERVED → ANALYZED → PROPOSED → APPROVED/REJECTED → ACTIVE → SUPERSEDED`다.
자동 진행은 `PROPOSED`까지 허용한다. 사용자가 승인한 정책만 새 `policyVersion`으로 실제 판단에
반영한다.

위험물·법적 Capacity·음수재고·이중입고·실물 확인·24× 공통 운영시계는 자동 변경 금지다.

## 저장 구조

```text
docs/roles/
├── README.md
├── procurement.md
├── materials.md
├── production.md
├── logistics.md
└── learning-governance.md
```

런타임 학습 단계에서는 `operationIncidents`, `operationLearningProposals`,
`operationPolicyRevisions`를 별도 컬렉션으로 추가한다. 기존 `controlTowerAIEpisodes`는 자문
스냅샷으로 유지하며 결과 학습 원장으로 승격하지 않는다.

## 오류와 안전 처리

- 근거 데이터가 없으면 개선 제안을 만들지 않고 `DATA_GAP`으로 남긴다.
- 정책 버전이 확인되지 않는 판단은 학습 사례로 승인할 수 없다.
- 역할 간 인과가 이어지는 사고는 공동 `incidentId`로 묶는다.
- 승인 전 제안은 조회와 비교만 가능하고 실행 엔진이 읽을 수 없다.
- 반려·대체된 정책도 과거 판단 재현을 위해 삭제하지 않는다.

## 검증 기준

- 네 역할의 목적·책임·데이터·금지사항·지표·학습 관점이 각각 문서화돼 있다.
- 운영 역할과 `.claude/agents/`, 레거시 M20 에이전트가 명확히 구분돼 있다.
- 승인 전 정책이 실행될 수 없다는 규칙이 명시돼 있다.
- 네 역할이 공유하는 공동 목표와 충돌 해결 순서가 정의돼 있다.
- 향후 런타임 원장의 컬렉션 책임이 중복 없이 분리돼 있다.

## 이번 단계의 범위 제외

- MongoDB 학습 컬렉션과 API 구현
- 과거 사건 자동 백필
- 강화학습·모방학습 모델 훈련
- 승인 UI와 정책 자동 배포
- 현재 `*-agent.ts` 판단식 변경
