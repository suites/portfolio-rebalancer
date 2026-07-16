# 테스트 범위

이번 작업의 검증 대상은 첫 읽기 전용 수직 슬라이스와 Toss 전송 기반입니다.

- `packages/domain`: decimal, money와 정밀 allocation 밴드 순수 계산
- `packages/application`: 데이터 신뢰, 허용 범위·현금 검증과 dashboard 결론 도출
- `packages/contracts`: 브라우저 데이터 runtime 계약
- `packages/broker`: 세분화된 조회 포트와 capability fail-closed
- `packages/broker-toss`: parity, read-only transport descriptor, OAuth, 안전 전송 오류와 쓰기 하드 차단
- `packages/ui`: 공통 컴포넌트 정적 렌더링 계약
- `apps/web`: 안전 기본 상태 route

실제 계좌, DB, paper executor, live 주문과 E2E는 구현되지 않아 현재 테스트 범위가 아닙니다.

## 2026-07-17 Runtime DB role slice

- URL resolver와 engine config의 migration/runtime secret 경계
- bootstrap SQL의 role flags, ownership, PUBLIC/default privilege, DML allowlist
- engine startup의 runtime identity fail-closed 검사
- 격리 PostgreSQL에서 정상 append-only/lease/terminal update
- runtime의 UPDATE/DELETE/TRUNCATE/trigger DDL/session replication/migration ledger 거부
