# Portfolio Rebalancer

`portfolio-rebalancer`는 사람이 승인한 장기 목표 비중을 결정론적으로 점검하고, 불확실한 상황에서는 거래하지 않는 개인용 자산배분 시스템입니다. 시장 예측이나 종목 추천보다 계산 재현성, 장애 안전성, 주문 멱등성과 감사 가능성을 우선합니다.

> 현재 상태: 실제 토스 계좌 스냅샷, 버전형 목표 설정, Shadow/Paper/Live 계획, append-only 주문 원장, 위험 게이트와 운영 Web UI가 연결되어 있습니다. Paper는 실제 호가·호가잔량·수수료 증거로 내부 모의 체결만 수행합니다. Live 생성·조회·취소 코드는 구현되어 있지만 기본값은 PAPER이며, ACTIVE LIVE 설정, 현재 계좌 HMAC allowlist, 해제된 킬 스위치, 동일 설정의 별도 Live 승격, 주문별 만료 승인, 최신 pretrade 증거와 DB 일회성 dispatch claim을 모두 통과한 첫 주문 한 건만 전송할 수 있습니다. 실제 계좌의 극소액 주문 검증과 장기 운영 승격은 아직 수행하지 않았으며 별도 사용자 승인 없이는 실행하지 않습니다.

## 지금 확인할 수 있는 것

- Next.js App Router 기반의 반응형 운영 화면
- 홈, 포트폴리오, 리밸런싱, 주문·기록, 문제 해결과 설정의 실제 라우트
- 토스증권 실제 보유자산, 마스킹 계좌와 수집 시각을 표시하는 Shadow 화면
- 접근 가능한 보유자산 표와 실제 수집·스냅샷 검사 기록
- 자산군 목표 초안의 원본 스냅샷 고정, 별도 적용, 새 스냅샷 고정과 설정 불일치 차단
- 모든 현재 보유종목을 `SAFE/CORE/SATELLITE` 중 정확히 한 곳에 분류하고 미분류 자산 차단
- 자산군 내부 현재 평가액 비율을 `PRESERVE_CURRENT_V1`로 결정론적 저장
- 미보유 종목이 포함된 자산군을 `EQUAL_V1` largest-remainder로 명시적 균등 배분
- 같은 설정 버전에서 한 종목의 복수 자산군 배정을 PostgreSQL UNIQUE로 차단
- `GET /internal/v1/instruments/search`에서 이전에 Toss로 검증한 `LOCAL_VALIDATED` 로컬 카탈로그만 읽기 전용 검색
- `POST /internal/v1/instrument-validations`에서 국내 코드·미국 티커를 Toss 기본정보와 유의사항으로 정확히 검증하고 append-only 증거 저장
- 상장 상태, 목표 편입 가능 여부와 현재 거래 차단 상태를 분리하고 미보유 목표 종목을 검증 증거 ID에 고정
- 관리 현금을 `고정 원화 금액` 또는 `평가에서 제외`로 명시하고, 미설정 상태는 가짜 값 없이 표시해 주문 계획 차단
- KRW·USD 매수 가능 금액을 관리 현금과 분리해 수집·표시
- 총 관리 자산을 `보유주식 평가액 + 관리 현금`으로 저장하고 DB 제약으로 검증
- 현재·목표·허용 범위와 서버 판정 상태를 함께 쓰는 비중 밴드
- 목표 비중만 입력하면 서버가 `MIXED_V1` 혼합 정책으로 하한·상한 자동 계산
- 같은 불변 snapshot에서 `SHADOW`, `PAPER`, `LIVE` 계획을 별도로 생성하고 plan hash 저장
- `logical_order_id` UNIQUE, 결정적 36자 `clientOrderId`, 일일 예약과 append-only 상태 이력을 사용하는 주문 원장
- 실제 호가·호가잔량·수수료를 사용하는 한국 지정가 `DAY` Paper 모의 체결과 보수적 부분체결
- 킬 스위치, 일일·단일·회전율·종목·자산군·위험자산 비중, stale quote, 장 상태, 거래 제한과 기존 미체결 주문을 차단하는 Risk Gate
- 운영 설정 DRAFT 저장과 별도 적용, 현재 계좌 서버 봉인, 별도 Live 승격과 주문별 최종 확인
- Tailscale 내부망과 Caddy 경계, loopback 전용 Web→Engine 내부 통신
- Live 주문 전 A 승인과 B dispatch claim의 일회성 봉인, 브로커 결과 대사, 안전한 취소와 `UNKNOWN_BLOCKED` exact 복구
- A 뒤 B가 전혀 없음을 DB가 증명한 경우에만 `REJECTED`로 종료하고 예약을 해제하는 비전송 복구
- B 뒤 응답 저장 중단은 외부 주문을 자동 귀속하지 않고 no-ID `UNKNOWN_BLOCKED`와 운영자 exact 복구로 처리
- `/orders`의 실제 주문 타임라인, 상태 재확인, 명시적 취소와 운영자 복구 UI
- `bigint` 교차곱으로 1bp 미만 이탈까지 감지하는 부동소수점 없는 포트폴리오 비중 계산
- `BAND_EDGE`·`TARGET` 복귀, 신규 현금 우선 배분, 한국 정수 수량 내림과 반올림 후 비중 재검증 순수 계산
- 통화별 금액, 소수 수량과 basis point 비중을 부동소수점 없이 보존하는 값 객체와 전수·불변식 테스트
- Zod로 검증하는 서버-클라이언트 대시보드 계약
- 토스증권 OpenAPI `1.2.4`의 30개 operation 타입과 호출 표면
  - OAuth 토큰 1개
  - 조회용 GET business operation 23개
  - 계좌를 변경하는 operation 6개
