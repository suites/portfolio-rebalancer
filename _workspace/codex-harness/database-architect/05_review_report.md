# Review

- BPS CHECK와 비음수 금액 CHECK: 적용
- append-only trigger: 실제 UPDATE 거부 확인
- fresh migration: PostgreSQL 17에서 적용 확인
- lease: 수집 종료 후 0건 확인
- 전체 계좌번호: redacted evidence만 저장 확인
- 주문 원장·일일 한도·복구 테이블: 후속 범위

## BrokerRequestAttempt review

- nullable collection run: 계좌 선택 전 및 doctor workflow 지원
- outcome/HTTP status CHECK: 성공, HTTP 오류, transport 오류, schema 오류 분리
- retry identity UNIQUE: 적용
- rate metadata non-negative 및 remaining <= limit: 적용
- append-only UPDATE/DELETE trigger: migration contract test 추가
- Toss callback wiring: 별도 transport 통합 slice로 의도적으로 제외

## Market snapshot payload provenance review

상태: 통과.

- partial application 이후 migration 재실행: 동일 SQL 2회 재실행 통과
- valid price/calendar evidence insert: 통과
- wrong price, symbol, currency, provider timestamp, calendar date, received timestamp fail closed: 통과
- TEMP shadow relation 무효화: 통과
- current immutable evidence table의 ALWAYS row/TRUNCATE guard 확인: 통과
- fresh PostgreSQL 17: 15개 migration 전체 deploy 통과
- 실제 PostgreSQL integration: 4 files, 7 tests 통과
