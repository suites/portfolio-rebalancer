# 스토리와 문서

Storybook은 아직 구성되지 않았습니다. 현재 실행 가능한 예시는 Next.js 첫 화면과 정적 프로토타입입니다.

Storybook 이전의 최소 계약은 Vitest 정적 렌더링 테스트로 유지합니다. 현재 Button disabled, StatusBanner accessible ID, AllocationBand attention 상태와 텍스트 설명을 검증합니다.

생산 컴포넌트의 후속 Storybook 범위:

- `Button`: primary, secondary, disabled, focus
- `Badge`: 모든 tone과 dot 유무
- `StatusBanner`: normal, attention, blocked, unknown
- `SummaryCard`: 기본, 강조, 값 확인 불가
- `AllocationBand`: 범위 안, 하한 미만, 상한 초과, 경계값
- app shell: desktop, tablet, 390px와 320px

행동·안전·접근성은 `docs/WEB_UI.md`, 구현 상태는 `docs/TODO.md`, 토큰과 컴포넌트 사용은 `packages/ui`를 기준으로 합니다.

## 이번 작업

- `docs/WEB_UI.md`에 공통 최상위 간격과 구현 설명을 제품 문구로 노출하지 않는 규칙을 추가했습니다.
- `docs/TODO.md`에 콘솔 간격·문구 개선 완료 상태를 기록했습니다.
