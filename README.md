# Portfolio Rebalancer

`portfolio-rebalancer`는 사람이 승인한 장기 목표 비중을 결정론적으로 점검하고, 불확실한 상황에서는 거래하지 않는 개인용 자산배분 시스템입니다. 시장 예측이나 종목 추천보다 계산 재현성, 장애 안전성, 주문 멱등성과 감사 가능성을 우선합니다.

> 현재 상태: 토스증권 실제 계좌·보유자산과 통화별 매수 가능 금액을 Prisma/PostgreSQL 불변 스냅샷으로 저장하고, 6개 운영 화면에서 조회하는 shadow 수직 슬라이스가 구현되었습니다. 현재 보유종목의 목표 비중은 버전형 초안으로 저장하고 별도로 적용할 수 있으며, 새 read-only 수집에서 해당 버전을 스냅샷에 고정합니다. 매수 가능 금액은 관리 현금과 분리된 주문 가능성 참고 증거로만 저장합니다. 검증된 관리 현금, 주문 계획, 주문 원장과 paper/live 실행은 아직 구현되지 않아 계속 차단됩니다. 실거래 쓰기 전송도 코드에서 하드 차단됩니다.

## 지금 확인할 수 있는 것

- Next.js App Router 기반의 반응형 운영 화면
- 홈, 포트폴리오, 리밸런싱, 주문·기록, 문제 해결과 설정의 실제 라우트
- 토스증권 실제 보유자산, 마스킹 계좌와 수집 시각을 표시하는 Shadow 화면
- 접근 가능한 보유자산 표와 실제 수집·스냅샷 검사 기록
- 목표 비중 초안의 원본 스냅샷 고정, 별도 적용, 새 스냅샷 고정과 설정 불일치 차단
- 목표 비중 또는 관리 현금 미검증 상태를 가짜 값 없이 표시하고 주문 계획 차단
- KRW·USD 매수 가능 금액을 관리 현금과 분리해 수집·표시
- 현재·목표·허용 범위와 서버 판정 상태를 함께 쓰는 비중 밴드
- 목표 비중만 입력하면 서버가 `MIXED_V1` 혼합 정책으로 하한·상한 자동 계산
- `bigint` 교차곱으로 1bp 미만 이탈까지 감지하는 부동소수점 없는 포트폴리오 비중 계산
- Zod로 검증하는 서버-클라이언트 대시보드 계약
- 토스증권 OpenAPI `1.2.4`의 30개 operation 타입과 호출 표면
  - OAuth 토큰 1개
  - 조회용 GET business operation 23개
  - 계좌를 변경하는 operation 6개
- OAuth 토큰 메모리 캐시와 동시 발급 single-flight
- 고정된 공식 origin, 공통 10초 timeout과 안전한 네트워크·HTTP 오류
- 401 토큰 무효화와 429 `Retry-After`·rate-limit group·request ID 메타데이터 추출
- 계좌 변경 메서드의 네트워크 전송 하드 차단(`TOSS_LIVE_TRADING_DISABLED`)
- 계좌·보유·시세·호가·종목·주문 조회를 분리한 capability 기반 중립 포트
- Toss transport가 제공하는 read-only capability 18개와 write capability 미제공
- NestJS 11과 Fastify adapter 기반 별도 engine, Next.js Web/BFF의 모노레포 분리
- Prisma 7과 PostgreSQL 17 기반 계좌 참조·수집 실행·redacted 응답·불변 스냅샷
- Vercel web/engine 별도 Project, 평일 09:00 KST Cron과 PostgreSQL collection lease
- heartbeat와 fencing token 최종 재검증으로 만료된 수집기의 늦은 스냅샷 저장 차단

이 범위는 실제 주문 기능이 아닙니다. 토스증권에는 확인된 별도 sandbox/paper 서버가 없으므로 향후 paper 체결은 애플리케이션 내부에서 구현합니다.

## 빠른 시작

요구사항:

- Node.js 22 이상
- pnpm 10.28.0

```bash
pnpm install
docker compose up -d postgres
pnpm db:migrate:deploy
pnpm dev
```

`apps/engine/.env.example`, `apps/web/.env.example`, `packages/database/.env.example`을 각각 같은 위치의 `.env.local`로 복사하고 로컬 값을 설정합니다. 토스 read-only 자격증명은 engine에만 두고 브라우저에서 `http://127.0.0.1:13000`을 엽니다. 호스트 운영에서는 launchd가 같은 포트의 production Web과 4100 포트의 engine을 유지하고, `home-server` Caddy가 `https://stock.fredly.dev`를 Web으로 전달합니다. 첫 화면은 저장된 스냅샷이 없을 때 한 번 실제 계좌 수집을 시도합니다. 목표는 설정 화면에서 초안 저장과 적용을 분리합니다. 초안은 저장 당시 스냅샷 ID와 digest에 묶이므로 그 사이 계좌 데이터가 바뀌면 적용하지 않고 새 초안을 요구합니다. 적용 후 문제 해결 화면에서 새 데이터를 재점검해야 최신 스냅샷에 활성 버전이 고정됩니다. 전체 계좌번호와 토큰은 저장하거나 브라우저로 전달하지 않으며 주문을 제출하지 않습니다.

