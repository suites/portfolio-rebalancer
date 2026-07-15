# Mock과 계약 테스트

## 구현된 테스트

- fetch mock으로 OAuth single-flight 확인
- 합성 token response와 인증 실패 처리
- 오류 payload의 client ID/secret 마스킹
- JSON이 아닌 인증 오류의 안전한 변환
- Toss operation manifest와 client method parity
- Toss transport descriptor의 read-only capability와 write capability 미제공
- 계좌 변경 메서드가 fetch 전에 `TOSS_LIVE_TRADING_DISABLED`로 거부되는지 확인
- 고정 origin과 비정상 token 응답 거부
- 공통 request timeout의 안전 오류
- `429` retry/rate-limit/request ID 메타데이터
- `401` 뒤 token 캐시 폐기와 재발급
- health route response 계약
- dashboard Zod 계약의 basis point 범위

실제 API 응답과 계좌 식별자는 fixture로 커밋하지 않았습니다.

## 후속 mock 시나리오

- GET 23개 operation의 합성 success/error fixture
- 누락 field, 알 수 없는 enum과 잘못된 decimal 문자열
- pagination 첫/중간/마지막 page
- 네트워크 실패, 403 허용 IP와 5xx 세부 회귀
- 중립 모델 변환과 timezone
- buying power를 평가 현금으로 사용하지 않는 차단

쓰기 endpoint의 성공 mock은 안전 executor/ledger 설계와 별도 리뷰 전에는 제품 실행 경로를 만들지 않습니다.
