# Data Model

계좌 참조, 버전 목표 설정, 수집 실행, redacted evidence, 불변 snapshot/holding/check,
그리고 수평 실행용 runtime lease를 분리한다. 전체 계좌번호와 access token은 저장하지 않는다.

## BrokerRequestAttempt

- workflow type + correlation UUID로 collection, doctor, validation, plan을 공통 추적한다.
- collection run FK는 계좌 선택 전 호출과 doctor를 위해 nullable이다.
- operation ordinal과 1-based attempt를 분리해 429 retry를 중복 없이 기록한다.
- HTTP와 rate-limit metadata는 명시적 nullable 열로 저장한다.
- redacted request summary는 JSON object만 허용한다.

## Runtime role boundary

- `portfolio` 같은 migration owner는 Prisma migration과 bootstrap만 실행한다.
- `portfolio_rebalancer_runtime_<database-hash>`는 데이터베이스별 NOLOGIN privilege group이다.
- `portfolio_runtime` 같은 engine LOGIN role은 privilege group만 INHERIT하고 다른 role membership을 갖지 않는다.
- application object는 migration owner가 계속 소유하며 runtime LOGIN/group은 어떤 public relation/function도 소유하지 않는다.
- 새 migration object는 default privilege로 자동 노출하지 않고 migration 뒤 bootstrap 재실행 시 검토된 권한을 받는다.
