# Security

- accountNo는 ingest 직후 HMAC과 마스킹 값으로 치환한다.
- raw response는 redacted JSONB만 허용한다.
- snapshot/evidence/check UPDATE와 DELETE는 DB trigger로 거부한다.
- Vercel env는 Production/Preview 범위를 분리하고 secrets는 NEXT_PUBLIC을 사용하지 않는다.
