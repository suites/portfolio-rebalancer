# Security Review

## P1 — 단일 루트 env는 배포 권한 경계를 무너뜨릴 수 있음

Web 프로젝트가 루트 env 전체를 읽도록 맞추면 Toss 자격증명, DB URL, cron secret까지 Web Function에 주입된다. Web에는 Engine URL과 서비스 토큰만 제공한다.

## P1 — Engine URL 검증 없이 Bearer token 전송

Web은 설정된 `ENGINE_INTERNAL_URL`로 서비스 토큰을 보낸다. 운영에서는 HTTPS와 허용된 Engine origin을 검증하고 외부 origin 및 redirect를 거부해야 한다.

## P2 — 환경 간 자격증명 분리 필요

Production과 Preview의 Engine token 및 DB를 분리하고, 일반 Preview에는 운영 Toss 자격증명을 주입하지 않는다. `DATABASE_DIRECT_URL`은 migration CI만 소유한다.

## P2 — 로컬 secret 파일 권한

현재 `.env` 권한은 0644다. 개인 개발 환경에서도 0600을 권장한다.
