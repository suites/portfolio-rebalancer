# ADR 0002: Vercel engine에 NestJS 11과 Fastify adapter 사용

## 상태

승인됨 — 2026-07-16

## 배경

초기 read-only 수직 슬라이스는 Fastify route를 하나의 진입점에서 직접 조합했습니다. 목표 설정, 계획, 주문 원장, 복구와 감사 기능이 추가되면 인증, 애플리케이션 서비스, 인프라 수명주기와 HTTP 계약을 명시적인 경계로 확장해야 합니다. 배포 대상은 계속 Vercel Functions이며 토스 클라이언트와 PostgreSQL 연결은 warm instance에서 재사용해야 합니다.

## 결정

- engine은 `EngineConfigModule`, `InfrastructureModule`, `PortfolioModule`로 나누고 HTTP 계층은 NestJS 11의 Controller, Guard와 singleton Provider로 구성합니다.
- HTTP adapter는 Fastify 5를 유지합니다.
- Vercel이 자동 감지하는 `src/main.ts`에서 Nest 애플리케이션을 시작합니다.
- 토스 클라이언트는 첫 수집 시 lazy singleton으로 생성해 OAuth 캐시를 warm instance에서 재사용합니다.
- Prisma client와 repository는 애플리케이션 singleton이며 요청 종료 시 disconnect하지 않습니다.
- service token과 Cron secret은 서로 다른 Guard로 검증합니다.
- 수집기, 평가 로직과 repository는 NestJS에 의존하지 않는 기존 순수 경계를 유지합니다.
- Preview에서 토스 자격증명이 없어도 health와 저장된 dashboard 조회가 기동할 수 있어야 합니다.

## 결과

기능 확장 시 모듈 경계와 테스트 대체점이 명확해집니다. NestJS bootstrap 비용이 추가되지만 Vercel Fluid Compute의 warm instance 재사용과 Fastify adapter로 완화합니다. serverless instance 사이의 상태는 공유되지 않으므로 동시 수집 방지는 계속 PostgreSQL lease가 담당합니다.

실주문 자동 재시도는 추가하지 않으며, live 주문 차단과 fail-closed 규칙은 변경하지 않습니다.
