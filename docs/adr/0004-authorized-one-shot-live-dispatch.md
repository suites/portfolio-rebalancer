# ADR 0004: 원시 쓰기 API 차단과 승인 전용 일회성 Live dispatch를 분리

- 상태: 채택
- 결정일: 2026-07-16

## 배경

`packages/broker-toss`는 공식 OpenAPI parity를 위해 계좌를 변경하는 일반 주문과
조건주문 메서드를 모두 보유합니다. 이 저수준 표면을 실행 모드 플래그로 직접
활성화하면 계획, 계좌, 한도와 수동 승인 증거를 우회해 브로커 요청을 만들 수 있습니다.

반대로 Live 구현을 완전히 배제하면 주문 원장, 멱등성, 장애 복구와 운영 UX를 실제
전송 경계까지 검증할 수 없습니다. 코드 구현과 실계좌 운영 승격을 분리하면서도,
네트워크 호출 직전의 불변 증거를 강제하는 좁은 경계가 필요합니다.

## 결정

일반 `TossTradingApi`의 계좌 변경 6개 메서드는 계속
`TOSS_LIVE_TRADING_DISABLED`로 네트워크 호출 전에 차단합니다. 이를 해제하는 환경변수,
생성자 옵션이나 공개 플래그를 추가하지 않습니다.

제한형 Live는 별도 `TossLiveOrderAdapter`가 `BrokerLiveOrderPort`를 구현합니다. 이
어댑터는 engine이 다음 조건을 모두 검증하고 봉인한 authorization을 전달한 경우에만
호출할 수 있습니다.

- ACTIVE `LIVE` 운영 설정과 현재 계좌 allowlist HMAC
- 설정 및 이벤트 원장의 킬 스위치 해제
- 동일 운영 설정 버전의 별도 Live 승격
- 저장된 계획 hash와 만료되지 않은 주문별 수동 승인
- 최신 pre-submit 증거와 미해결 주문 부재
- 단일·일일·회전율·비중·극소액 한도
- 결정적인 `logical_order_id`와 36자 `clientOrderId`

Live 제출은 네트워크 호출 전에 PostgreSQL에 다음 증거를 순서대로 저장합니다.

1. A `OrderSubmissionAuthorization`: 계획, 계좌, 설정, 승인과 Risk Gate 결과를 봉인
2. B `OrderDispatchClaim`: 해당 논리 주문의 네트워크 dispatch 권리를 한 번만 선점

B 저장에 성공한 호출만 일반 지정가 주문 생성을 정확히 한 번 실행합니다. timeout,
네트워크 실패와 모호한 응답은 자동 재시도하지 않고 즉시 주문 조회·대사로 전환합니다.
토스 `clientOrderId`의 10분 멱등성은 보조 방어선이며 로컬 UNIQUE 원장을 대신하지
않습니다.

A 뒤 프로세스가 중단되면 B와 `SUBMIT` 증거가 모두 없음을 DB가 증명한 경우에만
`OrderNonDispatchEvidence`를 추가하고 `REJECTED`로 종료해 예약을 해제합니다. B가
있거나 존재 가능성을 배제하지 못하면 재제출하지 않습니다. B 뒤 응답 저장 전에
중단된 경우 조회 응답에 봉인된 `clientOrderId`가 없으면 경제조건과 시간창만으로
미체결 주문을 자동 귀속하지 않습니다. 10분 뒤 no-ID `UNKNOWN_BLOCKED`로 잠근 뒤
운영자 exact 복구만 허용합니다.

취소도 별도 운영자 authorization과 cancel dispatch claim 뒤 한 번만 전송합니다.
취소 요청 접수는 원 주문의 `CANCELED` 상태가 아니며, 최종 상태는 원 주문 조회에서만
확정합니다.

V1 Live 범위는 ADR 0003의 한국 정규 연속매매, 정수 수량, `LIMIT`·`DAY`에 한정합니다.
한 실행은 매도 우선 첫 주문 한 건만 dispatch하며 다음 주문은 새 스냅샷과 새 계획을
요구합니다. 주문 정정, 조건주문, 시장가, 미국 시장과 자동 Phase B는 지원하지
않습니다.

## 이유

- 저수준 API parity와 제품의 금융 권한을 분리할 수 있습니다.
- 실행 모드나 환경변수 하나로 실거래 안전장치를 우회할 수 없습니다.
- DB commit과 네트워크 호출 사이의 중단을 명시적인 A/B 증거로 구분할 수 있습니다.
- 토스 서버 멱등성 시간이 지난 뒤에도 로컬 원장이 자동 재제출을 막습니다.
- 코드 경로를 완성해도 실제 계좌 검증과 운영 승격은 별도 절차로 남길 수 있습니다.

## 결과

- raw `TossTradingApi` 하드 차단 테스트와 승인 전용 adapter 테스트를 모두 유지합니다.
- 기본 실행 모드는 PAPER이며 `liveOrdersEnabled`가 false이면 Live 제출 UI와 engine
  실행이 모두 fail closed 합니다.
- 실제 계좌 극소액 주문, 장기 Shadow/Paper 비교, 독립 실거래 리뷰와 장애 런북은
  코드 구현과 별도의 필수 승격 조건입니다.
- 새 쓰기 기능은 raw API 차단을 해제하지 않고 별도 ADR, 정책 버전, 원장 증거와 복구
  검증을 추가해야 합니다.
