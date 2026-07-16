# Architecture and Usability

권장 환경변수 소유권은 3개 경계다.

1. `apps/web/.env.local`: `ENGINE_INTERNAL_URL`, `ENGINE_SERVICE_TOKEN`
2. `apps/engine/.env.local`: Toss 자격증명, 계좌 선택값, pooled `DATABASE_URL`, 서비스/cron key, egress 확인값
3. `packages/database/.env.local` 또는 CI secret: migration 전용 `DATABASE_DIRECT_URL`

각 위치에 최소 키만 담은 `.env.example`을 둔다. 브라우저 공개용 `NEXT_PUBLIC_*`에는 비밀정보를 두지 않는다. Production과 Preview는 Vercel 프로젝트 및 환경 단위로 별도 값을 사용한다.
