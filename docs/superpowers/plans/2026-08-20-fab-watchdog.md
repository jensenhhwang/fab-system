# FAB Server Watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** macOS 로그인 이후 FAB Next.js 서버를 자동 기동하고, 프로세스 종료 또는 연속 HTTP 준비 실패 시 안전하게 재기동한다.

**Architecture:** `launchd`는 장수 watchdog Node 프로세스 하나만 `KeepAlive`한다. watchdog은 Next.js를 자식 프로세스로 소유하고 `/api/health/live`와 `/api/health/ready`를 실제 60초마다 검사하며, 연속 세 번 실패하면 자식을 교체한다. health 판정은 DB의 `RUNNING` 문자열과 마지막 tick 신선도를 분리한다.

**Tech Stack:** macOS launchd · Node.js 24 ESM · Next.js 16.2.10 Route Handlers · MongoDB native driver · TypeScript · `node:assert/strict`

## Global Constraints

- Next.js 코드를 쓰기 전에 `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`와 `route.md`를 따른다.
- watchdog timeout·재시도·프로세스 시작·로그는 벽시계다. Twin 운영시간을 진행하지 않는다.
- ready 임계는 `max(180_000, tickIntervalMs × 12)`ms다.
- `PAUSED`는 의도된 운영 정지일 수 있으므로 HTTP ready 실패가 아니다.
- 비밀 환경변수, 세션, 원재고 데이터는 health 응답이나 watchdog 로그에 출력하지 않는다.
- 사용자가 명시하지 않았으므로 서브에이전트를 호출하지 않는다.
- 기존 미커밋 변경을 보존하고 이 계획의 파일만 단계별로 커밋한다.

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/server-health.ts` | tick 신선도와 ready 상태를 판정하는 순수 함수 |
| `src/app/api/health/live/route.ts` | 민감정보 없는 프로세스 생존 응답 |
| `src/app/api/health/ready/route.ts` | DB·Twin 신선도 준비 상태 응답 |
| `scripts/test-server-health.ts` | ready 정책 단위 테스트 |
| `scripts/fab-server-watchdog.mjs` | Next 자식 프로세스 소유·health 검사·재기동 |
| `scripts/test-fab-server-watchdog.mjs` | 실패 누적·backoff·재기동 판단 단위 테스트 |
| `scripts/fab-server-launchd.mjs` | plist 생성, install/start/stop/status 명령 |
| `package.json` | 테스트와 운영 명령 등록 |

---

### Task 1: Twin ready 순수 정책

**Files:**
- Create: `src/lib/server-health.ts`
- Create: `scripts/test-server-health.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `TwinEngineStateDoc`의 `status`, `lastTickAt`, `tickIntervalMs`
- Produces: `evaluateServerReadiness(input: ServerReadinessInput): ServerReadinessResult`

- [ ] **Step 1: 실패 테스트 작성**

```ts
import assert from "node:assert/strict";
import { evaluateServerReadiness } from "../src/lib/server-health";

const now = new Date("2026-08-20T12:00:00.000Z");
assert.deepEqual(evaluateServerReadiness({ now, dbConnected: true, state: {
  status: "RUNNING", lastTickAt: new Date("2026-08-20T11:59:30.000Z"), tickIntervalMs: 5_000,
} }).status, "READY");
assert.equal(evaluateServerReadiness({ now, dbConnected: true, state: {
  status: "RUNNING", lastTickAt: new Date("2026-08-20T11:56:59.999Z"), tickIntervalMs: 5_000,
} }).reason, "TICK_STALE");
assert.equal(evaluateServerReadiness({ now, dbConnected: true, state: {
  status: "PAUSED", lastTickAt: new Date("2026-08-19T00:00:00.000Z"), tickIntervalMs: 5_000,
} }).status, "READY");
assert.equal(evaluateServerReadiness({ now, dbConnected: false, state: null }).reason, "DB_UNAVAILABLE");
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx scripts/test-server-health.ts`  
Expected: FAIL — `src/lib/server-health` 모듈을 찾을 수 없음.

- [ ] **Step 3: 최소 구현 작성**

