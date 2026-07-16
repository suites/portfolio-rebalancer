# Review Summary

판정: Engine 코드는 Vercel NestJS zero-config에 맞지만 현재 설정 그대로 운영 배포가 확정됐다고 보기는 어렵다.

최초 배포 전 우선 보강:

1. Dashboard Root Directory를 `apps/engine`으로 선택한다.
2. `apps/engine/vercel.json`에 `framework: nestjs`를 명시한다.
3. Fluid compute와 충돌할 수 있는 `memory` 설정을 제거하고 Dashboard에서 설정한다.
4. `PORT` 호환성과 workspace Prisma 생성은 실제 Vercel Preview build로 검증한다.

운영 안정성 후속 보강:

1. 수집 lease heartbeat와 fencing 검사를 구현한다.
2. Production 필수 환경변수 readiness를 추가한다.
3. 별도 `ACCOUNT_REFERENCE_KEY`를 필수화한다.
4. Preview 배포 후 `/internal/v1/health`, 인증 endpoint, Cron endpoint를 smoke test한다.
