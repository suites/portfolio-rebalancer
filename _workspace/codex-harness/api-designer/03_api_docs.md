# 개발자 API 문서

## 빠른 확인

```bash
pnpm dev
curl http://127.0.0.1:3000/api/v1/system/health
curl http://127.0.0.1:3000/api/v1/brokers
```

두 endpoint는 Toss에 접속하지 않고 주문을 생성하지 않습니다.

## Toss schema 동기화

```bash
pnpm toss:sync
pnpm verify
```

생성 파일은 직접 수정하지 않고 diff를 리뷰합니다. 버전, operation, 필수 field, enum, decimal 문자열, 인증, rate-limit 그룹과 계좌 변경 분류를 확인합니다.

## 인증과 안전

Toss 업무 API는 OAuth 2.0 Client Credentials access token과 필요한 경우 `X-Tossinvest-Account`를 사용합니다. secret과 token은 서버에만 둡니다. 현재 실제 account 조회는 제품 흐름에 연결되지 않았습니다. 계좌 변경 메서드는 `TOSS_LIVE_TRADING_DISABLED`로 무조건 차단됩니다.

origin은 공식 주소에 고정됩니다. 요청은 기본 10초 후 timeout되고, 네트워크·HTTP 오류는 안전한 한국어 오류로 변환됩니다. `401`은 캐시 token을 폐기하고 `429`는 retry/rate-limit/request ID 메타데이터만 추출합니다. 자동 재시도는 하지 않습니다. `/api/v1/brokers`는 미연결·transport-only 상태와 transport가 설명하는 18개 read-only capability를 반환하며 write capability는 없습니다.

전체 operation 범위와 제약은 `docs/API_TOSS.md`, 제품 불변식은 `docs/SPEC.md`를 참고합니다.
