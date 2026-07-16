# Migration Plan

- Prisma schema와 migration SQL을 함께 커밋한다.
- 운영에서는 pooled runtime URL과 direct migration URL을 분리한다.
- 배포 승격 전에 `prisma migrate deploy`를 실행한다.
- rollback은 schema down이 아니라 이전 앱 배포 복귀와 forward migration을 기본으로 한다.

## BrokerRequestAttempt migration

- `BrokerRequestOutcome` enum과 `broker_request_attempt` 테이블을 forward migration으로 추가한다.
- 기존 `reject_immutable_change()`를 재사용하는 UPDATE/DELETE 거부 trigger를 설치한다.
- outcome과 HTTP status의 가능한 조합, 시간 순서, non-negative rate metadata를 CHECK한다.

## Market snapshot payload provenance migration

1. 모든 기존 public trigger function을 `public` 수식 이름과 `SET search_path TO pg_catalog`로 교체한다.
2. 정규화 시장 증거를 PASSED 원문과 요청 완료시각에 대조한다.
3. append-only row guard가 있는 모든 테이블에 재실행 가능한 `BEFORE TRUNCATE` guard를 설치한다.
4. immutable, running-state, provenance trigger를 `ENABLE ALWAYS`로 고정한다.
5. static contract와 disposable PostgreSQL rejection path를 검증한다.

## Restricted runtime role bootstrap

1. compose init hook가 비밀정보를 파일에 저장하지 않고 환경변수에서 제한 LOGIN role을 만든다.
2. Prisma migration은 `DATABASE_URL` owner 연결로만 실행한다.
3. migration 성공 뒤 `bootstrap-runtime-role.cjs`가 current schema를 열거해 권한을 재적용한다.
4. PUBLIC의 public-schema CREATE, database TEMP, table privileges와 function EXECUTE 기본권한을 제거한다.
5. runtime group에는 현재 application table SELECT/INSERT와 명시적 UPDATE/DELETE allowlist만 부여한다.
6. `_prisma_migrations`, TRUNCATE, DDL ownership과 future-object 자동 grant는 허용하지 않는다.
7. engine 시작 시 현재/session role, role flags, ownership, schema/TEMP/TRUNCATE/migration-ledger 권한을 다시 검사한다.