- OAuth 토큰 메모리 캐시와 동시 발급 single-flight
- 고정된 공식 origin, 공통 10초 timeout과 안전한 네트워크·HTTP 오류
- 401 토큰 무효화와 429 `Retry-After`·rate-limit group·request ID 메타데이터 추출
- 일반 `TossTradingApi` 쓰기 표면은 계속 하드 차단하고, 별도 `TossLiveOrderAdapter`만 만료되는 authorization과 감사 callback을 요구
- 계좌·보유·시세·호가·종목·주문 조회를 분리한 capability 기반 중립 포트
- 종목 정규 키는 `marketCountry(KR/US) + symbol`, 상장 시장은 별도 metadata로 분리
- Toss transport가 제공하는 read-only capability 18개와 write capability 미제공
- NestJS 11과 Fastify adapter 기반 별도 engine, Next.js Web/BFF의 모노레포 분리
- Prisma 7과 PostgreSQL 17 기반 계좌 참조·수집 실행·redacted 응답·불변 스냅샷
- Vercel web/engine 별도 Project, 평일 09:00 KST Cron과 PostgreSQL collection lease
- heartbeat와 fencing token 최종 재검증으로 만료된 수집기의 늦은 스냅샷 저장 차단
- `OPERATIONAL_CONFIG_V1` strict 계약과 직접 파싱되는 완전한 `config.example.yaml`
- PAPER 기본값, 데이터 신선도·거래 한도·비중 상한·킬 스위치와 제한적 KR live 승격 조건의 교차 검증

토스증권에는 확인된 별도 sandbox/paper 주문 서버가 없어 Paper는 애플리케이션 내부 모의 체결입니다. Live 코드는 존재하지만 실계좌 승격 검증 완료를 뜻하지 않습니다.

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

`apps/engine/.env.example`, `apps/web/.env.example`, `packages/database/.env.example`을 각각 같은 위치의 `.env.local`로 복사하고 로컬 값을 설정합니다. `DATABASE_URL`은 migration owner 전용이고 engine은 `DATABASE_RUNTIME_URL` 제한 역할로만 연결합니다. `db:migrate:deploy`는 migration 뒤 runtime role bootstrap을 실행하며, engine은 시작 시 owner·superuser·DDL·TRUNCATE·migration ledger 접근이 없는지 다시 검사합니다. Web에는 loopback engine 주소인 `ENGINE_INTERNAL_URL`만 설정하고, 토스 자격증명은 engine에만 둡니다. 두 프로세스는 `127.0.0.1`에만 bind하며 브라우저에서 `http://127.0.0.1:13000`을 엽니다.

첫 화면은 저장된 스냅샷이 없을 때 한 번 실제 계좌 수집을 시도합니다. 기본 흐름은 `포트폴리오 만들기`에서 안정형·균형형·성장형 중 투자성향을 고르고, 코드에 승인된 4개 ETF와 자동 계산된 목표 비중을 확인한 뒤 초안을 저장하는 것입니다. 추천안은 관리 현금을 평가에서 제외하고 현재 보유주식 전체를 재배분 대상으로 사용합니다. 추천 밖 기존 보유종목은 목표 0%로 두되 즉시 매도하지 않으며, 초안 적용과 별도 리밸런싱 계획 검토를 거쳐야 합니다. 종목 검색, 관리 현금, 자산군과 내부 비중 직접 편집은 고급 설정에 남아 있습니다.

이후 홈의 `최신 자산 가져오기`를 누르면 주문 없이 토스 보유자산·가격·환율·매수 가능 금액을 다시 조회해 새 불변 스냅샷으로 저장합니다. 수집에 실패하면 기존 스냅샷을 덮어쓰지 않고 문제 해결 화면에서 원인과 다음 행동을 확인합니다.

