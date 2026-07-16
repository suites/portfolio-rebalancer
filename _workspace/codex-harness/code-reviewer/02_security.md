# Security Review

## P1 — Production 필수 secret이 bootstrap optional

`DATABASE_URL`만 Vercel에서 필수다. Service token, Cron secret, Toss credential과 account reference key가 없어도 public health는 성공하므로 배포는 정상처럼 보이지만 실제 endpoint는 401 또는 수집 차단 상태가 될 수 있다. Production readiness 검사가 필요하다.

## P2 — Account reference key 재사용

`ACCOUNT_REFERENCE_KEY`가 없으면 Toss client secret을 HMAC key로 재사용한다. Production에서는 별도 32바이트 이상 key를 필수로 둔다.

## 확인된 안전 요소

- Cron과 Web service token Guard가 분리되어 있다.
- Toss egress 확인값이 없으면 Vercel 수집은 fail closed 한다.
- 파일시스템 쓰기, 상주 scheduler, child process 의존은 없다.
- 실제 주문 전송은 계속 차단되어 있다.
