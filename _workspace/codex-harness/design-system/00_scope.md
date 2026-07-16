# 범위

- 대상: `packages/ui` 생산 디자인 시스템과 `apps/web` 첫 읽기 전용 화면
- 목표: 모던하고 차분한 자산관리 UI, 일관된 상태 표현과 재사용 가능한 토큰·컴포넌트
- 생산 산출물: `packages/ui/src/styles`, `packages/ui/src/*.tsx`, `apps/web/src/features/overview`
- 호환 산출물: `design/tokens.css`
- 행동 기준: `docs/WEB_UI.md`
- 참고자료: `prototype/`

제외 범위는 Storybook, 실제 계좌 데이터, 주문 계획·체결·복구 UI와 live 실행입니다. 프로토타입은 더 이상 생산 시각 구현의 source of truth가 아닙니다.

## 이번 작업

- 모드: 컴포넌트와 간격 토큰 검토
- 대상: `apps/web/src/features`의 생산 콘솔 화면
- 목표: 데스크톱·모바일 최상위 섹션 간격 통일, PRD·구현 설명 제거, 실제 안전 상태와 다음 행동 유지
- 기준: 사용자가 제공한 `/settings` 모바일 스크린샷
