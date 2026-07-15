# API 설계 입력

## 목적

- 토스증권 공식 OpenAPI 전체를 누락 없이 타입 안전하게 다룬다.
- 증권사 DTO와 애플리케이션 도메인을 분리한다.
- 다른 증권사를 capability 기반 어댑터로 추가할 수 있게 한다.
- 현재 읽기 전용 수직 슬라이스를 유지하고 실거래는 활성화하지 않는다.

## 기존 자산

- 외부 canonical schema: `packages/broker-toss/openapi/openapi.json`
- 생성 타입: `packages/broker-toss/src/generated/schema.ts`
- operation manifest: `packages/broker-toss/src/generated/operations.ts`
- transport descriptor: read-only capability 18개, write capability 없음
- 내부 runtime 계약: `packages/contracts/src/dashboard.ts`
- 내부 GET routes: health, brokers

## 현재 제한

실제 계좌 연동, 중립 응답 adapter, runtime 외부 응답 검증, 자동 재시도·limiter, DB와 주문 원장은 없습니다. Toss 계좌 변경 6개 메서드는 공식 parity용 타입 표면일 뿐 `TOSS_LIVE_TRADING_DISABLED`로 fetch 전에 무조건 차단하며 transport descriptor에도 write capability가 없습니다.
