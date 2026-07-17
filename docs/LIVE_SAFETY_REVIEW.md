# 제한형 Live 코드 안전 리뷰

검토일: 2026-07-17

## 결론

현재 제한형 Live 구현에서 실제 주문 전송을 허용하면 안 되는 코드 차단 사유는 발견되지
않았습니다. 기본 모드는 `PAPER`이며 다음 조건을 모두 같은 계좌와 활성 설정에 묶어
재검증한 첫 주문 한 건만 전송할 수 있습니다.

- 현재 계좌 HMAC allowlist
- 최신 `ACTIVE` `LIVE` 설정과 동일 버전의 Live 승격
- 명시적으로 해제된 append-only 킬 스위치
- 주문별 만료 수동 승인과 계획 hash
- 최신 계좌·호가·수수료·매수 가능 금액·매도 가능 수량 증거
- DB에 먼저 저장된 A authorization과 네트워크 직전의 일회성 B dispatch claim

## 검토한 실패 경로

- A 저장 전, A 저장 후 B 저장 전, B 저장 후 응답 저장 전 중단
- `clientOrderId` 멱등성 10분 경계와 결과 불명 주문의 자동 재제출 금지
- 경제 조건만 비슷한 미체결 주문을 자동 귀속하지 않는 no-ID `UNKNOWN_BLOCKED` 처리
- exact 브로커 증거를 요구하는 운영자 복구
- 취소 요청의 일회성 dispatch와 원 주문 조회 기반 최종 상태 확정
- 계좌 번호와 `accountSeq` 불일치, 오래된 설정·승격·킬 스위치 상태
- Tailscale 내부망, Caddy TLS와 engine loopback 경계
- JSON 문자열과 이스케이프된 upstream 오류의 계좌·토큰 redaction
- migration owner와 제한된 runtime 역할의 권한 분리

## 검증 근거

- 엔진, Web, 도메인, 계약, 브로커와 DB 단위 테스트
- PostgreSQL 17의 새 데이터베이스에 전체 migration 적용 후 주문·권한 통합 테스트
- 타입 검사, ESLint, Prettier, Next.js production build
- 로컬 `tsx` 엔진에서 일반 내부 route의 무인증 호출과 Cron route의 인증 차단을 실제 HTTP로 확인
- Tailscale 전용 `stock.fredly.dev`에서 설정·리밸런싱·주문 화면 렌더링 확인

## 운영 승격과의 경계

이 리뷰는 코드를 검토한 결과이며 실계좌 운영 승격 승인이 아닙니다. 다음 항목은 별도
사용자 승인과 실제 운영 증거가 필요하므로 완료로 처리하지 않습니다.

- 한 종목·극소액·수동 승인 실제 주문
- 실계좌 주문 조회와 로컬 원장 대사
- 프로세스 강제 종료를 포함한 실제 장애 복구
- Shadow/Paper 장기 비교와 운영 런북 검증
- 세금, 환전과 계좌 유형별 제약 확인
