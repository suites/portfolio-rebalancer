# API 경계 명세

## 내부 Web API

현재 구현된 route는 읽기 전용입니다.

| Method | Path                    | 역할                                                                     | 외부 호출 |
| ------ | ----------------------- | ------------------------------------------------------------------------ | --------- |
| GET    | `/api/v1/system/health` | 상태, paper 기본값, 합성 데이터·미연결·live 비활성 상태                  | 없음      |
| GET    | `/api/v1/brokers`       | Toss 고정 버전, operation 수, transport-only·미연결·read capability 상태 | 없음      |

대시보드 데이터는 현재 route fetch가 아니라 Next.js server component 조합에서 합성 fixture를 애플리케이션 서비스에 전달하고 Zod로 검증합니다.

## 외부 Toss API

- OpenAPI `3.1.0`, API `1.2.4`
- 총 30 operations: OAuth 1, GET business 23, 계좌 변경 6
- 고정 스키마: `packages/broker-toss/openapi/openapi.json`
- 생성 타입: `packages/broker-toss/src/generated/schema.ts`
- operation manifest: `packages/broker-toss/src/generated/operations.ts`

origin은 공식 주소로 고정되고 모든 요청에 기본 10초 timeout을 적용합니다. timeout·네트워크 실패와 비정상 HTTP를 안전 오류로 정규화하며, `401`은 토큰을 무효화하고 `429`는 retry·rate-limit group·request ID 메타데이터를 추출합니다. 자동 재시도, 그룹별 limiter, 중립 모델 변환, 런타임 응답 검증과 pagination은 미구현입니다.

조회 메서드는 타입 안전한 raw transport 표면입니다. Toss transport descriptor는 18개 read-only capability만 설명합니다. 중립 어댑터와 실제 계좌 연결은 없습니다. 공식 parity용 계좌 변경 6개 메서드는 descriptor의 write capability가 아니며 모두 `TOSS_LIVE_TRADING_DISABLED`로 fetch 전에 차단합니다.

자세한 내용은 `docs/API_TOSS.md`를 따릅니다.
