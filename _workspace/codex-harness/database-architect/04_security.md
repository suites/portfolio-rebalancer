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