전체 검증은 다음 명령으로 실행합니다.

```bash
pnpm verify
```

`verify`는 포맷, 린트, 타입 검사, 테스트와 프로덕션 빌드를 순서대로 확인합니다. 개별 명령은 `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`입니다.

V8 coverage 보고서는 다음 명령으로 생성합니다.

```bash
pnpm test:coverage
```

토스증권 공식 명세를 다시 고정하고 타입을 생성하려면 네트워크가 연결된 환경에서 실행합니다.

```bash
pnpm toss:sync
```

동기화 결과와 운영 주의사항은 [토스증권 API 연동 문서](docs/API_TOSS.md)를 참고하세요.

## 구조

```text
apps/
├── web/                 Next.js Web GUI와 engine BFF
└── engine/              NestJS API, Toss 수집과 Vercel Cron 진입점
packages/
├── domain/              bigint 기반 값 객체와 순수 비중 계산
├── broker/              증권사 중립 모델, capability와 좁은 포트
├── broker-toss/         고정 OpenAPI, 생성 타입, OAuth와 Toss 전송 계층
├── application/         유스케이스와 화면용 스냅샷 조합
├── contracts/           서버 경계의 Zod 계약
├── database/            Prisma schema, migration과 PostgreSQL client
└── ui/                  primitive·semantic·component 토큰과 공통 컴포넌트
```

의존성은 도메인 안쪽을 향합니다. 브라우저와 Next.js는 토스증권 자격증명이나 Prisma에 접근하지 않고, engine이 만든 검증된 계약만 받습니다. 다른 증권사는 `packages/broker`의 capability와 포트를 구현하는 별도 어댑터로 추가합니다. 자세한 결정은 [아키텍처 결정 기록](docs/adr/0001-typescript-hexagonal-monorepo.md)에 있습니다.

engine은 NestJS의 feature module 구조를 따릅니다.

```text
apps/engine/src/
├── main.ts, app.module.ts
├── common/auth/guards/              service/Cron 인증
├── config/                          Zod 환경설정과 Config Module
├── infrastructure/prisma/           Prisma Module과 singleton PrismaService
└── modules/
    ├── system/                      health endpoint
    └── portfolio/
        ├── presentation/            Controller
        ├── application/             Service, 수집 use case, presenter
        ├── domain/                  오류와 bigint 평가 로직
        └── infrastructure/          Toss adapter와 Prisma repository
```

## Vercel 운영

같은 Git 저장소에서 `apps/web`과 `apps/engine`을 각각 Vercel Project로 가져옵니다. PostgreSQL은 `portfolio-rebalancer-engine`에 연결한 Vercel Marketplace Supabase를 기본 운영 경로로 사용합니다. Integration이 자동 주입하는 pooled `POSTGRES_PRISMA_URL`은 runtime, direct `POSTGRES_URL_NON_POOLING`은 Prisma migration에 사용하며 기존 `DATABASE_URL`과 `DATABASE_DIRECT_URL`은 로컬·호환 fallback으로 유지합니다.

engine 프로젝트의 Root Directory는 `apps/engine`으로 지정하고 외부 workspace source 포함을 활성화합니다. Framework, Build Command와 Output Directory는 override하지 않습니다. `src/main.ts`는 일반 Nest 애플리케이션과 동일하게 `NestFactory.create()`와 하나의 `app.listen()` 경로만 사용합니다. Vercel zero-config가 NestJS와 이 진입점을 자동 감지하므로 `vercel.json`에는 서울 리전과 Cron만 선언합니다. Vercel이 제공하는 `PORT`를 `ENGINE_PORT`보다 우선하고, 실행 시간과 메모리는 Fluid Compute와 충돌하지 않도록 Dashboard의 Functions 설정에서 관리합니다.

engine은 별도 webpack 번들을 만들지 않습니다. 로컬에서는 `tsx`로 실행하고, 배포에서는 Vercel의 NestJS zero-config 변환을 사용합니다. Vercel 함수 추적에 필요한 workspace 패키지만 배포 빌드 전에 CommonJS `dist`로 컴파일합니다.

