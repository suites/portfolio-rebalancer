# API

- `GET /internal/v1/health`: live 주문 비활성 상태
- `GET /internal/v1/dashboard`: 저장된 최신 실제 snapshot
- `POST /internal/v1/portfolio/refresh`: service token, Toss read-only 수집
- `GET /internal/v1/cron/portfolio`: Vercel Cron secret, 평일 09:00 KST
- `GET /api/v1/system/health`: Web BFF 상태
- `GET /api/v1/brokers`: 실제 engine 연결 상태

모든 dashboard 응답은 공유 Zod 계약을 통과하고 `liveOrdersEnabled: false`이다.
