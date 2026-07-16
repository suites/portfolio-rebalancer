# Test Plan

- Toss 계좌·보유·환율 런타임 schema rejection
- USD/KRW bigint 환산과 KRW fractional rejection
- 복수 계좌 자동 선택 금지
- accountNo redaction/HMAC
- dashboard target 미설정 계약
- Prisma migration fresh deploy
- DB append-only trigger와 lease 해제
- 실제 read-only 수집 smoke test
- NestJS Controller의 health, service auth, Cron auth, 503 차단 계약
- 실제 AppModule과 PrismaModule provider graph bootstrap
- dashboard와 refresh의 `cache-control: no-store`
- format, lint, typecheck, unit tests, production build
