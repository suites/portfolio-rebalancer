# 테스트 리뷰

현재 테스트는 첫 수직 슬라이스의 가장 위험한 불변식인 정밀 밴드 계산, 입력 일관성, 결론 도출, 공식 API parity, read-only transport descriptor, OAuth single-flight, 안전 전송 오류와 쓰기 하드 차단을 직접 검증합니다. 외부 시스템은 fetch 경계에서만 mock해 대상 행동을 가리지 않습니다.

`REBALANCE_REQUIRED`는 주문 계획이 아니라 검증된 비중 이탈 결론으로 테스트되어야 합니다. 쓰기 메서드 테스트는 항상 fetch 미호출과 `TOSS_LIVE_TRADING_DISABLED`를 함께 주장해야 합니다.

현재 테스트만으로 실계좌 조회, DB 정합성, paper 체결 또는 live 안전성을 주장할 수 없습니다. 다음 구현에서는 합성 Toss fixture 기반 중립 adapter 테스트와 원장 transaction 테스트를 먼저 추가해야 합니다.

## Runtime DB role review

권한 부재만 확인하지 않고 실제 제한 role로 정상 app 쓰기 경로와 공격 경로를 모두 실행한다.
행 잠금에 필요한 UPDATE grant는 과도한 권한처럼 보일 수 있으므로, 해당 relation의
append-only trigger가 직접 UPDATE를 계속 거부하는 회귀도 함께 고정한다.

최종 결과:

- fresh PostgreSQL 17에 20개 migration 적용 후 bootstrap 통과
- 실제 runtime role integration 5/5 통과
- database unit/contract 82/82 통과
- engine regression 175/175 통과
- database/engine typecheck 및 Prisma validate 통과

## Live dispatch DB safety review

- static migration/runtime grant contract 11/11 통과
- fresh PostgreSQL 17 전체 migration 21/21 적용 통과
- focused order/runtime integration 22/22 통과
- 전체 database integration 43/43 통과
- database static/unit 89/89 통과
- Prisma validate/generate와 database TypeScript typecheck 통과
- 실제 Toss 주문 호출은 테스트하지 않았고 모든 broker outcome은 합성 DB fixture만 사용했다.
