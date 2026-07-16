# Architecture

```text
Browser -> apps/web (Next.js, Vercel)
             -> apps/engine (Fastify Function, icn1, Static IP)
                  -> Toss OpenAPI read APIs
                  -> packages/database -> Neon PostgreSQL
```

- web은 `ENGINE_INTERNAL_URL`과 service token만 소유한다.
- engine은 Toss 자격증명, Prisma, 수집 lease와 Cron을 소유한다.
- PostgreSQL snapshot은 append-only trigger로 UPDATE/DELETE를 거부한다.
- 목표 설정이 없으면 실제 보유는 표시하되 계획과 주문을 차단한다.
