# Vercel Deploy

1. 같은 저장소에서 `apps/engine`, `apps/web`을 각각 Project로 import한다.
2. Marketplace Neon을 engine에 연결한다.
3. direct URL로 `pnpm db:migrate:deploy`를 실행한다.
4. Vercel이 `apps/engine/src/main.ts`의 NestJS 서버를 감지하고 Prisma `postinstall` 생성이 성공하는지 확인한다.
5. engine Production에 Toss keys, DB URLs, service token, Cron secret을 설정한다.
6. engine의 `icn1` Static IPs 또는 Secure Compute를 활성화하고 Toss allowlist에 등록한다.
7. 확인 후에만 `TOSS_EGRESS_ALLOWLIST_CONFIRMED=true`를 설정한다.
8. web에 engine production URL과 같은 service token을 설정한다.
9. Preview에는 운영 Toss keys를 주입하지 않는다.
