# Data Model

계좌 참조, 버전 목표 설정, 수집 실행, redacted evidence, 불변 snapshot/holding/check,
그리고 수평 실행용 runtime lease를 분리한다. 전체 계좌번호와 access token은 저장하지 않는다.

## BrokerRequestAttempt

- workflow type + correlation UUID로 collection, doctor, validation, plan을 공통 추적한다.
- collection run FK는 계좌 선택 전 호출과 doctor를 위해 nullable이다.
- operation ordinal과 1-based attempt를 분리해 429 retry를 중복 없이 기록한다.
- HTTP와 rate-limit metadata는 명시적 nullable 열로 저장한다.
- redacted request summary는 JSON object만 허용한다.
