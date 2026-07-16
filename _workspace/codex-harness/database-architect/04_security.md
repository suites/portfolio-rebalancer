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
