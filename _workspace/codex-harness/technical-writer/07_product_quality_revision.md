# Product Quality Revision

사용자 지시에 따라 축소형 MVP 프레이밍을 제거했다.

- 최종 목표를 실제 계좌에서 지속적으로 사용하는 운영 품질로 명시
- 주문 원장, 멱등성, 부분체결, 두 단계 주문, 위험 차단과 복구 요구 유지
- 내부 복잡성을 사용자에게 노출하지 않는 운영 인터페이스 추가
- `setup`, `doctor`, `check`, `plan`, `run`, `status`, `explain`, `recover` 계약 정의
- Quick Start, demo fixture, 한국어 오류 행동 지침과 거래 영향 미리보기를 초기 작업으로 승격
- 실거래 검토 단계를 선택 기능이 아니라 필수 운영 승격 조건으로 재정의