정상 검증 순서는 `Shadow 계획 → Paper 계획 및 실행 → 주문 원장 확인`입니다. Live를 사용하려면 설정에서 LIVE 초안을 저장·적용하고, 킬 스위치를 명시적으로 해제한 뒤 같은 설정을 극소액 Live로 별도 승격해야 합니다. 이후에도 Live 계획의 정확한 확인 문구와 주문별 승인, 주문 직전 조회를 다시 통과해야 하며 한 번에 첫 주문 한 건만 제출합니다. 개발·테스트 과정에서는 실제 계좌 주문을 호출하지 않습니다.

루트의 `config.example.yaml`은 운영 정책 계약 예제입니다. 정상 경로는 설정 화면에서 현재 계좌를 서버가 HMAC으로 봉인한 DRAFT를 만들고 해시·버전을 검토한 뒤 적용하는 흐름입니다. PAPER 기본값, quote·캘린더 신선도, 주문별·일별 한도, 회전율·비중 상한, 킬 스위치와 제한적 한국 Live 승격 조건은 [운영 설정 레퍼런스](docs/CONFIG.md)를 참고하세요.

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
├── common/audit/                    로컬 콘솔 감사 주체
├── common/auth/guards/              Vercel Cron 호출 검증
├── config/                          Zod 환경설정과 Config Module
├── infrastructure/prisma/           Prisma Module과 singleton PrismaService
└── modules/
    ├── system/                      운영 설정 기반 health endpoint
    ├── operational-config/          설정 버전·활성화·킬 스위치·Live 승격
    ├── orders/                      Paper/Live 실행·원장·취소·대사·복구
    └── portfolio/
        ├── presentation/            Controller
        ├── application/             Service, 수집 use case, presenter
        ├── domain/                  오류와 bigint 평가 로직
        └── infrastructure/          Toss adapter와 Prisma repository
