# API

## Dashboard buying-power 계약

`GET /internal/v1/dashboard`는 통화별 매수 가능 금액을 다음 형태로 전달한다.

```json
{
  "buyingPower": [
    {
      "currency": "KRW",
      "amount": "5000000",
      "valueKrwMinor": "5000000",
      "observedAt": "2026-07-16T09:00:00+09:00",
      "valuationEligible": false
    }
  ]
}
```

- `amount`는 브로커가 반환한 통화별 decimal 문자열이다.
- `valueKrwMinor`는 화면 참고 및 감사용 환산값이며 통화 간 합산이나 평가 입력으로
  사용할 수 없다.
- `valuationEligible`는 현재 항상 `false`다.
- `verifiedCashMinor`와 `totalValueMinor`는 이 값 때문에 변경되지 않는다.

- `GET /internal/v1/health`: live 주문 비활성 상태
- `GET /internal/v1/dashboard`: 저장된 최신 실제 snapshot
- `POST /internal/v1/portfolio/refresh`: service token, Toss read-only 수집
- `GET /internal/v1/cron/portfolio`: Vercel Cron secret, 평일 09:00 KST
- `GET /internal/v1/records`: 최근 실제 수집·snapshot 검사 요약, service token
- `GET /internal/v1/target-settings`: 현재 보유 후보와 활성 목표 설정, service token
- `POST /internal/v1/target-settings/drafts`: 최신 snapshot에 묶인 검증된 목표 초안 저장, service token
- `POST /internal/v1/target-settings/drafts/:version/activate`: 동일 snapshot일 때만 초안 적용, service token
- `GET /api/v1/system/health`: Web BFF 상태
- `GET /api/v1/brokers`: 실제 engine 연결 상태

모든 dashboard 응답은 공유 Zod 계약을 통과하고 `liveOrdersEnabled: false`이다.
records 응답은 raw broker payload, 전체 계좌번호와 비밀정보를 포함하지 않는다.
target settings 저장과 적용은 분리하며 계획 생성 또는 주문 제출을 호출하지 않는다.
