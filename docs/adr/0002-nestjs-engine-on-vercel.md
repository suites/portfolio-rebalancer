# ADR 0002: Vercel engine에 NestJS 11과 Fastify adapter 사용

## 상태

승인됨 — 2026-07-16

## 배경

초기 read-only 수직 슬라이스는 Fastify route를 하나의 진입점에서 직접 조합했습니다. 목표 설정, 계획, 주문 원장, 복구와 감사 기능이 추가되면 인증, 애플리케이션 서비스, 인프라 수명주기와 HTTP 계약을 명시적인 경계로 확장해야 합니다. engine은 일반 Nest 애플리케이션으로 유지하고 Vercel 변환 세부사항을 애플리케이션 코드에 복제하지 않으며, 토스 클라이언트와 PostgreSQL 연결은 warm runtime에서 재사용해야 합니다.

## 결정

- root에는 `main.ts`와 `AppModule`만 두고 `common`, `config`, `infrastructure/prisma`, `modules/system`, `modules/portfolio`의 feature-first 구조를 사용합니다.
- DB client 생성과 종료는 singleton `PrismaService`가 관리하고 `PrismaModule`이 이를 내보냅니다. 스키마, Client 생성과 migration의 기준은 `packages/database/prisma`입니다.
- portfolio 내부는 `presentation`, `application`, `domain`, `infrastructure`로 나누고 HTTP 계층은 NestJS 11의 Controller, Guard와 singleton Provider로 구성합니다.
- HTTP adapter는 Fastify 5를 유지합니다.
- Vercel이 감지하는 `src/main.ts`가 `@nestjs/core`를 직접 import하고 하나의 `bootstrap()` 안에서 `NestFactory.create()`와 `app.listen()`을 호출합니다.
- Vercel zero-config가 이 일반 Nest 진입점을 변환하므로 `vercel.json`에 handler, rewrite 또는 `functions` glob을 선언하지 않습니다.
- platform `PORT`를 `ENGINE_PORT`보다 항상 우선합니다. host 기본값은 로컬 `127.0.0.1`, Vercel `0.0.0.0`으로 config에서 해석하여 bootstrap 분기를 만들지 않습니다.
- Fluid Compute의 Function 실행 시간과 메모리는 `vercel.json`이 아니라 Vercel Dashboard의 Functions 설정에서 관리합니다.
- engine build는 Nest CLI와 workspace alias를 지정한 webpack으로 내부 TypeScript 패키지를 포함한 CommonJS bundle을 만들고 외부 npm 패키지는 runtime dependency로 유지합니다. `start:prod`는 Node로 이 산출물을 직접 실행합니다.
- engine package는 CommonJS 경계를 명시하여 Vercel이 변환한 extensionless 상대 import와 독립 production bundle이 같은 Node 해석 규칙을 사용하게 합니다.
- 토스 클라이언트는 첫 수집 시 lazy singleton으로 생성해 OAuth 캐시를 warm instance에서 재사용합니다.
- Prisma client와 repository는 애플리케이션 singleton이며 요청 종료 시 disconnect하지 않습니다.
- service token과 Cron secret은 서로 다른 Guard로 검증합니다.
- 수집기, 평가 로직과 repository는 NestJS에 의존하지 않는 기존 순수 경계를 유지합니다.
- Preview에서 토스 자격증명이 없어도 health와 저장된 dashboard 조회가 기동할 수 있어야 합니다.

## 결과

기능 확장 시 모듈 경계와 테스트 대체점이 명확해집니다. NestJS bootstrap 비용이 추가되지만 Vercel Fluid Compute의 warm runtime 재사용과 Fastify adapter로 완화합니다. runtime instance 사이의 상태는 공유되지 않으므로 동시 수집 방지는 계속 PostgreSQL lease가 담당합니다.

실주문 자동 재시도는 추가하지 않으며, live 주문 차단과 fail-closed 규칙은 변경하지 않습니다.
