# Portfolio Rebalancer

`portfolio-rebalancer`는 사람이 승인한 장기 목표 비중을 결정론적으로 점검하고, 불확실한 상황에서는 거래하지 않는 개인용 자산배분 시스템입니다. 시장 예측이나 종목 추천보다 계산 재현성, 장애 안전성, 주문 멱등성과 감사 가능성을 우선합니다.

> 현재 상태: 첫 번째 읽기 전용 수직 슬라이스가 구현되었습니다. 합성 포트폴리오 스냅샷을 순수 도메인 계산기로 평가하고, 검증된 서버 계약을 통해 반응형 Web GUI에 표시합니다. 토스증권 공식 OpenAPI 전체를 타입 안전한 전송 계층으로 동기화했지만, 실제 계좌 조회·상태 저장·paper 체결·실거래는 아직 연결하지 않았습니다. 실거래 쓰기 전송은 코드에서 하드 차단됩니다.

## 지금 확인할 수 있는 것

- Next.js App Router 기반의 반응형 운영 화면
- 합성 데이터·브로커 미연결을 명시한 Paper 안전 상태와 금액 숨김
- 현재·목표·허용 범위와 서버 판정 상태를 함께 쓰는 비중 밴드
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

이 범위는 실제 주문 기능이 아닙니다. 토스증권에는 확인된 별도 sandbox/paper 서버가 없으므로 향후 paper 체결은 애플리케이션 내부에서 구현합니다.

## 빠른 시작

요구사항:

- Node.js 22 이상
- pnpm 10.28.0

```bash
pnpm install
pnpm dev
```

브라우저에서 `http://127.0.0.1:3000`을 엽니다. 개발 서버와 production start는 모두 `127.0.0.1`에만 바인딩됩니다. 화면은 자격증명이나 실제 계좌 없이 합성 데이터로 동작하며 주문을 제출하지 않습니다.

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
└── web/                 Next.js Web GUI와 서버 전용 조합 계층
packages/
├── domain/              bigint 기반 값 객체와 순수 비중 계산
├── broker/              증권사 중립 모델, capability와 좁은 포트
├── broker-toss/         고정 OpenAPI, 생성 타입, OAuth와 Toss 전송 계층
├── application/         유스케이스와 화면용 스냅샷 조합
├── contracts/           서버 경계의 Zod 계약
└── ui/                  primitive·semantic·component 토큰과 공통 컴포넌트
```

의존성은 도메인 안쪽을 향합니다. 브라우저는 토스증권 API나 비밀정보에 접근하지 않고, 서버가 애플리케이션 서비스로 만든 검증된 계약만 받습니다. 다른 증권사는 `packages/broker`의 capability와 포트를 구현하는 별도 어댑터로 추가합니다. 자세한 결정은 [아키텍처 결정 기록](docs/adr/0001-typescript-hexagonal-monorepo.md)에 있습니다.

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

프로토타입은 참고용이며 실제 금융 계산이나 주문 판단을 수행하지 않습니다. 현재 생산 화면도 합성 데이터만 사용합니다.

## 문서

- [시스템 명세](docs/SPEC.md)
- [구현 계획](docs/TODO.md)
- [Web GUI 설계](docs/WEB_UI.md)
- [토스증권 API 연동](docs/API_TOSS.md)
- [아키텍처 결정 기록](docs/adr/0001-typescript-hexagonal-monorepo.md)
- [에이전트 작업 지침](AGENTS.md)

## 개발 단계

1. 순수 계산과 읽기 전용 합성 데이터 수직 슬라이스
2. 설정 검증, 저장소와 감사 가능한 스냅샷
3. 토스증권 조회 API를 연결한 shadow 모드
4. 자체 모의 체결기를 사용하는 paper 모드
5. 위험 차단, 주문 원장, 멱등성과 장애 복구
6. 모든 승격 조건과 별도 검토를 통과한 뒤 제한적 실거래 검토

## 주의

이 프로젝트는 투자 수익을 보장하지 않습니다. 리밸런싱은 수익 예측 기능이 아니라 목표 위험 수준을 유지하기 위한 통제 장치입니다. 세금, 계좌 유형, 환전, 상품 구조와 개인 재무 상황은 소프트웨어 외부에서 별도로 검토해야 합니다.
