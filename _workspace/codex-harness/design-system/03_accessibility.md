# 접근성

## 코드에 적용된 항목

- 문서 `lang="ko"`
- 본문 건너뛰기 링크
- `aside`, `nav`, `header`, `main`, `section` landmark와 heading 구조
- native button과 disabled 상태
- 금액 숨김의 `aria-pressed`
- 비중 밴드의 현재·목표·허용 범위 accessible name
- 상태를 색상 외 badge, 아이콘, 제목과 설명으로 표현
- focus-visible 스타일과 44px control 최소 높이
- reduced-motion와 forced-colors 스타일 기반
- 미구현 내비게이션을 비활성 텍스트와 `준비 중`으로 명시
- Button native disabled, StatusBanner 고유 ID와 AllocationBand 설명의 정적 테스트

## 아직 검증하지 않은 항목

- axe/WCAG 2.2 AA 자동 검사
- 전체 키보드 흐름과 포커스 순서
- macOS VoiceOver와 Safari
- 200% 확대, 320px reflow와 forced-colors 수동 검사
- 모든 상태와 오류의 screen reader 공지

현재 코드는 접근성 기반을 적용했지만 WCAG 2.2 AA 검증 완료로 표시하지 않습니다.

## 이번 작업

- 설정 요약 카드의 heading 순서를 `h1 → h3`에서 `h1 → h2`로 바로잡았습니다.
- 비중 입력의 `fieldset`, `legend`, native label과 44px 최소 높이를 유지했습니다.
- 모바일 섹션 헤더를 세로 배치해 긴 문구와 배지가 서로 압박하지 않게 했습니다.
- 안전 상태를 색상 외 텍스트로 계속 표시합니다.
