# Performance and Operations Review

- Runtime `DATABASE_URL`은 serverless 호환 pooled connection을 사용한다.
- Migration용 `DATABASE_DIRECT_URL`은 Function runtime에 주입하지 않고 승인된 단일 CI job에서만 사용한다.
- Vercel build 또는 앱 startup에서 migration을 실행하지 않는다. Web/Engine 및 Preview 빌드가 병렬로 중복 실행할 수 있다.
- 환경변수 변경은 기존 deployment에 소급되지 않으므로 서비스 토큰 회전 시 Web과 Engine을 같은 release window에 재배포한다.
