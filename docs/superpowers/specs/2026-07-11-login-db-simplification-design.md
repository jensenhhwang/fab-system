# 로그인 · DB/서버 경량화 설계 스펙

- **작성일**: 2026-07-11
- **작성자**: Claude (자율 작성 — 황지훈 부재 중, `/brainstorming` 방법론 적용)
- **상태**: 초안 — 사용자 검토·승인 대기 (구현 착수 전)
- **배경 세션**: Vercel 로그인 3시간+ 디버깅 → "DB/서버가 과하게 복잡한 것 아닌가, SQLite/MongoDB로 가볍게 못 가나" 검토 요청

> ⚠️ 이 문서는 **스펙(설계)까지만**입니다. 실제 마이그레이션 구현은 사용자 승인 후 별도 계획(writing-plans)으로 진행합니다.

---

## 1. 문제 정의

### 1.1 현재 로그인이 실패하는 진짜 원인 (확정)

Vercel 프로덕션에서 로그인 시 `authorize()`가 예외 → NextAuth `Configuration` 에러.
Vercel 함수 로그로 확인된 근본 원인:

```
CallbackRouteError
 └ DriverAdapterError: SERVER_ERROR: Server returned HTTP status 400
    (@prisma/adapter-libsql/web → @libsql/client/web → globalThis.fetch)
```

- 로컬에서 **동일한 URL·토큰·쿼리를 curl로 직접** 때리면 → **200 정상**.
- 차이는 단 하나: **Next.js가 `globalThis.fetch`를 자기 캐시 레이어로 패치**한다는 것.
  `@libsql/client/web`는 `fetch(Request객체)` 형태로 호출하는데, Next의 패치 로직
  (`next/dist/server/lib/patch-fetch.js:611-621`)이 Request를 `new Request(url, { body })`로
  재조립하면서 libsql이 넣은 **바이트 배열 바디를 손상**시킴 → Turso가 400 반환.
- Request를 문자열 URL+ArrayBuffer로 풀어 넘기는 우회도 시도했으나 **여전히 400**.
  → 이 조합(`Turso libsql-over-HTTP + Prisma 어댑터 + Next.js 패치 fetch`)은 **구조적으로 취약**.

**핵심 통찰: 이 버그는 "HTTP fetch를 쓰는 DB 드라이버"에서만 발생한다.
TCP 소켓 기반 드라이버(예: MongoDB 네이티브 드라이버, Prisma의 MongoDB/Postgres 엔진)는
Next.js가 fetch를 패치해도 영향받지 않으므로 이 버그 클래스가 통째로 사라진다.**

### 1.2 현재 스택의 복잡도 (정량)

| 항목 | 현재 |
|---|---|
| ORM | Prisma 7 (adapter 패턴, 코드 생성 필요) |
| DB(운영) | Turso = libsql, HTTP fetch 기반 SQLite |
| DB 드라이버 | `@prisma/adapter-libsql/web`(운영) + `@prisma/adapter-better-sqlite3`(로컬) **이중 분기** |
| 인증 | NextAuth v5(beta) credentials + JWT |
| 빌드 | `prisma generate && next build` (생성물 792K, `postinstall`도 generate) |
| DB/인증 코드 | `db.ts`·`auth.ts`·`auth.config.ts`·`proxy.ts` + `schema.prisma`(180줄) + `seed.ts`(463줄) = **795줄** |
| 관련 npm 의존성 | prisma, @prisma/client, @prisma/adapter-libsql, @prisma/adapter-better-sqlite3, @libsql/client, better-sqlite3, @types/better-sqlite3 (**7종**) |
| 쿼리 사용처 | 8개 파일, **~20개 호출** (거의 전부 `findMany` 읽기, 쓰기는 위키 생성·로그인 조회 **단 2곳**) |

→ **읽기 위주(reference data)** 앱인데, 운영 DB 드라이버 계층이 과도하게 무겁고 취약함.

### 1.3 "그냥 SQLite 쓰면 안 되나?"에 대한 답 (중요)