```

## Vercel 운영

같은 Git 저장소에서 `apps/web`과 `apps/engine`을 각각 Vercel Project로 가져옵니다. PostgreSQL migration은 object owner/direct `DATABASE_URL`로만 수행하고, engine에는 별도로 만든 제한 역할의 pooled `DATABASE_RUNTIME_URL`만 주입합니다. Marketplace가 제공하는 owner 성격의 URL을 그대로 runtime에 사용하지 않습니다. migration 뒤 `pnpm db:bootstrap:runtime`을 실행해 현재 객체에 최소 권한을 다시 부여해야 하며 새 migration 객체는 bootstrap 전 자동 노출되지 않습니다.

engine 프로젝트의 Root Directory는 `apps/engine`으로 지정하고 외부 workspace source 포함을 활성화합니다. Framework, Build Command와 Output Directory는 override하지 않습니다. `src/main.ts`는 일반 Nest 애플리케이션과 동일하게 `NestFactory.create()`와 하나의 `app.listen()` 경로만 사용합니다. Vercel zero-config가 NestJS와 이 진입점을 자동 감지하므로 `vercel.json`에는 서울 리전과 Cron만 선언합니다. Vercel이 제공하는 `PORT`를 `ENGINE_PORT`보다 우선하고, 실행 시간과 메모리는 Fluid Compute와 충돌하지 않도록 Dashboard의 Functions 설정에서 관리합니다.

engine은 별도 webpack 번들을 만들지 않습니다. 로컬에서는 `tsx`로 실행하고, 배포에서는 Vercel의 NestJS zero-config 변환을 사용합니다. Vercel 함수 추적에 필요한 workspace 패키지만 배포 빌드 전에 CommonJS `dist`로 컴파일합니다.

토스증권은 허용 IP를 요구하므로 engine 프로젝트에서 Vercel Pro Static IPs 또는 Enterprise Secure Compute를 활성화해야 합니다. 해당 IP를 토스증권에 등록한 뒤에만 `TOSS_EGRESS_ALLOWLIST_CONFIRMED=true`를 설정하세요. 일반 Vercel 동적 출구 IP에서는 실제 수집이 코드에서 차단됩니다.

Production migration 환경에는 owner `DATABASE_URL`을, engine에는 제한 `DATABASE_RUNTIME_URL`, `TOSSINVEST_CLIENT_ID`, `TOSSINVEST_CLIENT_SECRET`, `ACCOUNT_REFERENCE_KEY`, `CRON_SECRET`을 민감 환경변수로 설정합니다. Web에는 `ENGINE_INTERNAL_URL`만 설정합니다. Host-run production에서는 engine을 `127.0.0.1`에만 bind하고 Tailscale 내부망과 Caddy가 Web 진입점만 제공합니다. 일반 engine route에는 애플리케이션 토큰이 없으므로 보호되지 않은 공개 URL로 배포하지 않습니다. Vercel 배포 시 두 Project에 Deployment Protection을 적용해야 하며, 보호된 Web→Engine 통신은 운영 사용 전에 별도로 검증해야 합니다. `CRON_SECRET`은 Vercel Cron이 공식 `Authorization` 헤더로 전달하는 호출 검증 값입니다. Preview에는 운영 토스 키를 주입하지 않는 것을 기본으로 합니다.

로컬 환경변수도 같은 권한 경계를 사용합니다. Web은 `apps/web/.env.local`, engine은 `apps/engine/.env.local`, Prisma migration은 `packages/database/.env.local`을 읽습니다. `.env.local`은 Git에 포함하지 않으며, `vercel env pull`은 파일을 덮어쓰므로 앱별 파일에 수동 override와 Vercel pull 결과를 섞지 않습니다.

## 안전 원칙

- 기본 실행 모드는 항상 `paper`입니다.
- 금액과 수량 계산에 부동소수점을 사용하지 않습니다.
- 외부 데이터는 관측 시각이 있는 불변 스냅샷으로 고정한 뒤 계산합니다.
- API 오류, 데이터 누락과 상태 불명 주문에서는 fail closed 합니다.
- `buying power`를 검증된 평가용 현금으로 간주하지 않습니다.
- 설정 저장, 계획 생성과 주문 제출을 서로 다른 동작으로 유지합니다.
- 브라우저에서 증권사 API를 직접 호출하거나 비밀정보를 전달하지 않습니다.
- Live 코드가 존재해도 기본 PAPER, 별도 설정 적용, 킬 스위치 해제, 계좌 allowlist, 승격, 주문별 승인과 pretrade 검증 없이는 실제 주문을 전송하지 않습니다.
- 실제 계좌 극소액 검증과 장기 운영 승격은 코드 구현과 별도이며 명시적인 사용자 승인 없이 수행하지 않습니다.

Web GUI는 목표·운영 설정, 계획, Paper/Live 실행, 상태 확인, 취소와 UNKNOWN 복구를 공통 엔진 서비스로 제공합니다. 동일 기능의 CLI `setup`, `doctor`, `check`, `plan`, `run`, `status`, `explain`, `recover`와 전용 doctor/explain 화면은 [구현 계획](docs/TODO.md)에서 계속 추적합니다.

## 디자인 기준

생산 Web GUI는 `packages/ui`를 시각 구현의 기준으로 사용합니다.

- 행동·안전·접근성 계약: [Web GUI 설계](docs/WEB_UI.md)
- 생산 토큰과 컴포넌트: `packages/ui/src`
- 토큰 호환 진입점: `design/tokens.css`
- 초기 상태·레이아웃 탐색물: `prototype/index.html`

프로토타입은 참고용이며 실제 금융 계산이나 주문 판단을 수행하지 않습니다. 생산 화면은 엔진이 PostgreSQL에 저장한 토스증권 실계좌 스냅샷만 사용합니다. 목표 설정이 없거나 활성 버전이 최신 스냅샷에 고정되지 않았거나 관리 현금 포함·제외 정책이 새 스냅샷에 반영되지 않으면 주문 계획을 차단합니다.

## 문서

- [시스템 명세](docs/SPEC.md)
- [구현 계획](docs/TODO.md)
- [Web GUI 설계](docs/WEB_UI.md)
- [운영 설정 레퍼런스](docs/CONFIG.md)
- [토스증권 API 연동](docs/API_TOSS.md)
- [제한형 Live 코드 안전 리뷰](docs/LIVE_SAFETY_REVIEW.md)
- [아키텍처 결정 기록](docs/adr/0001-typescript-hexagonal-monorepo.md)
- [NestJS engine 결정 기록](docs/adr/0002-nestjs-engine-on-vercel.md)
- [한국 시장 첫 live 범위 결정 기록](docs/adr/0003-korean-market-first-live-scope.md)
- [승인 전용 일회성 Live dispatch 결정 기록](docs/adr/0004-authorized-one-shot-live-dispatch.md)
- [에이전트 작업 지침](AGENTS.md)

## 개발 단계

1. 순수 계산과 읽기 전용 합성 데이터 수직 슬라이스 (완료)
2. Prisma/PostgreSQL 저장소와 감사 가능한 실계좌 스냅샷 (완료)
3. 토스증권 조회 API를 연결한 shadow 모드 (완료)
4. 자체 모의 체결기를 사용하는 Paper 모드 (완료)
5. 위험 차단, 주문 원장, 멱등성과 안전한 Live 코드 경로 (완료)
6. 장기 Shadow/Paper 관찰, 명시적 극소액 실계좌 검증과 운영 런북 검증 (미완료)

## 주의

이 프로젝트는 투자 수익을 보장하지 않습니다. 리밸런싱은 수익 예측 기능이 아니라 목표 위험 수준을 유지하기 위한 통제 장치입니다. 세금, 계좌 유형, 환전, 상품 구조와 개인 재무 상황은 소프트웨어 외부에서 별도로 검토해야 합니다.
