# 컴포넌트

## 공통 패키지 구현

- `Button`: primary/secondary, native disabled와 44px 최소 높이
- `Badge`: neutral/normal/attention/blocked/info와 선택적 상태 점
- `Surface`: 공통 surface 조합
- `StatusBanner`: 아이콘, eyebrow, 제목, 설명과 선택적 action
- `SummaryCard`: label, value, description과 강조 수준
- `AllocationBand`: 같은 0~100% 축의 현재·목표·허용 범위와 텍스트 설명

## 첫 생산 화면 구현

- 데스크톱 sidebar와 반응형 app shell
- Paper, 마스킹 계좌, 관측 시각, 시스템과 실주문 차단 safety bar
- `데모 · 합성 데이터`와 broker 미연결을 명시하는 상태
- 상태 결론, 포트폴리오 요약, 금액 숨김
- 비중 밴드와 최근 활동
- 비중 이탈은 attention, 데이터·주문 실패는 blocked로 분리
- 리밸런싱 필요 여부는 표시하지만 주문 계획·예상 금액은 생성하지 않음
- 실제 주문이 연결되지 않았음을 설명하는 비활성 action
- 홈 이외 내비게이션은 링크가 아닌 `준비 중` 비활성 상태

Button, StatusBanner와 AllocationBand는 정적 렌더링 계약 테스트를 갖습니다. AllocationBand의 0.01bp 단위 값은 표시용이고 실제 이탈 상태는 서버의 `bigint` 교차곱으로 만든 `bandStatus`를 따릅니다.

계획 표, 위험 체크리스트, 영수증, 타임라인, 설정과 복구 컴포넌트는 미구현입니다.
