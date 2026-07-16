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
- `managedCashMinor`와 `totalValueMinor`는 이 값 때문에 변경되지 않는다.

## Dashboard 관리 현금 계약

```json
{
  "managedCashMinor": "1000000",
  "managedCashSource": "USER_FIXED",
  "totalValueMinor": "4142919"
}
```

- `managedCashSource`는 `UNSET`, `EXCLUDED`, `USER_FIXED` 중 하나다.
- `UNSET`은 금액 `null`, `EXCLUDED`는 금액 `"0"`, `USER_FIXED`는 비음수 원 단위
  문자열을 요구한다.
- 총액은 주식 평가액과 관리 현금의 합이며 매수 가능 금액을 포함하지 않는다.

## Target draft 밴드 계약

기본 입력은 관리 현금 정책과 각 목표 정책을 전달한다.

```json
{
  "cashPolicy": {
    "mode": "FIXED_KRW",
    "version": "CASH_V1",
    "amountMinor": "1000000"
  },
  "allocations": [
    {
      "assetKey": "SAFE",
      "targetBasisPoints": 0,
      "instrumentKeys": [],
      "compositionPolicy": {
        "mode": "PRESERVE_CURRENT",
        "version": "PRESERVE_CURRENT_V1"
      },
      "bandPolicy": { "mode": "AUTO", "version": "MIXED_V1" }
    },
    {
      "assetKey": "CORE",
      "targetBasisPoints": 0,
      "instrumentKeys": [],
      "compositionPolicy": {
        "mode": "PRESERVE_CURRENT",
        "version": "PRESERVE_CURRENT_V1"
      },
      "bandPolicy": { "mode": "AUTO", "version": "MIXED_V1" }
    },
    {
      "assetKey": "SATELLITE",
      "targetBasisPoints": 9000,
      "instrumentKeys": ["KR:005930"],
      "compositionPolicy": {
        "mode": "PRESERVE_CURRENT",
        "version": "PRESERVE_CURRENT_V1"
      },
      "bandPolicy": { "mode": "AUTO", "version": "MIXED_V1" }
    },
    {
      "assetKey": "CASH",
      "targetBasisPoints": 1000,
      "instrumentKeys": [],
      "compositionPolicy": {
        "mode": "PRESERVE_CURRENT",
        "version": "PRESERVE_CURRENT_V1"
      },
      "bandPolicy": { "mode": "AUTO", "version": "MIXED_V1" }
    }
  ]
}
```

응답과 저장 버전에는 확정된 `lowerBasisPoints`, `upperBasisPoints`와 같은
`bandPolicy`, 서버 label, `compositionPolicy`와 각 종목의 `withinAssetPoints`가
포함된다. `CUSTOM_V1`은 고급 호출에서만 명시적 범위를 받는다.

현재 미보유 종목이 포함된 비현금 자산군은 다음 정책을 명시해야 한다.

```json
{
  "assetKey": "SAFE",
  "targetBasisPoints": 1000,
  "instrumentKeys": ["US:SGOV"],
  "compositionPolicy": { "mode": "EQUAL", "version": "EQUAL_V1" },
  "bandPolicy": { "mode": "AUTO", "version": "MIXED_V1" }
}
```

## 종목 검색과 검증 계약

`GET /internal/v1/instruments/search?query=애플`은 Toss를 호출하지 않고 이전에 검증된
로컬 카탈로그만 검색한다.

```json
{
  "query": "애플",
  "catalogScope": "LOCAL_VALIDATED",
  "candidates": [
    {
      "validationId": "2bf2e437-c981-4dbd-842e-d0d9a11ac318",
      "instrumentKey": "US:AAPL",
      "symbol": "AAPL",
      "name": "애플",
      "englishName": "Apple Inc.",
      "marketCountry": "US",
      "listingMarket": "NASDAQ",
      "currency": "USD",
      "securityType": "FOREIGN_STOCK",
      "listingStatus": "ACTIVE",
      "source": "CATALOG",
      "targetEligibility": "ELIGIBLE",
      "targetReasonCodes": [],
      "addEligible": true,
      "blockedReason": null,
      "tradeBlockedNow": false,
      "tradeReasonCodes": [],
      "tradeBlockedReason": null,
      "requiresOrderRevalidation": false,
      "verifiedAt": "2026-07-16T09:00:00+09:00"
    }
  ]
}
```

`POST /internal/v1/instrument-validations`는 `{"query":"US:AAPL"}`처럼 정확한 코드만
받습니다. Toss `getStocks`와 `getStockWarnings`를 모두 검증한 뒤 같은 candidate
형식에서 `source="TOSS_EXACT"`를 반환하고 append-only 검증 증거를 저장합니다.
기본정보나 유의사항 중 하나라도 확인하지 못하면 증거와 설정을 부분 저장하지 않습니다.

`listingStatus`는 Toss 상장 상태 원문, `targetEligibility`는 장기 목표 편입 판정,
`tradeBlockedNow`는 관측 시점의 거래 차단 판정입니다. KRX 거래정지, 경고, VI와
알 수 없는 유의사항은 현재 거래를 차단하며 계획·주문 직전에 다시 검증해야 합니다.

- `GET /internal/v1/health`: live 주문 비활성 상태
- `GET /internal/v1/dashboard`: 저장된 최신 실제 snapshot
- `POST /internal/v1/portfolio/refresh`: service token, Toss read-only 수집
- `GET /internal/v1/cron/portfolio`: Vercel Cron secret, 평일 09:00 KST
- `GET /internal/v1/records`: 최근 실제 수집·snapshot 검사 요약, service token
- `GET /internal/v1/target-settings`: 현재 보유 후보와 활성 목표 설정, service token
- `GET /internal/v1/instruments/search`: `LOCAL_VALIDATED` 로컬 카탈로그 검색, service token
- `POST /internal/v1/instrument-validations`: Toss 정확 심볼·유의사항 검증과 증거 저장, service token
- `POST /internal/v1/target-settings/drafts`: 최신 snapshot에 묶인 검증된 목표 초안 저장, service token
- `POST /internal/v1/target-settings/drafts/:version/activate`: 동일 snapshot일 때만 초안 적용, service token
- `GET /api/v1/system/health`: Web BFF 상태
- `GET /api/v1/brokers`: 실제 engine 연결 상태

모든 dashboard 응답은 공유 Zod 계약을 통과하고 `liveOrdersEnabled: false`이다.
records 응답은 raw broker payload, 전체 계좌번호와 비밀정보를 포함하지 않는다.
target settings 저장과 적용은 분리하며 계획 생성 또는 주문 제출을 호출하지 않는다.
미보유 목표 종목은 저장 직전 Toss에서 다시 검증하고 append-only `validationId`를
`TargetInstrument`와 설정 content hash에 포함한다.
