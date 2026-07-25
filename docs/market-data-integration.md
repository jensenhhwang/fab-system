# 시장·수요 데이터 연동

시장 화면은 외부 API를 직접 기다리지 않는다. MongoDB에 저장된 최신 관측값을 즉시 반환하고, 데이터가 없거나 수집 SLA를 넘겼을 때 Next.js `after()` 작업으로 수집을 시작한다. 화면은 `/api/market-data`를 60초마다 다시 조회한다.

## 현재 연결

| 소스 | 수집 데이터 | 수집 판단 주기 | 인증 |
| --- | --- | --- | --- |
| TWSE OpenAPI | TSMC·Hon Hai·Quanta·Wistron·Wiwynn 월매출, MoM, YoY | 1시간 중복 방지, 성공 후 36시간까지 FRESH | 불필요 |
| SEC EDGAR | NVIDIA·Micron·AMD·Microsoft·Meta·Amazon의 10-K/10-Q/8-K | 15분 중복 방지, 성공 후 45분까지 FRESH | API 키는 없지만 식별 가능한 User-Agent 필수 |

가격·시장점유율·기존 선행지표는 유료 데이터 계약 전 기준값이므로 화면과 API에서 `DEMO`로 표시한다. 데모 기준일은 고정되어 있으며 화면을 열 때마다 현재 시각으로 위장하지 않는다.

## 환경변수

```text
MARKET_DATA_CONTACT_EMAIL=운영담당자@example.com
MARKET_COLLECTOR_SECRET=충분히-긴-임의-문자열
TWSE_TRACKED_CODES=2330,2317,2382,3231,6669
```

`MARKET_DATA_CONTACT_EMAIL`이 없으면 SEC 호출은 규정 준수를 위해 실행되지 않고 `DISABLED`가 표시된다.

## 운영 스케줄러

화면 접근 시 stale-while-refresh가 동작하므로 별도 스케줄러가 없어도 갱신된다. 사용자 접속과 무관하게 계속 수집하려면 15분마다 아래 요청을 실행한다.

```bash
curl -X POST \
  -H "Authorization: Bearer $MARKET_COLLECTOR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"source":"ALL"}' \
  https://서비스주소/api/market-data/collect
```

관리자 로그인 세션으로도 수동 실행할 수 있다. 비밀값은 URL 쿼리에 넣지 않는다.

## 저장 모델

- `marketSources`: 소스별 상태, 최근 시도·성공 시각, 오류
- `marketIngestionRuns`: 시간창별 실행 잠금과 수집 결과
- `marketRawArtifacts`: 원문 응답과 SHA-256
- `marketObservations`: 관측 기간, 발표 시각, 수집 시각, revision을 분리한 정규화 값

따라서 “실시간”은 원천이 발표한 값을 수집 SLA 안에 자동 반영한다는 뜻이다. 월매출 자체가 매초 바뀌는 값처럼 표시되지는 않는다.
