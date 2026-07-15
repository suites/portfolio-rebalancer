# 아키텍처

## 선택

- 런타임: Node.js 22 이상
- workspace: pnpm 10.28.0
- Web: Next.js 16 App Router, React 19, server-only 조합
- 언어: TypeScript strict
- 계약: Zod
- 테스트: Vitest
- API 타입: 고정 OpenAPI 3.1 스냅샷 + openapi-typescript + openapi-fetch
- 스타일: CSS custom properties와 CSS Modules

## 패키지 경계

```text
apps/web
  -> application + contracts + ui
  -> 서버 조합에서 broker-toss를 읽음

application -> domain + broker
broker      -> domain
broker-toss -> broker + domain
contracts   -> 독립 런타임 스키마
ui          -> React 표현 컴포넌트
```

`domain`은 네트워크와 시스템 시각을 모르고 `bigint`와 basis point로 계산합니다. 밴드 판정은 표시용 bp를 내림하지 않고 평가액과 전체 평가액의 교차곱을 비교합니다. `broker`는 증권사 capability와 계좌·보유·시세·호가·종목·캘린더·주문·pretrade 조회 포트를 정의합니다. `broker-toss`는 토스 원본 타입과 전송만 소유합니다. Web 클라이언트는 broker 패키지를 import하지 않고 서버가 만든 계약만 표시합니다.

## 첫 수직 슬라이스

```text
server-only synthetic fixture
  -> application.buildDashboardSnapshot
  -> domain.calculateAllocationSnapshot
  -> contracts.DashboardSnapshotSchema
  -> OverviewScreen
```

데이터 신뢰 상태가 `BLOCKED` 또는 `UNKNOWN`이면 밴드 이탈보다 해당 차단 결론을 우선합니다. `VERIFIED` 상태에서 이탈이 있으면 `REBALANCE_REQUIRED` 결론을 만들지만 주문 계획이나 예상 금액을 만들었다고 표현하지 않습니다.

현재 계약은 `dataSource: SYNTHETIC`, `brokerConnection: NOT_CONNECTED`를 강제해 데모 데이터를 실제 계좌처럼 오인하지 않게 합니다.

## 브로커 확장

새 증권사는 `packages/broker-{id}`에서 capability를 선언하고 중립 포트를 구현합니다. 지원하지 않는 기능은 생략하고 `BROKER_CAPABILITY_UNAVAILABLE`로 fail closed 합니다. Toss transport는 공식 parity를 위한 쓰기 메서드 6개를 보유하지만 transport descriptor는 read-only capability 18개만 설명합니다. 중립 어댑터와 실제 계좌 연결은 아직 없으며, 쓰기 capability도 없습니다. 모든 계좌 변경 메서드는 `TOSS_LIVE_TRADING_DISABLED`로 하드 차단합니다.

세부 결정은 `docs/adr/0001-typescript-hexagonal-monorepo.md`를 따릅니다.
