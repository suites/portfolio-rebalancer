# 데이터베이스 상태와 요구사항

## 현재 상태

데이터베이스는 아직 선택·구현하지 않았습니다. SQLite 파일, migration, ORM/query builder와 repository 코드는 없습니다. 합성 대시보드 스냅샷은 프로세스 안에서 생성되며 영속화되지 않습니다.

## 구현 전 확정할 최소 요구사항

- 불변 입력 스냅샷과 설정 버전
- `rebalance_run`, 계획 버전과 위험 검사 결과
- `logical_order_id` UNIQUE 제약
- 주문 원본 상태와 정규화 상태의 분리
- append-only 주문 상태 전이
- 계좌 단위 lease, heartbeat와 stale lock 복구
- 일일 한도 확인·예약과 주문 계획 저장의 단일 트랜잭션
- request ID와 마스킹된 감사 정보
- secret와 전체 계좌번호 저장 금지

## 결정 보류

SQLite는 단일 사용자·단일 호스트 기본 후보입니다. 라이브러리, migration 방식, transaction API와 백업 정책은 원장 불변식과 복구 시나리오를 테스트로 먼저 확정한 뒤 별도 ADR에서 결정합니다. 따라서 이 문서는 구현된 ERD나 migration으로 간주하지 않습니다.
