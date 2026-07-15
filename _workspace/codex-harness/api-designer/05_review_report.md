# API 리뷰 보고서

## 적합

- 외부 canonical schema와 내부 제품 계약이 분리되어 있습니다.
- 30개 operation 누락을 parity 테스트로 감지합니다.
- OAuth 동시 발급과 자격증명 오류 노출을 테스트합니다.
- 고정 origin, 공통 timeout, 안전 오류와 `401`/`429` 메타데이터를 구현했습니다.
- Toss transport descriptor는 18개 read-only capability만 설명하고 write capability를 제외합니다.
- 계좌 변경 메서드는 활성화 주입점 없이 `TOSS_LIVE_TRADING_DISABLED`로 무조건 차단됩니다.

## 필수 후속

- Toss 응답의 runtime 검증과 중립 adapter
- rate limit 그룹별 limiter와 read-only retry 정책
- request ID 감사 저장과 BFF 공통 JSON 오류 envelope
- pagination과 freshness 계약
- 원장·멱등성·한도·복구가 있는 executor 설계

## 결론

현재 구현은 공식 API 전체의 타입 안전한 전송 기반과 읽기 전용 BFF 상태 route로는 일관됩니다. 실제 계좌 연동 또는 주문 가능한 API로 평가해서는 안 됩니다. DB와 safe executor가 없으므로 쓰기 활성화 경로를 추가하지 않는 것이 필수입니다.
