# 요약

정적 프로토타입의 시각 개념을 생산 `packages/ui` 디자인 시스템으로 옮겼습니다. 원시·의미·컴포넌트 토큰을 분리하고, 공통 surface·button·badge·status·summary·allocation 컴포넌트를 Next.js 첫 화면에서 사용합니다.

화면은 합성 데이터의 Paper 상태만 다루며 비중 이탈을 attention 상태의 `REBALANCE_REQUIRED`로 표시하고 실주문 차단을 별도 blocked 상태로 항상 보여줍니다. 미구현 내비게이션은 `준비 중`으로 비활성화했습니다. 주문 계획과 예상 금액은 아직 없고 실거래는 연결되지 않았습니다. Storybook과 정식 접근성 검증은 후속 범위입니다.
