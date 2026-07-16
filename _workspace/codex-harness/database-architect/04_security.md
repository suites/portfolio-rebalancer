# Security

- accountNo는 ingest 직후 HMAC과 마스킹 값으로 치환한다.
- raw response는 redacted JSONB만 허용한다.
- snapshot/evidence/check UPDATE와 DELETE는 DB trigger로 거부한다.
- Vercel env는 Production/Preview 범위를 분리하고 secrets는 NEXT_PUBLIC을 사용하지 않는다.

## BrokerRequestAttempt security

- request body/header 원문 대신 redacted request summary만 저장한다.
- request summary는 DB에서 JSON object만 허용한다.
- request ID와 safe error code만 감사 metadata로 보존한다.
- append-only trigger로 성공·실패·retry 기록의 사후 변조를 차단한다.

## Market snapshot payload provenance security

- trigger function의 relation lookup을 schema-qualified하여 TEMP relation shadowing을 차단한다.
- function search path에는 `pg_catalog`만 두고 application relation과 enum type을 명시 수식한다.
- 가격 행은 동일 심볼의 원문 result 항목이 정확히 하나이고 통화·가격 문자열·provider timestamp가 모두 같아야 한다.
- 가격·캘린더 `received_at`은 immutable request attempt `completed_at`과 같아야 한다.
- 캘린더 정규화 날짜는 원문 `today`, `previousBusinessDay`, `nextBusinessDay` 날짜와 같아야 한다.
- UPDATE, DELETE, TRUNCATE guard는 `session_replication_role = replica`에서도 실행한다.

## Restricted runtime role security

- engine은 `DATABASE_RUNTIME_URL`만 읽으며 migration owner URL을 fallback으로 사용하지 않는다.
- startup은 `session_user = current_user`를 요구해 owner login 후 `SET ROLE`로 가장한 연결도 차단한다.
- runtime은 SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS, TEMP, public CREATE와 TRUNCATE 권한이 없다.
- runtime은 public application object/function을 소유하거나 그 owner role을 상속할 수 없다.
- NOLOGIN access role 이름은 database 이름 hash를 포함해 동일 cluster의 다른 database grant와 분리한다.
- startup은 database별 access role 외의 직·간접 role membership과 allowlist 밖 UPDATE, runtime lease 외 DELETE grant drift를 차단한다.
- table UPDATE grant는 실제 mutable row, guard 내부 단조 갱신과 `SELECT ... FOR UPDATE` 대상에만 제한한다.
- append-only allowlist table은 UPDATE grant가 필요한 경우에도 ALWAYS trigger가 직접 변경을 거부한다.
- runtime은 `_prisma_migrations`를 읽거나 쓸 수 없다.
- 새 schema object는 bootstrap 재실행 전 runtime에 보이지 않아 migration 후 권한 누락이 거래 확대보다 안전한 실패로 이어진다.

## Live dispatch DB safety

- B trigger가 broker account 행을 `FOR UPDATE`한 뒤 ACTIVE config, promotion, kill switch를 다시
  읽으므로 activation/revoke/kill 변경과 dispatch seal 사이의 TOCTOU를 계좌 단위로 닫는다.
- runtime role은 `broker_account` table UPDATE가 아니라 `masked_number`, `account_type_raw`,
  `last_seen_at` 열 UPDATE만 가진다.
- ALWAYS trigger가 owner 권한에서도 `id`, `broker`, `external_ref_hmac`, `first_seen_at` 변경과
  last-seen 역행, DELETE/TRUNCATE를 거부한다.
- pre-submit account proof는 redacted `accountReferenceHmac`, masked number, account type만 사용하며
  원 계좌번호나 token을 저장하지 않는다.
- pre-authorization non-dispatch proof는 A/B/broker evidence가 전혀 없는 exact LIVE PLANNED와
  미사용 reservation에서만 생성되며, 이후 A와 broker evidence를 영구 차단한다.
