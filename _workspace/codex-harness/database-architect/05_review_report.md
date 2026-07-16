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

## Restricted runtime role review

상태: 통과.

- migration/runtime URL 분리
- local role init + post-migration privilege bootstrap
- runtime startup identity/ownership verification
- 정상 INSERT/lease/terminal update 통합 경로
- UPDATE/DELETE/TRUNCATE/trigger disable/drop/session replication/migration-ledger 거부 경로
- 데이터베이스별 NOLOGIN access role로 동일 cluster의 다른 database grant 상속 차단
- fresh PostgreSQL 17: 20개 migration 전체 deploy 후 runtime bootstrap 통과
- 실제 PostgreSQL runtime role integration: 5 tests 통과
- database unit/contract: 82 tests 통과, engine regression: 175 tests 통과
- database/engine TypeScript typecheck와 Prisma schema validate 통과

## Live dispatch DB safety review

상태: 통과.

- fresh PostgreSQL 17 test DB에 21개 migration 전체 deploy 통과
- B 직전 stale ACTIVE config, revoked promotion, engaged kill switch 거부 확인
- broker account 행 잠금이 B를 실제 block하고 lock 해제 뒤에만 claim되는 직렬화 확인
- fresh PASSED getAccounts exact HMAC/mask/type 단일 계좌 proof 확인
- LIVE PLANNED pre-authorization recovery의 REJECTED 이력, 전액 reservation release, 이후 A/broker
  evidence 차단 확인
- restricted runtime role의 mutable account metadata UPDATE 성공과 identity 열 UPDATE 권한 거부,
  owner trigger 우회 거부 확인
- 전체 DB integration 9 files/43 tests, 신규 집중 integration 22/22 통과
- database static/unit 89/89, Prisma validate/generate, TypeScript typecheck 통과
