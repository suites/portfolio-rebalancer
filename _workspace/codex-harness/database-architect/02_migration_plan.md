# Migration Plan

- Prisma schema와 migration SQL을 함께 커밋한다.
- 운영에서는 pooled runtime URL과 direct migration URL을 분리한다.
- 배포 승격 전에 `prisma migrate deploy`를 실행한다.
- rollback은 schema down이 아니라 이전 앱 배포 복귀와 forward migration을 기본으로 한다.

## BrokerRequestAttempt migration

- `BrokerRequestOutcome` enum과 `broker_request_attempt` 테이블을 forward migration으로 추가한다.
- 기존 `reject_immutable_change()`를 재사용하는 UPDATE/DELETE 거부 trigger를 설치한다.
- outcome과 HTTP status의 가능한 조합, 시간 순서, non-negative rate metadata를 CHECK한다.
