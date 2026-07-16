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
10. 배포 후 `/`, `/portfolio`, `/rebalancing`, `/orders`, `/troubleshooting`, `/settings`가 모두 열리는지 확인한다.
11. 목표 초안 저장과 적용 사이 snapshot이 바뀌면 적용이 차단되는지 확인하고, 적용 뒤 read-only 수집을 새로 실행해 snapshot에 설정 버전이 고정되는지 확인한다.
12. 모든 화면에서 `liveOrdersEnabled=false`와 실주문 차단 표시가 유지되는지 확인한다.

## macOS home-server

1. `pnpm verify`로 production build를 생성한다.
2. Web은 `127.0.0.1:13000`, engine은 `127.0.0.1:4100`에 bind한다.
3. `home-server/config/launchd`의 Portfolio Rebalancer LaunchAgent 두 개를 `~/Library/LaunchAgents`에 설치한다.
4. `home-server/config/caddy/Caddyfile`의 `stock.fredly.dev` route를 검증하고 host Caddy를 reload한다.
5. Cloudflare DNS-only A record를 Mac의 Tailscale IPv4로 지정한다.
6. 로컬 upstream, `curl --resolve` 프록시, 정상 DNS의 `https://stock.fredly.dev` 순서로 확인한다.
