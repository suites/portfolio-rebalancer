# Web GUI 디자인 시스템 기록

## source of truth

1. 행동·안전·접근성: `docs/WEB_UI.md`
2. 생산 토큰·컴포넌트: `packages/ui/src`
3. 호환 토큰 경로: `design/tokens.css`
4. 초기 탐색 참고: `prototype/`

## 현재 화면 계약

서버 전용 합성 스냅샷을 애플리케이션 서비스가 계산하고 Zod로 검증한 뒤 화면에 전달합니다. `VERIFIED` 데이터가 밴드를 벗어나면 attention 상태의 `REBALANCE_REQUIRED`이고, 주문 계획이 준비됐다는 뜻은 아닙니다. 화면 값은 0.01bp 단위까지 제공하지만 정확한 판정은 `bigint` 교차곱으로 만든 `bandStatus`를 사용합니다. `BLOCKED`와 `UNKNOWN`은 새 주문이 불가능한 별도 blocked 상태로 표현합니다.

브라우저는 비중 판단, 증권사 호출과 secret 처리를 하지 않습니다. safety bar는 실주문 차단을 항상 표시합니다. 현재 action과 미구현 내비게이션은 이유와 `준비 중` 상태를 설명하며 비활성입니다.

## 후속 기준

Storybook 상태 문서, 접근 가능한 정확 수치 표, loading/empty/stale/unknown 공통 상태, 계획 검토와 복구 UI를 구현한 뒤 axe·키보드·VoiceOver·reflow 검증을 수행합니다.