> **안 된다.** Vercel 서버리스 함수의 파일시스템은 **읽기 전용·휘발성·인스턴스별 격리**라
> 로컬 `dev.db` 같은 **파일 SQLite는 쓰기·영속화가 불가능**하다.
> "서버리스에서 SQLite"는 사실상 **Turso(네트워크 SQLite)를 의미**하고, Turso는 HTTP fetch
> 기반이라 위 1.1의 버그를 유발한다. 즉 *"SQLite로 가볍게"*는 Vercel 배포에서는 성립하지 않는다.

Vercel에서 실제로 동작하는 선택지는 **네트워크 DB뿐**:
Turso(fetch·취약) / Postgres(Neon·Vercel Postgres) / MySQL(PlanetScale) / **MongoDB Atlas(TCP)**.

---

## 2. 목표 / 비목표

**목표**
- 로그인이 Vercel에서 **안정적으로** 동작 (fetch-패치 버그 클래스 제거).
- DB/서버 계층을 **더 가볍고 이해하기 쉽게** (공부용 프로젝트에 적합한 명료함).
- 향후 계정·데이터 증가에도 동일 버그 재발 없음.

**비목표**
- 앱 기능(대시보드·재고·사용량·위키 등) 변경 — 데이터 접근 계층만 교체.
- 대규모 트래픽·고가용성 최적화 (study 프로젝트 수준이면 충분).
- 인증 방식 자체(NextAuth credentials+JWT)는 유지 — 문제는 인증이 아니라 **DB 드라이버**.

**성공 기준**
1. `admin@fab.skh / fab1234!` 로 Vercel에서 로그인 → 대시보드 진입.
2. Playwright 로그인 스위트 그린.
3. 빌드에서 `prisma generate`(선택지에 따라) 또는 이중 어댑터 분기 제거.
4. 로컬·운영이 **동일 코드 경로**(환경별 어댑터 분기 없음).

---

## 3. 대안 분석 (3안)

### A안 — Prisma + MongoDB Atlas  ⭐ **추천**
Prisma는 유지하되 datasource를 **MongoDB**로 교체. Turso·libsql·better-sqlite3 어댑터 전부 제거.
- **버그 제거**: Prisma의 MongoDB 커넥터는 **TCP 기반**(fetch 아님) → 1.1 버그 원천 차단.
- **리팩터 최소**: `db.user.findUnique(...)` 등 **~20개 호출 대부분 그대로** 유지.
- **타입 안전 유지**: 생성 클라이언트 타입 그대로.
- 비용: `prisma generate` 빌드 단계는 **남음**. schema의 `id`를 `@map("_id") @db.ObjectId`로 조정 필요. `@@unique`·관계는 Mongo 방식으로 소폭 조정.

### B안 — 네이티브 `mongodb` 드라이버 (Prisma 완전 제거)
Prisma·생성물·어댑터 전부 삭제. 얇은 타입드 데이터 접근 계층(`src/lib/collections.ts`)로 대체.
- **가장 가벼운 최종 형태**: `prisma generate` 없음, 의존성 7종 → 1종(`mongodb`), 생성물 792K 삭제.
- **버그 제거**: 동일하게 TCP.
- 비용: **~20개 호출 전부 재작성** + `include`(조인)를 `$lookup` 집계나 코드 조인으로 변환.
  타입 안전은 수동(TS 타입/Zod). 지금 당장 작업량 가장 큼.

### C안 — Neon(서버리스 Postgres) + Prisma (SQL 유지)
관계형을 유지하고 싶을 때. Vercel의 정석 경로.
- SQL·조인 그대로, Prisma DX 유지.
- 비용: Neon 서버리스 드라이버는 **다시 HTTP/fetch 계열**이라 1.1과 **유사 위험 잠재**
  (Neon 어댑터는 Vercel에 최적화돼 있어 실사용은 되지만, 이번에 데인 fetch 계층을 또 씀).
  "가볍게"라는 요청과는 방향이 다름.

### 비교표

| 기준 | A: Prisma+Mongo ⭐ | B: 네이티브 Mongo | C: Neon+Prisma |
|---|---|---|---|
| 1.1 fetch 버그 제거 | ✅ (TCP) | ✅ (TCP) | ⚠️ (fetch 계열) |
| 지금 리팩터 작업량 | **작음** | 큼 | 중간 |
| 최종 경량성 | 중간(generate 남음) | **최상** | 중간 |
| 타입 안전 | ✅ 자동 | 수동 | ✅ 자동 |
| 관계/조인 | 문서모델 조정 | 수동 조인 | **SQL 그대로** |
| 학습 가치(포트폴리오) | Mongo+Prisma | Mongo 원리 | 정통 SQL |

