# 스키마 검증 기록

## 외부 schema

`packages/broker-toss/openapi/openapi.json`은 OpenAPI `3.1.0`, Toss API `1.2.4`입니다. 동기화 script가 path의 operationId 존재와 고유성을 검사하고 생성 manifest에 30개 operation을 기록합니다. 테스트는 다음 parity를 확인합니다.

- 총 30 operations
- GET business 23
- 계좌 변경 6
- 모든 business operation과 명시적 client method의 일치

정적 OpenAPI 타입은 외부 응답의 런타임 유효성을 보장하지 않습니다. 중립 adapter 구현 시 runtime schema를 추가해야 합니다.

## 내부 schema

`02_schema.yaml`은 현재 실제 구현된 GET route 두 개만 기술합니다. health route는 `paper`, 합성 데이터, 미연결과 `liveOrdersEnabled: false`를 반환합니다. brokers route는 Toss `1.2.4`, 30 operations, `not_connected`, `transport_only`와 transport read-only capability 18개를 반환하는 코드와 일치합니다. 대시보드 snapshot은 route가 아니라 server component 데이터 계약이므로 이 schema에 포함하지 않았습니다.

## 미검증

- 공식 명세 변경 감지 CI
- live read 응답과 공식 schema의 런타임 일치
- 실제 Toss 응답에서 rate-limit/request ID 헤더가 항상 제공되는지
- pagination cursor와 날짜 경계
- BFF 공통 JSON 오류 envelope
