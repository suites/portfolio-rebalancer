# 토스증권 Open API 연동

## 1. 문서 범위

이 문서는 저장소에 고정한 토스증권 공식 OpenAPI와 `packages/broker-toss` 전송 계층의 현재 범위, 안전 경계와 확장 방법을 설명합니다. 제품 유스케이스와 주문 안전성의 최종 기준은 [시스템 명세](SPEC.md)입니다.

기준 자료:

- 공식 base URL: `https://openapi.tossinvest.com`
- [Open API 개요](https://openapi.tossinvest.com/openapi-docs/overview.md)
- [최신 공식 OpenAPI JSON](https://openapi.tossinvest.com/openapi-docs/latest/openapi.json)
- 저장소 고정본: `packages/broker-toss/openapi/openapi.json`
- OpenAPI: `3.1.0`
- API 버전: `1.2.4`
- 확인일: 2026-07-16

`latest` URL은 내용이 바뀔 수 있습니다. 애플리케이션 빌드와 테스트는 네트워크의 최신 문서가 아니라 리뷰를 거쳐 커밋한 고정본을 사용합니다.

실행 시 origin은 `TOSS_OPENAPI_ORIGIN` 상수로 공식 주소에 고정됩니다. 공개 생성자에는 임의 `baseUrl` 주입점이 없으며 테스트 대체는 `fetch` 경계에서만 수행합니다.

## 2. 동기화와 변경 검토

네트워크가 연결된 환경에서 다음 명령을 실행합니다.

```bash
pnpm toss:sync
```

이 명령은 다음 작업을 수행합니다.

1. 공식 `latest/openapi.json`을 다운로드합니다.
2. OpenAPI `3.1.0`, 버전, paths와 operationId의 고유성을 확인합니다.
3. 임시 디렉터리에서 고정 명세, operation 목록과 TypeScript schema를 모두 생성합니다.
4. 생성물을 Prettier로 정규화해 같은 명세의 재동기화 결과가 바뀌지 않게 합니다.
5. 모든 생성 단계가 성공한 뒤 세 파일을 각 대상 경로로 원자적으로 교체합니다.

따라서 다운로드·검증·타입 생성이 실패하면 기존 고정본을 덮어쓰지 않습니다.

생성 파일은 직접 수정하지 않습니다. 동기화 후에는 반드시 다음을 검토합니다.

- 버전과 operation 추가·삭제·method 변경
- 요청·응답의 필수 필드, enum과 decimal 문자열 변경
- 계좌를 변경하는 operation 분류
- 인증, 계좌 헤더와 rate-limit 그룹 변경
- 주문 상태, `clientOrderId`와 오류 계약 변경
- parity 테스트와 `pnpm verify` 결과

명세가 바뀌었다는 이유만으로 자동 반영하거나 배포하지 않습니다. 특히 쓰기 operation 변경은 별도 금융 안전성 리뷰가 필요합니다.

## 3. API 범위

고정 명세에는 총 30개 operation이 있습니다.

| 구분                    | 개수 | 현재 구현                                       |
| ----------------------- | ---: | ----------------------------------------------- |
| OAuth 토큰 발급         |    1 | `TossTokenProvider` 내부 호출                   |
| 조회용 GET business API |   23 | `TossReadApi`의 명시적 메서드                   |
| 계좌 변경 API           |    6 | 타입·명시적 메서드는 있으나 전송 전에 하드 차단 |

operation 표면과 제품에 연결된 기능은 구분합니다. 공식 명세 parity를 위해 `TossTradingApi`에 쓰기 메서드 6개가 존재하지만, `TOSS_TRANSPORT_DESCRIPTOR`는 transport가 제공하는 다음 18개 read-only capability만 설명하며 `orders.write`와 `orders.conditional.write`를 포함하지 않습니다. 중립 어댑터와 실제 계좌 연결은 아직 없으므로 이 목록을 활성 제품 기능으로 해석하지 않습니다.

```text
accounts.read                 holdings.read
market.quotes                 market.orderbook
market.trades                 market.price-limits
market.candles                market.calendar
instruments.read              instruments.warnings
fx.rates                      orders.read
orders.conditional.read       pretrade.buying-power
pretrade.sellable-quantity    pretrade.commissions
rankings.read                 indicators.read
```

태그별 범위:

| 영역                      | 개수 | 주요 기능                              |
| ------------------------- | ---: | -------------------------------------- |
| Market Data               |    5 | 호가, 현재가, 체결, 가격 제한, 캔들    |
| Stock Info                |    2 | 종목 기본 정보, 매수 유의사항          |
| Market Info               |    3 | 환율, 한국·미국 시장 캘린더            |
| Ranking                   |    1 | 종목 랭킹                              |
| Market Indicators         |    3 | 지표 가격·캔들·투자자 매매대금         |
| Account / Asset           |    2 | 계좌 목록, 보유 주식                   |
| Order History             |    2 | 주문 목록·상세                         |
| Conditional Order History |    2 | 조건주문 목록·상세                     |
| Order Info                |    3 | 매수 가능 금액, 매도 가능 수량, 수수료 |
| Order                     |    3 | 일반 주문 생성·정정·취소               |
| Conditional Order         |    3 | 조건주문 생성·수정·취소                |

전체 타입 전송 계층이 있다는 것은 모든 제품 유스케이스가 완성되었다는 뜻이 아닙니다. 현재 계좌·보유자산·KRW·USD 매수 가능 금액과 필요 시 USD/KRW 환율의 실제 read-only 수집, 런타임 검증과 PostgreSQL 저장까지 연결했습니다. 매수 가능 금액은 관리 현금과 분리된 `valuationEligible=false` 증거로만 사용합니다. 다음은 아직 미구현입니다.

- 나머지 조회 API를 `packages/broker`의 중립 모델로 변환하는 어댑터
- 가격 API의 관측 시각을 이용한 주문용 freshness 검증
- 자동 재시도·jitter, 그룹별 client-side limiter와 request ID 감사 저장
- 계획·주문 원장과 PostgreSQL migration 확장
- paper 체결기, 주문 대사와 복구
- live 주문 승인 구성

## 4. 인증

공식 명세는 OAuth 2.0 Client Credentials Grant를 사용합니다.

- 토큰 요청: `POST /oauth2/token`
- 본문: `application/x-www-form-urlencoded`
- 업무 API: `Authorization: Bearer {access_token}`
- refresh token 없음: 만료 시 동일 endpoint에서 다시 발급
- client별 유효 access token은 1개: 새로 발급하면 이전 토큰이 무효화됨
- 허용 IP에 없는 출구 IP는 차단됨

현재 `TossTokenProvider`는 실행 중인 Nest 애플리케이션 프로세스 메모리에만 토큰을 저장하고 만료 30초 전부터 새 토큰을 요구합니다. 동시에 여러 요청이 갱신을 요구해도 single-flight로 발급을 한 번만 수행하며, PostgreSQL collection lease가 여러 Vercel runtime 인스턴스의 동시 수집도 차단합니다. 토큰 요청은 10초 후 중단하고 업무 API에서 `401`을 받으면 캐시 토큰을 즉시 무효화합니다. 영구 캐시나 refresh token은 사용하지 않습니다.

`clientId`, `clientSecret`과 access token은 서버에만 둡니다. HTML, 브라우저 계약, 로그와 fixture에 포함하지 않습니다. 인증 오류 메시지에 자격증명이 포함돼도 알려진 자격증명 값을 `[REDACTED]`로 바꾸는 회귀 테스트가 있습니다. 전체 로그·응답 마스킹은 향후 공통 오류 계층에서 추가 검증해야 합니다.

## 5. 데이터와 오류 규칙

- 토스 명세의 가격, 금액과 수량은 주로 decimal 문자열입니다. 도메인 진입 전 명시적인 scale을 적용해 `bigint`로 변환하고 JavaScript `number`로 금융 계산하지 않습니다.
- 모든 날짜·시간은 offset 또는 명시적인 시장 timezone과 함께 정규화합니다.
- `X-Tossinvest-Account`에는 계좌 목록에서 받은 account sequence를 사용합니다. 전체 계좌번호를 애플리케이션 로그에 남기지 않습니다.
- `buying power`는 주문 가능성 검증용이며 포트폴리오 평가용 현금의 source of truth가 아닙니다.
- 필수 데이터 누락, 알 수 없는 enum, 오래된 시세와 계좌 불일치는 성공으로 보정하지 않고 차단합니다.
- openapi-fetch의 정적 타입만으로 외부 응답이 런타임에 올바르다고 간주하지 않습니다. 중립 어댑터 구현 시 경계 검증을 추가합니다.

모든 Toss 요청은 기본 10초 timeout을 공유합니다. timeout과 네트워크 실패는 각각 `TOSS_API_TIMEOUT`, `TOSS_API_NETWORK_FAILED`로 변환하며 upstream 오류 본문을 메시지에 포함하지 않습니다. 비정상 HTTP 응답은 `TOSS_API_RESPONSE_ERROR`로 정규화하고 인증·권한, 요청 한도, 서버 실패에 맞는 한국어 보호 조치를 제공합니다.

`429`에서는 다음 헤더를 안전 오류의 메타데이터로 추출합니다.

- `retry-after`: 0 이상의 정수 초일 때 `retryAfterSeconds`
- `x-ratelimit-group`: `rateLimitGroup`
- `x-request-id` 또는 `x-toss-request-id`: `requestId`

실제 응답에서 이 헤더가 항상 제공되는지는 read-only 표본으로 확인하기 전까지 `[확인 필요]`입니다. 현재 값은 관측과 다음 행동 안내를 위한 메타데이터일 뿐 자동 대기나 재요청을 수행하지 않습니다. 자동 retry·jitter와 그룹별 limiter는 미구현이며 쓰기 요청은 일반 재시도 대상이 아닙니다.

## 6. 주문 안전 경계

토스증권에는 확인된 별도 sandbox/paper 주문 서버가 없습니다. 현재 기본 모드와 Web GUI는 실제 조회 데이터를 사용하는 읽기 전용 `shadow`이며, `TossTradingApi`는 다음 6개 operation의 타입과 명시적 메서드를 노출하되 `TOSS_LIVE_TRADING_DISABLED` 오류로 네트워크 요청 전에 무조건 차단합니다. 안전한 executor와 ledger가 설계되기 전에는 이 차단을 해제하는 경로가 전혀 없습니다.

- 일반 주문 생성, 정정, 취소
- 조건주문 생성, 수정, 취소

현재는 live authorization 입력이나 활성화 구성이 존재하지 않습니다. 활성화 경로를 설계하기 전 최소한 다음 조건이 필요합니다.

- 저장된 계획과 `logical_order_id` UNIQUE 원장
- 결정적인 `clientOrderId`와 재시작 대사
- 계좌 허용 목록, 주문별·일별 한도와 킬 스위치
- 최신 시세·잔고·미체결 주문·매수/매도 가능성 재검사
- 만료되는 수동 승인과 명시적인 live 모드 다중 조건
- 부분체결, 정정, 취소, timeout과 `UNKNOWN_BLOCKED` 복구
- 독립 코드 리뷰, 소액 검증과 운영 런북

공식 명세상 일반 주문의 `clientOrderId`는 최대 36자이며 서버 멱등성 유효 시간은 10분입니다. 이 값은 보조 방어선일 뿐입니다. 10분 뒤에도 결과가 불명확하면 자동 재제출하지 않습니다. 정정·취소와 조건주문의 실계좌 멱등성 동작은 fixture와 read-only 대사만으로 확정할 수 없으므로 `[확인 필요]`이며, 확인 전 자동 재시도하지 않습니다.

## 7. 다른 증권사 추가

증권사 확장은 공식 SDK나 path를 애플리케이션에 직접 주입하는 방식이 아닙니다.

1. 별도 패키지 `packages/broker-{id}`를 만듭니다.
2. 지원 기능을 `BrokerDescriptor.capabilities`에 선언합니다.
3. 계좌, 보유자산, 시세, 호가, 종목, 캘린더, 일반·조건주문과 pretrade 조회의 좁은 포트를 구현합니다.
4. 원본 decimal, 시장, 통화, 시간과 주문 상태를 중립 모델로 명시적으로 변환합니다.
5. 지원하지 않는 기능은 가짜 값으로 채우지 않고 capability unavailable로 차단합니다.
6. 원본 응답과 정규화 모델의 fixture·계약 테스트를 추가합니다.
7. 쓰기 기능은 해당 증권사의 안전한 executor와 원장·멱등성·복구 검토를 통과해야 합니다.

애플리케이션은 필요한 capability를 먼저 검사합니다. 예를 들어 `orders.write` 또는 `pretrade.sellable-quantity`가 없는 증권사는 조회 화면에는 사용할 수 있어도 주문 계획 실행에는 사용할 수 없습니다.

## 8. 현재 engine 및 Web API

NestJS 11 engine은 Fastify adapter로 다음 내부 route를 제공합니다. dashboard와 refresh는 `ENGINE_SERVICE_TOKEN` Guard, Cron은 별도 `CRON_SECRET` Guard로 보호합니다.

- `GET /internal/v1/health`
- `GET /internal/v1/dashboard`
- `POST /internal/v1/portfolio/refresh`
- `GET /internal/v1/cron/portfolio`: Vercel Cron, 평일 00:00 UTC/09:00 KST

Web BFF는 다음 route를 제공합니다.

- `GET /api/v1/system/health`: 서버 상태, 기본 paper 모드, live 비활성 여부
- `GET /api/v1/brokers`: 실제 engine 연결, 마지막 관측 시각과 read-only adapter 상태

Web route는 주문을 생성하거나 브라우저에 engine 비밀정보를 전달하지 않습니다. 첫 화면은 저장된 스냅샷이 없을 때만 engine refresh를 호출하며 결과를 `DashboardSnapshotSchema`로 검증합니다.

Vercel의 기본 출구 IP는 동적입니다. Production engine은 Pro Static IPs 또는 Enterprise Secure Compute를 활성화하고 해당 IP를 토스증권에 allowlist한 뒤 `TOSS_EGRESS_ALLOWLIST_CONFIRMED=true`를 설정해야 합니다. Preview에는 운영 토스 자격증명을 주입하지 않습니다.

## 9. 검증

현재 자동 테스트는 다음 계약을 확인합니다.

- 고정 버전 `1.2.4`, operation 30개, GET 23개, 계좌 변경 6개
- manifest의 모든 business operation과 명시적 클라이언트 메서드의 parity
- transport descriptor가 read-only capability만 설명하고 write capability를 제외하는지
- 쓰기 호출이 `TOSS_LIVE_TRADING_DISABLED`로 fetch 전에 하드 차단되는지
- 동시 토큰 요청이 한 번만 발급되는지
- 공식 origin만 사용하고 비어 있거나 비정상인 토큰 응답을 거부하는지
- 공통 request timeout이 안전 오류로 변환되는지
- `429`의 retry, rate-limit group과 request ID 메타데이터를 추출하는지
- `401` 이후 캐시 토큰을 무효화하고 다음 호출에서 다시 발급하는지
- 인증 오류가 자격증명을 노출하지 않는지
- JSON이 아닌 인증 오류도 안전한 도메인 오류로 변환되는지

전체 명령:

```bash
pnpm verify
```