---

## 4. 추천 및 근거

### 추천: **A안 (Prisma + MongoDB Atlas)** — 단, "완전 경량화"를 원하면 B안.

**이유**
1. **버그를 확실히 죽인다.** 이번 3시간을 태운 원인은 fetch 패치. Mongo는 TCP라 재발 불가.
2. **위험 대비 작업량이 가장 좋다.** 쿼리 호출부 ~20곳을 거의 손대지 않고, 타입 안전도 유지.
   "또 뭔가 깨지는" 리스크가 가장 낮음 — 지금 사용자에게 가장 중요한 가치.
3. **MongoDB Atlas 무료 티어**로 셋업 간단, Vercel에서 커넥션 재사용 패턴이 정립돼 있음.
4. 데이터가 대부분 **읽기 전용 레퍼런스**(자재·창고·공정사용) → 문서 모델이 잘 맞음.

**B안을 고르는 경우**: "`prisma generate`·생성물·어댑터까지 전부 걷어낸 진짜 미니멀"을 원하고,
쿼리 재작성 작업량을 감수할 때. 학습 목적상 "드라이버 원리까지 직접" 보고 싶다면 B가 더 교육적.

> 사용자 확인 필요 (open question Q1): **A(안전·빠름) vs B(최경량·작업 많음)** 중 택1.

---

## 5. 상세 설계 (A안 기준)

### 5.1 아키텍처 변경 요약
```
[변경 전]  authorize() → Prisma(db) → @prisma/adapter-libsql/web → fetch(패치됨) → Turso ❌400
[변경 후]  authorize() → Prisma(db) → Mongo 커넥터(TCP) → MongoDB Atlas ✅
```
- 삭제: `@prisma/adapter-libsql`, `@prisma/adapter-libsql/web`, `@prisma/adapter-better-sqlite3`,
  `@libsql/client`, `better-sqlite3`, `@types/better-sqlite3`, Turso 관련 env 3종.
- `src/lib/db.ts`의 **환경별 어댑터 분기 제거** → 단일 `new PrismaClient()` + 글로벌 캐시.
- 로컬 개발도 동일하게 Atlas(또는 로컬 mongod) 사용 → **로컬=운영 코드 경로 일치**.

### 5.2 데이터 접근 계층 (`src/lib/db.ts`)
```ts
import { PrismaClient } from "@/generated/prisma/client";
const g = globalThis as unknown as { prisma?: PrismaClient };
export const db = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = db;
```
- 어댑터·fetch·경로 분기 전부 사라짐. (커넥션 재사용은 Prisma가 내부 처리 + 글로벌 캐시로 콜드스타트 완화.)

### 5.3 스키마 조정 (`prisma/schema.prisma`)
- `datasource db { provider = "mongodb"; url = env("DATABASE_URL") }`
- 각 모델 PK: `id String @id @default(auto()) @map("_id") @db.ObjectId`
- 외래키 필드도 `@db.ObjectId`. `@@unique([...])`는 유지(복합 인덱스).
- enum(Role/Category/TxType/RiskLevel/Product)은 Mongo에서도 지원 → 유지.
- 관계는 Prisma가 참조 방식으로 처리(문서 임베드 아님) → 기존 `include` 대부분 그대로 동작.

### 5.4 인증 (변경 없음)
- `auth.ts`의 `authorize()`는 `db.user.findUnique` + `bcrypt.compare` 그대로.
- `auth.config.ts`의 `trustHost: true` 유지 (Vercel 프록시 필수).
- `proxy.ts`(Next 16 미들웨어) 유지.

### 5.5 시드 (`prisma/seed.ts`)
- 어댑터 분기 제거, `new PrismaClient()` 하나로 Atlas에 upsert.
- 데이터 정의(자재 47종·창고 4·공정사용 48·재고 등)는 **그대로 재사용**.
- 실행: `dotenv -e .env -- tsx prisma/seed.ts` (기존과 동일 패턴).

