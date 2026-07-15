# 테스트 전략

## 위험 우선순위

1. 쓰기 메서드가 외부 요청을 보내는 회귀
2. 표시용 bp 내림으로 1bp 미만 이탈을 놓치는 정밀도 오류
3. 호출자가 거래 결론을 임의 주입하는 오류
4. 공식 API 추가·삭제 시 client method 누락
5. OAuth 동시 재발급, 외부 origin 변경과 자격증명 노출
6. timeout·401·429가 안전 상태와 메타데이터를 잃는 오류
7. 서버 계약에 bigint·잘못된 시간·범위 밖 비중 노출

## 경계

- 도메인 계산은 외부 mock 없이 단위 테스트합니다.
- OAuth와 transport는 `fetch`만 mock하고 대상 class의 판단은 mock하지 않습니다.
- 공식 OpenAPI parity는 고정 manifest를 source of truth로 사용합니다.
- route는 handler를 직접 호출해 안전 기본값을 검증합니다.
- 브라우저 시각 E2E는 도구와 기준이 구성된 후 별도 추가합니다.

## 명령

타깃 package test 후 `pnpm verify`로 전체 포맷, 린트, 타입, 테스트와 빌드를 확인합니다. `pnpm test:coverage`는 설치된 V8 provider로 workspace coverage를 생성합니다.
