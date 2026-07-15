# 입력과 범위

## 사용자 목표

- 모던하고 유지보수하기 좋은 기술과 구조로 개발한다.
- 디자인 시스템으로 컴포넌트 일관성을 유지한다.
- 처음 보는 사용자도 쉽게 상태와 다음 행동을 이해하게 한다.
- 토스증권 공식 OpenAPI 전체의 타입 안전한 호출 표면을 제공한다.
- 다른 증권사를 쉽게 추가할 수 있도록 브로커 경계를 추상화한다.

## 적용한 현재 범위

- 기존 설계 저장소에 첫 번째 읽기 전용 수직 슬라이스 구현
- 합성 스냅샷 → 순수 도메인 계산 → Zod 계약 → Next.js Web GUI
- 공식 Toss OpenAPI 고정·타입 생성·OAuth와 안전 오류 전송 계층
- Toss read-only capability 18개와 증권사 중립 조회 포트
- primitive·semantic·component 토큰과 공통 UI 컴포넌트
- 단위·계약·route 테스트와 통합 검증 명령
- UI 컴포넌트 계약 테스트와 V8 coverage 명령

## 명시적 제외

- 실제 계좌 호출과 자격증명 구성
- SQLite, migration, 원장과 append-only 상태
- 주문 계획, 예상 주문 금액과 paper 체결
- live 주문 활성화와 실제 주문 endpoint 호출
- 배포와 CI/CD

계좌 변경 operation 6개는 타입과 명시적 메서드만 유지하며 `TOSS_LIVE_TRADING_DISABLED`로 네트워크 전에 무조건 차단합니다. 안전한 executor와 ledger가 설계되기 전에는 활성화 경로가 없습니다.