```ts
export const MIN_READY_TICK_STALE_MS = 180_000;

export type ServerReadinessInput = {
  now: Date;
  dbConnected: boolean;
  state: { status: "RUNNING" | "PAUSED"; lastTickAt: Date; tickIntervalMs: number } | null;
};

export type ServerReadinessResult = {
  status: "READY" | "NOT_READY";
  reason: "OK" | "PAUSED" | "DB_UNAVAILABLE" | "STATE_MISSING" | "TICK_STALE";
  checkedAt: string;
  engineStatus: "RUNNING" | "PAUSED" | null;
  secondsSinceTick: number | null;
  staleAfterMs: number | null;
};

export function evaluateServerReadiness(input: ServerReadinessInput): ServerReadinessResult {
  if (!input.dbConnected) return { status: "NOT_READY", reason: "DB_UNAVAILABLE", checkedAt: input.now.toISOString(), engineStatus: null, secondsSinceTick: null, staleAfterMs: null };
  if (!input.state) return { status: "NOT_READY", reason: "STATE_MISSING", checkedAt: input.now.toISOString(), engineStatus: null, secondsSinceTick: null, staleAfterMs: null };
  const elapsed = Math.max(0, input.now.getTime() - input.state.lastTickAt.getTime());
  const staleAfterMs = Math.max(MIN_READY_TICK_STALE_MS, input.state.tickIntervalMs * 12);
  if (input.state.status === "PAUSED") return { status: "READY", reason: "PAUSED", checkedAt: input.now.toISOString(), engineStatus: "PAUSED", secondsSinceTick: Math.floor(elapsed / 1000), staleAfterMs };
  return { status: elapsed > staleAfterMs ? "NOT_READY" : "READY", reason: elapsed > staleAfterMs ? "TICK_STALE" : "OK", checkedAt: input.now.toISOString(), engineStatus: "RUNNING", secondsSinceTick: Math.floor(elapsed / 1000), staleAfterMs };
}
```

- [ ] **Step 4: 테스트 스크립트 등록 및 통과 확인**

`package.json` scripts에 `"test:server-health": "tsx scripts/test-server-health.ts"`를 추가한다.

Run: `npm run test:server-health`  
Expected: `✅ 서버 ready 정책 테스트 통과`.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/server-health.ts scripts/test-server-health.ts package.json
git commit -m "feat(ops): define fab server readiness policy"
```

---

### Task 2: live·ready Route Handlers

**Files:**
- Create: `src/app/api/health/live/route.ts`
- Create: `src/app/api/health/ready/route.ts`

**Interfaces:**
- Consumes: `evaluateServerReadiness()` from Task 1, `collections()`
- Produces: unauthenticated `GET /api/health/live`, `GET /api/health/ready`

- [ ] **Step 1: live route 작성**

```ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const startedAt = new Date();

