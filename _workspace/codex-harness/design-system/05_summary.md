# 요약

정적 프로토타입의 시각 개념을 생산 `packages/ui` 디자인 시스템으로 옮겼습니다. 원시·의미·컴포넌트 토큰을 분리하고, 공통 surface·button·badge·status·summary·allocation 컴포넌트를 Next.js 첫 화면에서 사용합니다.

화면은 합성 데이터의 Paper 상태만 다루며 비중 이탈을 attention 상태의 `REBALANCE_REQUIRED`로 표시하고 실주문 차단을 별도 blocked 상태로 항상 보여줍니다. 미구현 내비게이션은 `준비 중`으로 비활성화했습니다. 주문 계획과 예상 금액은 아직 없고 실거래는 연결되지 않았습니다. Storybook과 정식 접근성 검증은 후속 범위입니다.

## 이번 작업

운영 콘솔 전 화면에 공통 최상위 수직 리듬을 적용했습니다. 제품 문구는 현재 상태와 다음 행동에 집중하고, 정적 아키텍처·보안 경계·미구현 설명은 사용자 콘텐츠에서 제거했습니다.

Prettier, ESLint, Web 타입 검사, Web 테스트 8개, production build, 주요 화면 HTTP 응답과 모바일 Chrome 캡처를 검증했습니다.
