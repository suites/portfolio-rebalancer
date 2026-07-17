# Security Review

## 확인된 안전 요소

- `api/` handler, Lambda adapter, `VercelRequest`/`VercelResponse`, 수동 rewrite가 없다.
- 일반 engine route는 custom Guard 없이 host-run loopback 경계에 있고 Cron route만 전용 Guard로 검증한다.
- authorization header는 Fastify logger에서 redaction한다.
- Toss 고정 출구 IP 확인값이 없으면 Vercel 수집은 fail closed 한다.
- 실제 주문 전송은 계속 차단되어 있다.
- `.env.local`은 Git에서 제외되고 Vercel CLI dry-run 중 로컬 `.env` 포함을 발견한 뒤 직접 업로드 배포를 중단했다.

## 후속 개선

- Vercel을 다시 운영 경로로 사용할 때는 Deployment Protection이 적용된 Web→Engine 서버 통신을 먼저 검증해야 한다.
- health는 liveness만 의미한다. DB/Toss readiness는 사설 경계 안의 별도 endpoint로 추가해야 한다.