토스증권은 허용 IP를 요구하므로 engine 프로젝트에서 Vercel Pro Static IPs 또는 Enterprise Secure Compute를 활성화해야 합니다. 해당 IP를 토스증권에 등록한 뒤에만 `TOSS_EGRESS_ALLOWLIST_CONFIRMED=true`를 설정하세요. 일반 Vercel 동적 출구 IP에서는 실제 수집이 코드에서 차단됩니다.

Production engine에는 Supabase Integration의 `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`과 직접 관리하는 `TOSSINVEST_CLIENT_ID`, `TOSSINVEST_CLIENT_SECRET`, `ENGINE_SERVICE_TOKEN`, `CRON_SECRET`을 민감 환경변수로 설정합니다. Supabase Integration은 engine 프로젝트에만 연결하고 web에는 `ENGINE_INTERNAL_URL`과 같은 `ENGINE_SERVICE_TOKEN`만 설정합니다. Preview에는 운영 토스 키를 주입하지 않는 것을 기본으로 합니다.

로컬 환경변수도 같은 권한 경계를 사용합니다. Web은 `apps/web/.env.local`, engine은 `apps/engine/.env.local`, Prisma migration은 `packages/database/.env.local`을 읽습니다. `.env.local`은 Git에 포함하지 않으며, `vercel env pull`은 파일을 덮어쓰므로 앱별 파일에 수동 override와 Vercel pull 결과를 섞지 않습니다.

## 안전 원칙

- 기본 실행 모드는 항상 `paper`입니다.
- 금액과 수량 계산에 부동소수점을 사용하지 않습니다.
- 외부 데이터는 관측 시각이 있는 불변 스냅샷으로 고정한 뒤 계산합니다.
- API 오류, 데이터 누락과 상태 불명 주문에서는 fail closed 합니다.
- `buying power`를 검증된 평가용 현금으로 간주하지 않습니다.
- 설정 저장, 계획 생성과 주문 제출을 서로 다른 동작으로 유지합니다.
- 브라우저에서 증권사 API를 직접 호출하거나 비밀정보를 전달하지 않습니다.
- 실제 주문은 별도 설계 검토, 원장·멱등성·한도·복구와 명시적 승인 조건이 모두 구현되기 전까지 활성화하지 않습니다.

향후 운영 인터페이스는 `setup`, `doctor`, `check`, `plan`, `run`, `status`, `explain`, `recover`로 내부 복잡성을 숨깁니다. 이 CLI와 실제 계좌 흐름은 아직 구현되지 않았으며 [구현 계획](docs/TODO.md)에서 추적합니다.

## 디자인 기준

생산 Web GUI는 `packages/ui`를 시각 구현의 기준으로 사용합니다.

- 행동·안전·접근성 계약: [Web GUI 설계](docs/WEB_UI.md)
- 생산 토큰과 컴포넌트: `packages/ui/src`
- 토큰 호환 진입점: `design/tokens.css`
- 초기 상태·레이아웃 탐색물: `prototype/index.html`

프로토타입은 참고용이며 실제 금융 계산이나 주문 판단을 수행하지 않습니다. 생산 화면은 엔진이 PostgreSQL에 저장한 토스증권 실계좌 스냅샷만 사용합니다. 목표 설정이 없거나 활성 버전이 최신 스냅샷에 고정되지 않았거나 관리 현금이 검증되지 않으면 주문 계획을 차단합니다.

## 문서

- [시스템 명세](docs/SPEC.md)
- [구현 계획](docs/TODO.md)
- [Web GUI 설계](docs/WEB_UI.md)
- [토스증권 API 연동](docs/API_TOSS.md)
- [아키텍처 결정 기록](docs/adr/0001-typescript-hexagonal-monorepo.md)
- [NestJS engine 결정 기록](docs/adr/0002-nestjs-engine-on-vercel.md)
- [에이전트 작업 지침](AGENTS.md)

## 개발 단계

1. 순수 계산과 읽기 전용 합성 데이터 수직 슬라이스 (완료)
2. Prisma/PostgreSQL 저장소와 감사 가능한 실계좌 스냅샷 (완료)
3. 토스증권 조회 API를 연결한 shadow 모드 (완료)
4. 자체 모의 체결기를 사용하는 paper 모드
5. 위험 차단, 주문 원장, 멱등성과 장애 복구
6. 모든 승격 조건과 별도 검토를 통과한 뒤 제한적 실거래 검토

## 주의

이 프로젝트는 투자 수익을 보장하지 않습니다. 리밸런싱은 수익 예측 기능이 아니라 목표 위험 수준을 유지하기 위한 통제 장치입니다. 세금, 계좌 유형, 환전, 상품 구조와 개인 재무 상황은 소프트웨어 외부에서 별도로 검토해야 합니다.
