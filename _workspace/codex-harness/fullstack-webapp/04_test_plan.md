# Test Plan

- Toss 계좌·보유·환율 런타임 schema rejection
- USD/KRW bigint 환산과 KRW fractional rejection
- 복수 계좌 자동 선택 금지
- accountNo redaction/HMAC
- dashboard target 미설정 계약
- Prisma migration fresh deploy
- DB append-only trigger와 lease 해제
- 실제 read-only 수집 smoke test
- format, lint, typecheck, unit tests, production build
