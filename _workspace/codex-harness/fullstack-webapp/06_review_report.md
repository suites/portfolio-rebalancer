# 통합 리뷰 보고서

## 통과한 경계

- 도메인 계산이 Toss와 Next.js에 의존하지 않습니다.
- 금융 값은 `bigint`·decimal 문자열·basis point로 처리합니다.
- 브라우저는 broker 또는 secret에 접근하지 않습니다.
- 공식 Toss 30개 operation과 명시적 method parity를 테스트합니다.
- 공식 origin, 10초 timeout, 안전 오류와 `401`/`429` 메타데이터를 테스트합니다.
- Toss transport descriptor는 read-only capability 18개만 설명하며 write capability가 없습니다. 실제 계좌와 중립 어댑터는 미연결입니다.
- 계좌 변경 6개 메서드는 `TOSS_LIVE_TRADING_DISABLED`로 fetch 전에 무조건 차단됩니다.
- 생산 UI는 공통 토큰과 컴포넌트를 사용합니다.
- 비중 이탈은 attention, 데이터·주문 차단은 blocked로 구분하며 컴포넌트 계약을 테스트합니다.
- 개발·production 서버는 `127.0.0.1`에 바인딩됩니다.
- 합성 데이터로 자격증명 없이 첫 화면을 실행할 수 있습니다.

## 현재 한계

- 실제 Toss 조회와 중립 adapter는 미구현입니다.
- DB, 주문 원장, Risk Gate, paper executor와 복구는 미구현입니다.
- `REBALANCE_REQUIRED`는 비중 이탈 결론일 뿐 주문 계획이 아닙니다.
- Storybook, axe, VoiceOver와 E2E는 아직 없습니다.
- 배포·CI·운영 관측성은 없습니다.

## 리뷰 결론

첫 읽기 전용 수직 슬라이스와 확장 가능한 전송 기반으로는 적합합니다. 실계좌 조회나 주문 실행 준비가 되었다고 판단할 수는 없습니다. 다음 단계는 합성 fixture로 검증하는 Toss 중립 read adapter와 DB 원장 설계이며, 쓰기 활성화 경로는 executor·ledger·멱등성·한도·복구 리뷰 전까지 추가하지 않습니다.
