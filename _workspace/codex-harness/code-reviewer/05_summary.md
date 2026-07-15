# Review Summary

- V0 calculator: 구현 가능
- V1 read-only shadow: 구현 가능
- V2 simple paper: 구현 가능
- 현재 TODO 96개 전체: 가능하지만 초보 MVP로 과도함
- 완전 자동 live: 현금 source와 모호한 주문 복구를 실계좌로 검증하기 전에는 준비 미완료

우선 수정 권고:

1. MVP를 calculator, shadow, basic paper, live hardening으로 다시 정의한다.
2. README 현금 예시를 실행 가능하게 고친다.
3. Quick Start와 demo fixture를 Phase 0으로 올린다.
4. 상태 모델과 함께 status, explain, recover UX를 구현한다.
5. 종목·비중 변경 전 config diff와 plan preview를 제공한다.
