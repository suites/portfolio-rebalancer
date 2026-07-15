# 통합·계약 테스트 기록

## Toss 전송 계약

- 고정 버전 `1.2.4`
- 총 30 operations
- GET business 23, 계좌 변경 6
- 모든 business operation과 `TossReadApi`/`TossTradingApi` 명시적 메서드 parity
- Toss transport descriptor의 대표 read-only capability와 write capability 미제공
- 6개 계좌 변경 메서드가 네트워크 전에 `TOSS_LIVE_TRADING_DISABLED`로 거부
- request timeout이 `TOSS_API_TIMEOUT`으로 변환
- `429`의 retry/rate-limit/request ID 메타데이터 추출
- `401` 이후 token cache 무효화와 다음 호출 재발급

## Web route

`GET /api/v1/system/health` handler가 다음 안전 기본값을 반환하는지 확인합니다.

- `status: ok`
- `mode: paper`
- `liveOrdersEnabled: false`

`GET /api/v1/brokers` route 함수 계약도 transport-only·미연결·live 비활성 상태를 검증합니다. 실제 HTTP 서버 통합 테스트와 자동 브라우저 E2E는 아직 없습니다.
