# API

- `GET /internal/v1/health`: live 주문 비활성 상태
- `GET /internal/v1/dashboard`: 저장된 최신 실제 snapshot
- `POST /internal/v1/portfolio/refresh`: service token, Toss read-only 수집
- `GET /internal/v1/cron/portfolio`: Vercel Cron secret, 평일 09:00 KST
- `GET /internal/v1/records`: 최근 실제 수집·snapshot 검사 요약, service token
- `GET /internal/v1/target-settings`: 현재 보유 후보와 활성 목표 설정, service token
- `POST /internal/v1/target-settings/drafts`: 최신 snapshot에 묶인 검증된 목표 초안 저장, service token
- `POST /internal/v1/target-settings/drafts/:version/activate`: 동일 snapshot일 때만 초안 적용, service token
- `GET /api/v1/system/health`: Web BFF 상태
- `GET /api/v1/brokers`: 실제 engine 연결 상태

모든 dashboard 응답은 공유 Zod 계약을 통과하고 `liveOrdersEnabled: false`이다.
records 응답은 raw broker payload, 전체 계좌번호와 비밀정보를 포함하지 않는다.
target settings 저장과 적용은 분리하며 계획 생성 또는 주문 제출을 호출하지 않는다.