### 5.6 환경변수
- 추가: `DATABASE_URL="mongodb+srv://<user>:<pw>@<cluster>/fab?retryWrites=true&w=majority"`
- 제거: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (로컬 `.env` + Vercel 양쪽).
- 유지: `AUTH_SECRET`, `GROQ_API_KEY`.

### 5.7 에러 처리
- `authorize()`는 이미 실패 시 `null` 반환/예외를 NextAuth가 처리. Mongo 연결 실패 시에도
  동일하게 `Configuration` 대신 정상적인 "인증 실패" 흐름을 타도록, `authorize` 내부
  DB 호출을 try/catch로 감싸 예외를 로깅하고 `null` 반환하도록 보강(선택).

### 5.8 테스트
- `tests/e2e/auth.spec.ts`(기존 15개) 재사용. 마이그레이션 후 Vercel 대상 그린 확인.
- 추가: `/api/healthz` 같은 경량 헬스체크(운영 DB 연결 확인)로 배포 직후 스모크 — 선택.

---

## 6. 마이그레이션 계획(요약, 상세는 승인 후 writing-plans)

1. MongoDB Atlas 무료 클러스터 생성 → `DATABASE_URL` 확보 (사용자 작업, 안내 제공).
2. `schema.prisma` provider·id·ObjectId 조정 → `prisma generate`.
3. `db.ts`·`seed.ts` 어댑터 분기 제거.
4. 의존성 정리(제거 6종) + `.env`/Vercel env 정리.
5. `tsx prisma/seed.ts`로 Atlas 시드.
6. 로컬 로그인 확인 → Vercel 배포 → Playwright 그린.
7. 임시 진단 라우트(`/api/diagx`) 삭제, Turso DB 폐기.

**예상 작업량(A안)**: 반나절 이내(스키마·시드·env 조정 위주, 쿼리 호출부는 대부분 무변경).
**예상 작업량(B안)**: 1~1.5일(쿼리 ~20곳 재작성 + 조인 변환 + 타입).

---

## 7. 리스크 & 완화

| 리스크 | 완화 |
|---|---|
| Prisma+Mongo가 Vercel 콜드스타트에서 느릴 수 있음 | 글로벌 클라이언트 캐시, Atlas 리전=Vercel 리전 근접(ap-northeast) |
| Mongo 커넥션 수 폭증(서버리스) | Atlas는 서버리스에 관대, 글로벌 캐시로 재사용. 필요 시 `directConnection`/pool 튜닝 |
| enum·복합 unique의 Mongo 제약 | Prisma가 인덱스로 처리, 시드 upsert 키 재확인 |
| 관계 `include` 동작 차이 | 마이그레이션 후 각 페이지(대시보드·재고·사용량) 스모크 |

---

## 8. 미해결 질문 (사용자 확인 필요)

- **Q1. 방향**: A안(Prisma+Mongo, 안전·빠름) vs B안(네이티브 Mongo, 최경량·작업 많음)? → *추천: A*
- **Q2. Atlas vs 로컬 mongod**: 개발도 Atlas 단일로 갈지, 로컬 mongod 병행할지? → *추천: Atlas 단일(코드 경로 일치)*
- **Q3. 진행 시점**: 지금 진행 중인 **3D 창고·배관 기능**을 먼저 마무리·배포하고 나서 DB 마이그레이션을 별도 브랜치로 진행할지? → *추천: 3D 먼저 머지 → DB 마이그레이션 별도 진행*

---

## 부록 A — 이번에 확정한 사실(디버깅 로그 근거)
- Vercel 함수 로그: `DriverAdapterError: SERVER_ERROR: Server returned HTTP status 400`.
- 로컬 curl(동일 토큰/URL) → `v2/pipeline`·`v3/pipeline` 모두 200.
- Turso DB 데이터 정상(유저 4명, `admin@fab.skh` 존재, bcrypt 해시 60자).
- Next `patch-fetch.js`가 Request 바디를 재조립 → libsql 바이트 바디 손상 → 400.
- `trustHost: true`·`/web` 어댑터·Request 언랩 우회 모두 적용했으나 400 지속 → **fetch 계층 탈출이 정답**.
