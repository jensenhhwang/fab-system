# 담당자에게 묻기 — 결정론 응답기 설계

작성일 2026-08-22 · 브랜치 `feat/dram-nand-finished-goods`

## 1. 문제

"담당자에게 묻기"가 질문마다 OpenAI를 호출한다. API 결제가 부담이고, 현재 `aiEnabled = false`라 **비용은 안 나가지만 기능도 같이 죽어 있다.**

## 2. 왜 AI 없이 가능한가

지금 AI는 새 정보를 만들지 않는다. 프롬프트가 그렇게 못박고 있다.

```
고정된 Snapshot의 담당 영역 facts와 rule만 근거로 사용하세요.
근거에 없는 수치나 상태를 만들지 말고, 필요한 값은 evidenceRefs로 연결된 카드가 보여주게 하세요.
```

판단·수치·상태는 전부 서버가 결정론적으로 계산해 `ControlTowerEvidenceFact`로 넘긴다. AI가 하는 일은 **그것을 한국어 문장으로 엮는 것**과 **자유 문장을 의도로 해석하는 것** 둘이다. 앞은 템플릿으로, 뒤는 키워드 매칭으로 대체한다.

## 3. 설계

### 3.1 순수 함수 두 개

DB·네트워크를 만지지 않아 tsx로 바로 테스트된다.

```
질문 문장 → matchAskIntent(role, question)  → AskIntent
          → buildAskAnswer(intent, facts, rule) → ControlTowerAskAnswer
```

**`src/lib/control-tower-ask-intent.ts`**

```ts
export type AskIntent =
  | { kind: "TOP_PRIORITY" }        // 지금 가장 급한 것
  | { kind: "WHY_BLOCKED" }         // 왜 멈췄나
  | { kind: "MATERIAL"; code: string } // 특정 자재
  | { kind: "RULE" }                // 적용된 규칙
  | { kind: "CAPACITY" }            // 창고 점유
  | { kind: "OPEN_ORDERS" }         // 미착 발주
  | { kind: "UNKNOWN" };

export function matchAskIntent(role: ControlTowerRole, question: string): AskIntent;
```

역할별로 답할 수 있는 의도만 매칭한다. 예를 들어 `WHY_BLOCKED`는 PRODUCTION에서만, `CAPACITY`는 LOGISTICS에서만 잡는다. 담당 밖 키워드가 잡히면 `UNKNOWN`이 아니라 **다른 담당자를 가리킨다**(`suggestedRole`).

자재 코드는 `CHM-002` 같은 패턴을 질문에서 직접 뽑는다. 대소문자와 공백을 정규화한다.

**`src/lib/control-tower-ask-answer.ts`**

```ts
export function buildAskAnswer(input: {
  role: ControlTowerRole;
  intent: AskIntent;
  facts: ControlTowerEvidenceFact[];   // 이미 역할로 필터된 것
  ruleText: string | null;
}): ControlTowerAskAnswer;
```

`ControlTowerAskAnswer`는 **기존 스키마를 그대로 채운다** — `status`·`answer`·`recommendation`·`assumptions`·`evidenceRefs`·`suggestedRole`·`actionSuggestion`·`advisoryOnly`. 화면과 저장 형식이 안 바뀐다.

원칙:

- `evidenceRefs`는 **facts에 실제로 존재하는 ref만** 담는다. 최대 4개(기존 스키마 상한).
- facts에 없는 수치는 문장에 쓰지 않는다. 값은 카드가 보여준다.
- 답할 근거가 없으면 `INSUFFICIENT_EVIDENCE`, 담당 밖이면 `OUT_OF_SCOPE` + `suggestedRole`.
- `UNKNOWN` 의도는 `INSUFFICIENT_EVIDENCE`로 두고, `recommendation`에 **그 담당자가 답할 수 있는 질문 예시**를 넣는다. 지어내지 않는다.
- `advisoryOnly`는 항상 `true`.

### 3.2 행동 제안

`CREATE_INBOUND_PLAN_DRAFT`를 규칙으로 만든다. 기존 게이트를 그대로 지킨다.

- 역할이 `PROCUREMENT` 또는 `MATERIALS`일 때만
- `targetRef`가 `MATERIALS:{code}` 또는 `PROCUREMENT:RULE:{code}` 패턴일 때만
- `targetRef`가 `evidenceRefs`에 포함될 때만
- 그 fact의 `state === "CRITICAL"`일 때만

수량·공급사·날짜는 제안하지 않는다(기존 규칙과 동일).

### 3.3 교체 지점

`control-tower-ask-server.ts`의 `answerQuestion()`에서 OpenAI 호출부만 위 두 함수로 바꾼다. 반환 형태는 유지하되 AI 전용 필드는 비운다.

| 필드 | 결정론 경로 |
|---|---|
| `usage` | `null` |
| `costMicroUsd` | `0` |
| `model` | `"DETERMINISTIC_V1"` |
| `latencyMs` | 실제 소요(수 ms) |

`runBudgetedControlTowerCall`을 타지 않으므로 예산도 소모하지 않는다.

## 4. 범위 밖

- tick 자동판단(`maybeRunControlTowerAI`), What-if 코파일럿, 음성, 시나리오 — `aiEnabled = false`로 이미 꺼져 있고 이번 변경 대상이 아니다.
- OpenAI 의존 파일은 지우지 않는다. 나중에 다시 켤 수 있어야 한다.
- 화면(`ControlTowerAskPanel.tsx`)은 손대지 않는다.

## 5. 검증

| 대상 | 검증 |
|---|---|
| `matchAskIntent` | 역할별 키워드, 자재코드 추출, 담당 밖 → suggestedRole, 미매칭 → UNKNOWN |
| `buildAskAnswer` | facts 없음 → INSUFFICIENT_EVIDENCE · evidenceRefs가 존재하는 ref만 · 상한 4개 · CRITICAL 없으면 행동제안 null |
| 행동 제안 게이트 | 역할·ref 패턴·evidenceRefs 포함·CRITICAL 네 조건 |
| 회귀 | 기존 `test:*` 전부 |

## 6. 잃는 것

자유 문장 해석의 폭이 줄어든다. 키워드에 안 걸리는 질문은 예시 안내로 떨어진다.

대신 **없는 사실을 그럴듯하게 말하는 위험이 사라지고**, 같은 질문에 항상 같은 답이 나오며, 비용이 0이 된다.
