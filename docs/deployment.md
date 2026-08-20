# 배포와 엔진 상시 가동

## 왜 Vercel Cron을 쓰지 않는가

`vercel.json`에 분 단위 cron(`* * * * *`)을 넣고 배포하면 Hobby 플랜에서 거부된다.

```
Hobby accounts are limited to daily cron jobs.
This cron expression (* * * * *) would run more than once per day.
```

Hobby가 허용하는 하루 1회는 tick으로 쓸 수 없다. 운영시계에 catch-up 상한
(`OPERATING_CATCH_UP_LIMIT_MS` = 운영 1일)이 있어서, 하루에 한 번 부르면 운영시간도
하루에 1일만 흐른다 — 24배속이 아니라 1배속이 된다.

그래서 스케줄링은 **Vercel 밖**에 둔다.

## 엔진을 돌리는 방법

엔진은 `GET|POST /api/twin/tick`으로 한 번씩 전진한다. 인증은
`Authorization: Bearer $CRON_SECRET`이고, `CRON_SECRET`이 없는 배포에서는 503으로 닫힌다
(tick은 재고를 깎고 발주를 내보내는 쓰기 작업이라 공개되면 안 된다).

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<배포주소>/api/twin/tick
```

호출 간격은 자유롭다. **운영시계가 tick 횟수가 아니라 벽시계 경과 × 24로 흐르기**
때문이다(RULES.md § Twin 운영시간). 5초로 부르든 5분으로 부르든 운영시간은 같은 속도로
간다 — 간격이 벌어지면 시간이 아니라 **해상도**만 굵어진다(WIP이 더 큰 덩어리로 진행).

동시 호출은 안전하다. Mongo 락이 겹침을 막고 뒤늦은 쪽은 `skipped: "LOCKED"`로 돌아간다.

| 스케줄러 | 최소 간격 | 비고 |
|---|---|---|
| 외부 cron 서비스(cron-job.org 등) | 1분 | Hobby에서 가장 실용적 |
| GitHub Actions `schedule` | 5분 | 무료, 저장소에 붙어 있음. 실행이 지연될 수 있음(best-effort) |
| Vercel Cron | 1분 | **Pro 필요** — 그때는 `vercel.json`에 `crons`를 되살린다 |
| 상시 가동 워커 | 5초 | 가장 좋은 해상도. `engine.ts`의 `server-only` 의존을 끊어야 가능 |

## 환경변수

Vercel 프로젝트에 등록되어 있어야 한다.

| 이름 | 용도 |
|---|---|
| `DATABASE_URL` | MongoDB 접속 |
| `AUTH_SECRET` | NextAuth 세션 |
| `CRON_SECRET` | tick 엔드포인트 인증 |
| `GROQ_API_KEY` | 관제탑 AI |
| `OPENAI_API_KEY` | 관제탑 AI (미등록 시 해당 기능만 비활성) |

## 배포

Git 연동이 걸려 있지 않아 푸시로는 배포되지 않는다. CLI로 올린다.

```bash
npx vercel          # Preview
npx vercel --prod   # Production
```
