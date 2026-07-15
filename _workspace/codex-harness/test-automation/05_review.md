# 테스트 리뷰

현재 테스트는 첫 수직 슬라이스의 가장 위험한 불변식인 정밀 밴드 계산, 입력 일관성, 결론 도출, 공식 API parity, read-only transport descriptor, OAuth single-flight, 안전 전송 오류와 쓰기 하드 차단을 직접 검증합니다. 외부 시스템은 fetch 경계에서만 mock해 대상 행동을 가리지 않습니다.

`REBALANCE_REQUIRED`는 주문 계획이 아니라 검증된 비중 이탈 결론으로 테스트되어야 합니다. 쓰기 메서드 테스트는 항상 fetch 미호출과 `TOSS_LIVE_TRADING_DISABLED`를 함께 주장해야 합니다.

현재 테스트만으로 실계좌 조회, DB 정합성, paper 체결 또는 live 안전성을 주장할 수 없습니다. 다음 구현에서는 합성 Toss fixture 기반 중립 adapter 테스트와 원장 transaction 테스트를 먼저 추가해야 합니다.
