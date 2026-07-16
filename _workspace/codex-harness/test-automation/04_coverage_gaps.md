# 커버리지 공백

## 우선순위 높음

- Toss GET 응답의 runtime validation과 중립 모델 변환
- 네트워크 실패, caller abort, 403과 5xx 세부 오류 회귀
- rate-limit 그룹별 limiter와 자동 재시도 정책
- 미검증 현금과 stale 데이터의 계산 차단
- band-edge/target 복귀 정책, 수량·비용 반올림
- SQLite UNIQUE, transaction, lease와 append-only 원장
- `clientOrderId` 36자 및 9:59/10:01 경계
- `UNKNOWN_BLOCKED` 재제출 금지와 재시작 대사

## UI

- 금액 숨김 interaction
- `NO_ACTION`, `REBALANCE_REQUIRED`, `BLOCKED`, `UNKNOWN` 렌더링
- 320/390px reflow, 키보드, axe와 VoiceOver

## 운영

- API schema 변경 감지 CI
- log와 모든 오류 경로의 secret 마스킹
- 프로세스 종료·저장 실패·알림 실패 복구

## Runtime DB role 후속 공백

- 실제 Supabase/Supavisor custom role bootstrap과 pooled URL 표본
- production migration identity가 CREATEROLE/DB owner인지 배포 전 doctor 검사
- future migration이 새 `FOR UPDATE` 대상을 추가할 때 allowlist 누락을 자동 탐지하는 catalog contract
