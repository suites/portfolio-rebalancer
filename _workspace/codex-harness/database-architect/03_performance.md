# Performance

- account + observedAt DESC로 최신 snapshot을 조회한다.
- collection run도 account + startedAt DESC 인덱스를 사용한다.
- Runtime lease key는 PK이며 단일 atomic upsert로 획득한다.
- PrismaPg pool은 Function instance당 최대 5 connection으로 제한한다.

## BrokerRequestAttempt indexes

- workflow correlation + operation + ordinal + attempt UNIQUE로 retry 중복 기록을 차단한다.
- correlation + startedAt DESC로 workflow timeline을 조회한다.
- collectionRun + startedAt과 requestId를 별도 인덱싱한다.

## Runtime role overhead

- privilege bootstrap은 migration 직후 한 번만 catalog를 순회한다.
- engine startup role 검증은 `pg_roles`, `pg_class`, `pg_proc` catalog 조회 한 번이며 주문별 hot path에는 포함하지 않는다.
- runtime connection pool 크기와 query 실행 경로는 변경하지 않는다.
