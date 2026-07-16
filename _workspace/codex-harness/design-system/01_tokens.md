# 토큰

생산 CSS는 세 계층으로 분리했습니다.

- `primitives.css`: blue/neutral/status palette, spacing과 radius 원시값
- `semantic.css`: canvas/surface/text/border/primary와 상태 의미, typography, shadow, layout
- `components.css`: control 최소 높이, card padding, safety bar height

상태는 `normal`, `attention`, `blocked`, `pending`, `unknown`을 별도 foreground/background 쌍으로 정의합니다. primary는 일반 본문 대비를 고려한 짙은 blue를 사용하며 매수·매도 색상은 텍스트 설명을 대체하지 않습니다. 숫자에는 tabular numerals를 적용합니다.

`design/tokens.css`는 생산 토큰 계층을 import하는 호환 진입점입니다. 새 토큰은 `packages/ui/src/styles`에 먼저 추가합니다.

## 이번 작업

- 카드 내부는 기존 `--card-padding`을 유지했습니다.
- 최상위 섹션과 카드 그리드 간격을 `1.125rem`으로 통일했습니다.
- 모바일 카드 패딩 `1.125rem`은 유지했습니다.
- 색상, 그림자, 반경과 타이포그래피 토큰은 추가하지 않았습니다.
