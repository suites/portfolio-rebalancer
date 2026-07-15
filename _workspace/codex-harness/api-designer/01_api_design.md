# API 설계

## 두 경계

### 1. 외부 Toss transport

공식 OpenAPI `1.2.4`를 고정하고 `openapi-typescript`로 요청·응답 타입을 생성합니다. origin은 공식 주소 상수로 고정합니다. `TossReadApi`는 GET business operation 23개를 명시적 메서드로 제공합니다. OAuth 발급은 `TossTokenProvider`가 담당합니다. 계좌 변경 operation 6개는 타입 표면만 유지하고 무조건 차단합니다.

전송 계층은 공통 10초 timeout, 네트워크·HTTP 안전 오류, `401` 토큰 무효화와 `429` retry/rate-limit/request ID 메타데이터 추출을 제공합니다. 자동 재시도나 그룹별 limiter는 없습니다.

이 계층은 토스의 path, header, pagination과 DTO를 소유합니다. 애플리케이션 유스케이스에서 직접 사용하지 않고 향후 중립 adapter가 감쌉니다.

### 2. 내부 제품 경계

`packages/broker`는 기능을 다음처럼 capability로 표현합니다.

- accounts/holdings/general·conditional orders read
- quotes/orderbook/calendar/instruments와 시장 데이터
- pretrade buying power/sellable quantity/commissions
- orders write와 conditional write는 parity용 메서드에만 있고 Toss transport capability에서는 제외

각 capability는 좁은 포트로 구현합니다. 지원하지 않는 기능은 필드를 `null`로 위조하지 않고 `BROKER_CAPABILITY_UNAVAILABLE`로 차단합니다.

현재 Web route는 `/api/v1/system/health`, `/api/v1/brokers` 두 GET뿐입니다. 대시보드 계약은 server component 조합에서 Zod로 검증합니다.

## 버전과 오류

- 내부 API는 `/api/v1` path version을 사용합니다.
- 외부 Toss 버전은 고정 schema 버전으로 추적합니다.
- 현재 보장 오류: `BROKER_CAPABILITY_UNAVAILABLE`, `TOSS_AUTHENTICATION_FAILED`, `TOSS_API_TIMEOUT`, `TOSS_API_NETWORK_FAILED`, `TOSS_API_RESPONSE_ERROR`, `TOSS_LIVE_TRADING_DISABLED`.
- 외부 오류는 안전한 공통 class와 메타데이터로 정규화되지만 BFF 공통 JSON 오류 envelope은 아직 미구현입니다.