export async function GET() {
  return NextResponse.json({ status: "LIVE", startedAt: startedAt.toISOString(), checkedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 2: ready route 작성**

```ts
import { NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { evaluateServerReadiness } from "@/lib/server-health";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = new Date();
  try {
    const { twinEngineState } = await collections();
    const state = await twinEngineState.findOne({ _id: "singleton" });
    const view = evaluateServerReadiness({ now, dbConnected: true, state });
    return NextResponse.json(view, { status: view.status === "READY" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    const view = evaluateServerReadiness({ now, dbConnected: false, state: null });
    return NextResponse.json(view, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
```

- [ ] **Step 3: 타입·lint 확인**

Run: `npm run typecheck && npx eslint src/lib/server-health.ts src/app/api/health/live/route.ts src/app/api/health/ready/route.ts scripts/test-server-health.ts`  
Expected: exit 0.

- [ ] **Step 4: 실제 HTTP 확인**

Run: `curl -i http://127.0.0.1:3000/api/health/live`  
Expected: HTTP 200, `status=LIVE`, 원재고·환경변수 없음.

Run: `curl -i http://127.0.0.1:3000/api/health/ready`  
Expected: HTTP 200, `status=READY`, `engineStatus=RUNNING` 또는 `PAUSED`.

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/health/live/route.ts src/app/api/health/ready/route.ts
git commit -m "feat(ops): expose fab liveness and readiness"
```

---

### Task 3: watchdog 상태 머신과 자식 서버 소유

**Files:**
- Create: `scripts/fab-server-watchdog.mjs`
- Create: `scripts/test-fab-server-watchdog.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `FAB_WATCHDOG_WORKDIR`, `FAB_WATCHDOG_PORT`, Node `spawn`, global `fetch`
- Produces: `WatchdogDecision`, `nextWatchdogDecision(state, event)`, 실행 가능한 watchdog CLI

- [ ] **Step 1: 상태 머신 실패 테스트 작성**

```js
import assert from "node:assert/strict";
import { nextWatchdogDecision } from "./fab-server-watchdog.mjs";

let state = { consecutiveFailures: 0, restartAttempt: 0 };
state = nextWatchdogDecision(state, "HEALTH_FAILED");
assert.equal(state.action, "WAIT");
state = nextWatchdogDecision(state, "HEALTH_FAILED");
state = nextWatchdogDecision(state, "HEALTH_FAILED");
assert.equal(state.action, "RESTART");
assert.equal(nextWatchdogDecision(state, "HEALTH_OK").consecutiveFailures, 0);
assert.equal(nextWatchdogDecision(state, "CHILD_EXITED").action, "RESTART");
```

- [ ] **Step 2: 실패 확인**

Run: `node scripts/test-fab-server-watchdog.mjs`  
Expected: FAIL — watchdog 모듈을 찾을 수 없음.

- [ ] **Step 3: 순수 상태 머신 구현**

`scripts/fab-server-watchdog.mjs`에 아래 계약을 구현한다.

```js
export const FAILURE_LIMIT = 3;
export const HEALTH_INTERVAL_MS = 60_000;
export const HEALTH_TIMEOUT_MS = 10_000;

export function nextWatchdogDecision(state, event) {
  if (event === "HEALTH_OK") return { consecutiveFailures: 0, restartAttempt: 0, action: "WAIT" };
  if (event === "CHILD_EXITED") return { ...state, restartAttempt: state.restartAttempt + 1, action: "RESTART" };
  const consecutiveFailures = state.consecutiveFailures + 1;
  return { ...state, consecutiveFailures, action: consecutiveFailures >= FAILURE_LIMIT ? "RESTART" : "WAIT" };
}

export function restartDelayMs(attempt) {
  return Math.min(60_000, 1_000 * (2 ** Math.min(attempt, 6)));
}
```

- [ ] **Step 4: watchdog 실행 루프 구현**

같은 파일에서 `import.meta.url === pathToFileURL(process.argv[1]).href`일 때만 main을 실행한다.
main은 다음 순서를 정확히 지킨다.

```js
// 1. spawn("npm", ["run", "dev"], { cwd, env: process.env, stdio: "inherit" })
// 2. 시작 grace 30초 뒤 /api/health/ready 검사
// 3. AbortSignal.timeout(HEALTH_TIMEOUT_MS)로 요청 제한
// 4. 세 번 실패 시 SIGTERM, 10초 뒤 생존 시 SIGKILL
// 5. restartDelayMs() 후 새 자식 기동
// 6. watchdog SIGTERM/SIGINT 시 자식을 종료하고 재기동 없이 watchdog 종료
```

로그는 `[fab-watchdog] <ISO 벽시계> <event>` 형태로 status, reason, restart attempt만 남긴다.

- [ ] **Step 5: 테스트·등록**

`package.json`에 아래를 추가한다.

```json
"test:fab-watchdog": "node scripts/test-fab-server-watchdog.mjs",
"ops:watchdog": "node scripts/fab-server-watchdog.mjs"
```

Run: `npm run test:fab-watchdog && npm run test:server-health`  
Expected: 두 테스트 모두 PASS.

- [ ] **Step 6: 커밋**

```bash
git add scripts/fab-server-watchdog.mjs scripts/test-fab-server-watchdog.mjs package.json
git commit -m "feat(ops): restart unhealthy fab server"
```

---

### Task 4: launchd 관리 CLI

**Files:**
- Create: `scripts/fab-server-launchd.mjs`
- Create: `scripts/test-fab-server-launchd.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `process.execPath`, `process.cwd()`, `os.homedir()`, `launchctl`
- Produces: `renderLaunchAgentPlist(input)`, `install|start|stop|status|uninstall` CLI

- [ ] **Step 1: plist 렌더링 실패 테스트 작성**

```js
import assert from "node:assert/strict";
import { renderLaunchAgentPlist } from "./fab-server-launchd.mjs";

const xml = renderLaunchAgentPlist({ nodePath: "/opt/node", projectPath: "/Fab/fab-system", logPath: "/tmp/fab.log" });
assert.match(xml, /com\.hwangjihun\.fab-system\.watchdog/);
assert.match(xml, /<string>\/opt\/node<\/string>/);
assert.match(xml, /<string>\/Fab\/fab-system\/scripts\/fab-server-watchdog\.mjs<\/string>/);
assert.match(xml, /<key>KeepAlive<\/key>\s*<true\/>/);
```

- [ ] **Step 2: 렌더러와 CLI 구현**

label은 `com.hwangjihun.fab-system.watchdog`, plist 경로는
`path.join(os.homedir(), "Library/LaunchAgents", `${LABEL}.plist`)`로 고정한다. XML 특수문자를
escape하고 다음 키를 포함한다.

```xml
<key>ProgramArguments</key><array><string>NODE_PATH</string><string>PROJECT/scripts/fab-server-watchdog.mjs</string></array>
<key>WorkingDirectory</key><string>PROJECT</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>LOG_PATH</string>
<key>StandardErrorPath</key><string>LOG_PATH</string>
```

CLI 명령은 `launchctl bootstrap gui/<uid> <plist>`, `bootout`, `kickstart -k`, `print`를
`spawnSync` 인자 배열로 호출한다. 셸 문자열을 만들지 않는다.

- [ ] **Step 3: 테스트·package 명령 등록**

```json
"test:fab-launchd": "node scripts/test-fab-server-launchd.mjs",
"ops:server:install": "node scripts/fab-server-launchd.mjs install",
"ops:server:start": "node scripts/fab-server-launchd.mjs start",
"ops:server:stop": "node scripts/fab-server-launchd.mjs stop",
"ops:server:status": "node scripts/fab-server-launchd.mjs status",
"ops:server:uninstall": "node scripts/fab-server-launchd.mjs uninstall"
```

Run: `npm run test:fab-launchd`  
Expected: PASS, 사용자 LaunchAgents에는 아직 쓰지 않음.

- [ ] **Step 4: 커밋**

```bash
git add scripts/fab-server-launchd.mjs scripts/test-fab-server-launchd.mjs package.json
git commit -m "feat(ops): manage fab watchdog with launchd"
```

---

### Task 5: 실제 설치와 장애 복구 검증

**Files:**
- Runtime write: `~/Library/LaunchAgents/com.hwangjihun.fab-system.watchdog.plist`
- Runtime log: `/tmp/fab-system-watchdog.log`

**Interfaces:**
- Consumes: Tasks 1–4의 health API와 운영 명령
- Produces: 로그인 세션에서 상시 실행되는 FAB 서버

- [ ] **Step 1: 현재 수동 dev 서버 종료**

현재 Codex가 시작한 dev 서버 세션에 `Ctrl-C`를 전달하고 `lsof -nP -iTCP:3000 -sTCP:LISTEN`이
비었는지 확인한다. 다른 사용자의 프로세스는 종료하지 않는다.

- [ ] **Step 2: launchd 설치**

Run: `npm run ops:server:install`  
Expected: plist 생성, `bootstrap` 성공, watchdog 및 Next 서버 기동.

- [ ] **Step 3: 준비 상태 확인**

Run: `npm run ops:server:status`  
Expected: launchd state가 running.

Run: `curl -fsS http://127.0.0.1:3000/api/health/ready`  
Expected: `status=READY`.

- [ ] **Step 4: 자식 프로세스 장애 주입**

`lsof -t -iTCP:3000 -sTCP:LISTEN`으로 정확한 Next PID 하나를 구해 `kill -TERM <PID>`로 종료한다.
watchdog PID나 다른 포트 프로세스는 종료하지 않는다.

Run: 최대 90초 동안 5초 간격으로 ready endpoint 확인.  
Expected: 새 PID가 3000번 포트에 바인딩되고 ready가 다시 200.

- [ ] **Step 5: Twin 심박 회귀 확인**

두 번의 `/api/twin/engine` 응답을 60초 간격으로 읽는다.  
Expected: `status=RUNNING`, 두 번째 `lastTickAt`이 첫 번째보다 최신.

- [ ] **Step 6: 전체 정적 검증**

Run: `npm run test:server-health && npm run test:fab-watchdog && npm run test:fab-launchd && npm run typecheck && npm run lint`  
Expected: exit 0.

