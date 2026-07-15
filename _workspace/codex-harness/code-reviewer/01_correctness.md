# Correctness Findings

## P0 — 현금 예시와 명세 충돌

README는 현금 10%를 활성화하지만 `managed_cash` 입력을 보여주지 않는다. SPEC은 검증된 현금 source가 없으면 현금 비중 계산을 차단한다.

## P1 — Paper와 live 요구 혼합

내부 paper에는 브로커 timeout, `clientOrderId`, 10분 멱등성 및 주문 대사가 필요하지 않다. 현재 완료 기준은 paper와 live hardening을 묶는다.

## P1 — 복구 UX가 늦음

`UNKNOWN_BLOCKED`와 stale lease가 먼저 등장하지만 안전한 상태 조회와 복구 명령은 후반 백로그에 있다.
