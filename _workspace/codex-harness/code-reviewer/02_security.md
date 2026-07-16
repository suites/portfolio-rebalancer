# Security Review

## 확인된 안전 요소

- `api/` handler, Lambda adapter, `VercelRequest`/`VercelResponse`, 수동 rewrite가 없다.
- Cron과 Web service token Guard가 분리되어 있다.
- authorization header는 Fastify logger에서 redaction한다.
- Toss 고정 출구 IP 확인값이 없으면 Vercel 수집은 fail closed 한다.
- 실제 주문 전송은 계속 차단되어 있다.
- `.env.local`은 Git에서 제외되고 Vercel CLI dry-run 중 로컬 `.env` 포함을 발견한 뒤 직접 업로드 배포를 중단했다.

## 후속 개선

- 장수명 bearer secret 비교를 공용 constant-time helper로 통합할 수 있다.
- public health는 liveness만 의미한다. DB/Toss readiness는 인증된 별도 endpoint로 추가해야 한다.
